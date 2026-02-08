/**
 * FROST TSS → ZK Proof E2E Test
 *
 * Tests that the FROST 2-of-3 threshold signature is correctly
 * verified inside the Noir ZK circuit + on-chain HonkVerifier.
 *
 * Test cases:
 *   1. Signers (1,2) → valid proof → on-chain verify OK
 *   2. Signers (1,3) → valid proof → on-chain verify OK
 *   3. Signers (2,3) → valid proof → on-chain verify OK
 *   4. Wrong signature → circuit rejects (nargo execute fails)
 *   5. Wrong spending key → circuit rejects (commitment mismatch)
 *   6. Wrong nullifier → circuit rejects
 *   7. Wrong message (sign different M) → circuit rejects
 *
 * Usage:
 *   Terminal 1: cd packages/contracts && bun run node
 *   Terminal 2: cd packages/contracts && bun run test:frost
 */
import { ethers } from "ethers";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { execSync } from "child_process";

import {
  initHash,
  poseidon2Hash2,
  generateMasterKeyPackage,
  createSignerKeyMaterial,
  frostSign,
  frostVerify,
  computeCommitment,
  computeNullifier,
  MerkleTree,
  buildCircuitInputs,
  Fr,
  type CircuitInputs,
  type MasterKeyPackage,
} from "../../sdk/src/index.ts";

// ─── Paths ────────────────────────────────────────────────────────────────────

const CONTRACTS_DIR = resolve(import.meta.dir, "..");
const CIRCUITS_DIR = resolve(CONTRACTS_DIR, "../circuits");
const TARGET_DIR = join(CIRCUITS_DIR, "target");
const ARTIFACTS_DIR = join(CONTRACTS_DIR, "artifacts/contracts");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadArtifact(path: string) {
  return JSON.parse(readFileSync(join(ARTIFACTS_DIR, path), "utf-8"));
}

function toProverToml(inputs: CircuitInputs): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(inputs)) {
    if (Array.isArray(value)) {
      lines.push(`${key} = [${value.map((v) => `"${v}"`).join(", ")}]`);
    } else {
      lines.push(`${key} = "${value}"`);
    }
  }
  return lines.join("\n");
}

function toBytes32(n: bigint): string {
  return "0x" + n.toString(16).padStart(64, "0");
}

/** Try to generate witness — returns true if circuit accepts, false if it rejects */
function tryWitness(inputs: CircuitInputs): boolean {
  const proverToml = toProverToml(inputs);
  writeFileSync(join(CIRCUITS_DIR, "Prover.toml"), proverToml);
  try {
    execSync("nargo execute", { cwd: CIRCUITS_DIR, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/** Generate a full EVM proof from circuit inputs */
function generateProofAndInputs(
  inputs: CircuitInputs,
): { proofBytes: string; publicInputs: string[] } {
  if (!existsSync(TARGET_DIR)) {
    mkdirSync(TARGET_DIR, { recursive: true });
  }

  const proverToml = toProverToml(inputs);
  writeFileSync(join(CIRCUITS_DIR, "Prover.toml"), proverToml);

  const bytecodeFile = join(TARGET_DIR, "blsgun.json");
  if (!existsSync(bytecodeFile)) {
    execSync("nargo compile", { cwd: CIRCUITS_DIR, stdio: "inherit" });
  }

  execSync("nargo execute", { cwd: CIRCUITS_DIR, stdio: "inherit" });
  execSync(
    `bb prove -b ${bytecodeFile} -w ${join(TARGET_DIR, "blsgun.gz")} -o ${TARGET_DIR} -t evm`,
    { cwd: CIRCUITS_DIR, stdio: "inherit" },
  );

  const proofData = new Uint8Array(readFileSync(join(TARGET_DIR, "proof")));
  const piData = new Uint8Array(readFileSync(join(TARGET_DIR, "public_inputs")));

  const publicInputs: string[] = [];
  for (let i = 0; i < piData.length / 32; i++) {
    publicInputs.push("0x" + Buffer.from(piData.slice(i * 32, (i + 1) * 32)).toString("hex"));
  }

  return {
    proofBytes: "0x" + Buffer.from(proofData).toString("hex"),
    publicInputs,
  };
}

/** Build circuit inputs for a spend with a specific signer pair */
function buildInputsForSignerPair(
  pkg: MasterKeyPackage,
  signerIdxA: number, // 0-based index into pkg.shares
  signerIdxB: number,
  nonceIdx: number,
  spendKey: bigint,
  amount: bigint,
  blinding: bigint,
  commitment: bigint,
  leafIdx: number,
  tree: InstanceType<typeof MerkleTree>,
): CircuitInputs {
  const merkleProof = tree.generateProof(leafIdx);
  const nullifier = computeNullifier(spendKey, BigInt(leafIdx));
  const message = poseidon2Hash2(nullifier, commitment);

  const sA = createSignerKeyMaterial(pkg, signerIdxA, nonceIdx + 1);
  const sB = createSignerKeyMaterial(pkg, signerIdxB, nonceIdx + 1);

  const sig = frostSign(
    message,
    [
      { index: sA.share.index, secretShare: sA.share.secretShare, nonce: sA.nonces[nonceIdx] },
      { index: sB.share.index, secretShare: sB.share.secretShare, nonce: sB.nonces[nonceIdx] },
    ],
    pkg.groupPublicKey,
    pkg.threshold,
  );

  const valid = frostVerify(sig, message, pkg.groupPublicKey);
  if (!valid) throw new Error("FROST verify failed off-chain");

  return buildCircuitInputs(
    sig, pkg.groupPublicKey, spendKey, amount, blinding,
    merkleProof, nullifier, commitment,
  );
}

// ─── Deploy ───────────────────────────────────────────────────────────────────

async function deploy(signer: ethers.Signer) {
  const transcriptArtifact = loadArtifact("Verifier.sol/ZKTranscriptLib.json");
  const transcriptLib = await new ethers.ContractFactory(
    transcriptArtifact.abi, transcriptArtifact.bytecode, signer,
  ).deploy();
  await transcriptLib.waitForDeployment();
  const libAddr = await transcriptLib.getAddress();

  const verifierArtifact = loadArtifact("Verifier.sol/HonkVerifier.json");
  const linkedBytecode = verifierArtifact.bytecode.replace(
    /__\$[0-9a-fA-F]{34}\$__/g, libAddr.slice(2).toLowerCase(),
  );
  const verifier = await new ethers.ContractFactory(
    verifierArtifact.abi, linkedBytecode, signer,
  ).deploy();
  await verifier.waitForDeployment();
  const verifierAddr = await verifier.getAddress();

  const blsgunArtifact = loadArtifact("BLSGun.sol/BLSGun.json");
  const blsgun = await new ethers.ContractFactory(
    blsgunArtifact.abi, blsgunArtifact.bytecode, signer,
  ).deploy(verifierAddr);
  await blsgun.waitForDeployment();

  return blsgun;
}

// ─── Test Runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(name: string) {
  passed++;
  console.log(`  PASS  ${name}`);
}
function fail(name: string, reason: string) {
  failed++;
  console.log(`  FAIL  ${name}`);
  console.log(`        ${reason}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║  FROST TSS → ZK Proof → On-Chain Verify Test ║");
  console.log("╚═══════════════════════════════════════════════╝\n");

  await initHash();

  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
  const accounts = await provider.listAccounts();
  const deployer = accounts[0];

  // Deploy contracts
  console.log("[Setup] Deploying contracts...");
  const blsgun = await deploy(deployer);
  console.log("  BLSGun:", await blsgun.getAddress());

  // Generate FROST 2-of-3 keys
  console.log("[Setup] Generating FROST 2-of-3 keys...");
  const pkg = generateMasterKeyPackage({ threshold: 2, totalSigners: 3, nonceCount: 20 });
  const spendKey = poseidon2Hash2(pkg.groupPublicKey.x, pkg.groupPublicKey.y);
  console.log("  Group PK:", toBytes32(pkg.groupPublicKey.x).slice(0, 22) + "...");

  // Create note and shield on-chain
  const amount = 1000000n;
  const blinding = 0xdeadbeefn;
  const commitment = computeCommitment(spendKey, amount, blinding);

  const tree = new MerkleTree(20);
  tree.insert(commitment);

  // Shield 3 separate deposits (need 3 notes, one per signer-pair test)
  console.log("[Setup] Shielding 3 deposits...");
  for (let i = 0; i < 3; i++) {
    await (blsgun as any).connect(deployer).shield(
      toBytes32(commitment),
      { value: ethers.parseEther("1") },
    );
  }
  console.log("  Contract balance:", ethers.formatEther(await provider.getBalance(await blsgun.getAddress())), "ETH");

  // Note: all 3 shield calls use the same commitment, but the Merkle tree on-chain
  // has 3 copies. Our local tree only has 1 (at index 0). The on-chain root won't match
  // for index 0 after multiple inserts. So let's use a fresh approach:
  // Reset — deploy fresh, shield once per test.

  // Actually simpler: for the ZK proof tests, we just need the circuit to accept.
  // For on-chain verify, we need the merkle root to match.
  // Let's do: deploy fresh for each on-chain test, use just witness check for the fast tests.

  console.log("\n────────────────────────────────────────────────");
  console.log("Test 1: FROST signers (1,2) → ZK proof + on-chain verify");
  console.log("────────────────────────────────────────────────");
  {
    // Fresh deploy + shield
    const gun = await deploy(deployer);
    await (gun as any).connect(deployer).shield(
      toBytes32(commitment), { value: ethers.parseEther("1") },
    );

    const inputs = buildInputsForSignerPair(pkg, 0, 1, 0, spendKey, amount, blinding, commitment, 0, tree);

    console.log("  Generating ZK proof...");
    const { proofBytes, publicInputs } = generateProofAndInputs(inputs);
    console.log("  Proof size:", (proofBytes.length - 2) / 2, "bytes");

    // Submit on-chain with a dummy output
    const outputCommitment = computeCommitment(999n, amount, 0x42n);
    try {
      const tx = await (gun as any).connect(deployer).privateTransfer(
        publicInputs[0], // nullifier
        publicInputs[1], // inputCommitment
        toBytes32(outputCommitment),
        proofBytes,
      );
      await tx.wait();
      ok("Signers (1,2): proof accepted on-chain");
    } catch (e: any) {
      fail("Signers (1,2)", e.message?.slice(0, 120));
    }
  }

  console.log("\n────────────────────────────────────────────────");
  console.log("Test 2: FROST signers (1,3) → ZK proof + on-chain verify");
  console.log("────────────────────────────────────────────────");
  {
    const gun = await deploy(deployer);
    await (gun as any).connect(deployer).shield(
      toBytes32(commitment), { value: ethers.parseEther("1") },
    );

    const inputs = buildInputsForSignerPair(pkg, 0, 2, 1, spendKey, amount, blinding, commitment, 0, tree);

    console.log("  Generating ZK proof...");
    const { proofBytes, publicInputs } = generateProofAndInputs(inputs);

    const outputCommitment = computeCommitment(888n, amount, 0x43n);
    try {
      const tx = await (gun as any).connect(deployer).privateTransfer(
        publicInputs[0],
        publicInputs[1],
        toBytes32(outputCommitment),
        proofBytes,
      );
      await tx.wait();
      ok("Signers (1,3): proof accepted on-chain");
    } catch (e: any) {
      fail("Signers (1,3)", e.message?.slice(0, 120));
    }
  }

  console.log("\n────────────────────────────────────────────────");
  console.log("Test 3: FROST signers (2,3) → ZK proof + on-chain verify");
  console.log("────────────────────────────────────────────────");
  {
    const gun = await deploy(deployer);
    await (gun as any).connect(deployer).shield(
      toBytes32(commitment), { value: ethers.parseEther("1") },
    );

    const inputs = buildInputsForSignerPair(pkg, 1, 2, 2, spendKey, amount, blinding, commitment, 0, tree);

    console.log("  Generating ZK proof...");
    const { proofBytes, publicInputs } = generateProofAndInputs(inputs);

    const outputCommitment = computeCommitment(777n, amount, 0x44n);
    try {
      const tx = await (gun as any).connect(deployer).privateTransfer(
        publicInputs[0],
        publicInputs[1],
        toBytes32(outputCommitment),
        proofBytes,
      );
      await tx.wait();
      ok("Signers (2,3): proof accepted on-chain");
    } catch (e: any) {
      fail("Signers (2,3)", e.message?.slice(0, 120));
    }
  }

  console.log("\n────────────────────────────────────────────────");
  console.log("Test 4: Tampered signature → circuit rejects");
  console.log("────────────────────────────────────────────────");
  {
    const inputs = buildInputsForSignerPair(pkg, 0, 1, 3, spendKey, amount, blinding, commitment, 0, tree);

    // Tamper with signature_z_lo (flip a bit)
    const zLo = BigInt(inputs.signature_z_lo);
    inputs.signature_z_lo = "0x" + (zLo ^ 1n).toString(16);

    const accepted = tryWitness(inputs);
    if (!accepted) {
      ok("Tampered signature_z: circuit rejected (FROST sig x/y mismatch)");
    } else {
      fail("Tampered signature_z", "Circuit should have rejected tampered signature");
    }
  }

  console.log("\n────────────────────────────────────────────────");
  console.log("Test 5: Wrong group public key → circuit rejects");
  console.log("────────────────────────────────────────────────");
  {
    const inputs = buildInputsForSignerPair(pkg, 0, 1, 4, spendKey, amount, blinding, commitment, 0, tree);

    // Use a different group's public key
    const wrongPkg = generateMasterKeyPackage({ threshold: 2, totalSigners: 3, nonceCount: 1 });
    inputs.group_pubkey_x = "0x" + wrongPkg.groupPublicKey.x.toString(16);
    inputs.group_pubkey_y = "0x" + wrongPkg.groupPublicKey.y.toString(16);

    const accepted = tryWitness(inputs);
    if (!accepted) {
      ok("Wrong group PK: circuit rejected");
    } else {
      fail("Wrong group PK", "Circuit should have rejected wrong public key");
    }
  }

  console.log("\n────────────────────────────────────────────────");
  console.log("Test 6: Wrong spending key → circuit rejects (commitment mismatch)");
  console.log("────────────────────────────────────────────────");
  {
    // Build inputs with correct signature but wrong spending key
    const wrongSpendKey = poseidon2Hash2(42n, 43n);
    const merkleProof = tree.generateProof(0);
    const nullifier = computeNullifier(wrongSpendKey, 0n);
    const message = poseidon2Hash2(nullifier, commitment);

    const sA = createSignerKeyMaterial(pkg, 0, 6);
    const sB = createSignerKeyMaterial(pkg, 1, 6);
    const sig = frostSign(
      message,
      [
        { index: sA.share.index, secretShare: sA.share.secretShare, nonce: sA.nonces[5] },
        { index: sB.share.index, secretShare: sB.share.secretShare, nonce: sB.nonces[5] },
      ],
      pkg.groupPublicKey,
      pkg.threshold,
    );

    const inputs = buildCircuitInputs(
      sig, pkg.groupPublicKey, wrongSpendKey, amount, blinding,
      merkleProof, nullifier, commitment,
    );

    const accepted = tryWitness(inputs);
    if (!accepted) {
      ok("Wrong spending key: circuit rejected (commitment mismatch)");
    } else {
      fail("Wrong spending key", "Circuit should have rejected wrong spending key");
    }
  }

  console.log("\n────────────────────────────────────────────────");
  console.log("Test 7: Wrong nullifier → circuit rejects");
  console.log("────────────────────────────────────────────────");
  {
    const inputs = buildInputsForSignerPair(pkg, 0, 1, 6, spendKey, amount, blinding, commitment, 0, tree);

    // Tamper with the nullifier public input
    inputs.nullifier = "0x" + (BigInt(inputs.nullifier) ^ 1n).toString(16);

    const accepted = tryWitness(inputs);
    if (!accepted) {
      ok("Wrong nullifier: circuit rejected");
    } else {
      fail("Wrong nullifier", "Circuit should have rejected wrong nullifier");
    }
  }

  console.log("\n────────────────────────────────────────────────");
  console.log("Test 8: Wrong message (sign different M) → circuit rejects");
  console.log("────────────────────────────────────────────────");
  {
    // Build valid inputs first
    const merkleProof = tree.generateProof(0);
    const nullifier = computeNullifier(spendKey, 0n);
    // Sign a WRONG message (not hash_2(nullifier, commitment))
    const wrongMessage = poseidon2Hash2(42n, 43n);

    const sA = createSignerKeyMaterial(pkg, 0, 8);
    const sB = createSignerKeyMaterial(pkg, 1, 8);
    const sig = frostSign(
      wrongMessage,
      [
        { index: sA.share.index, secretShare: sA.share.secretShare, nonce: sA.nonces[7] },
        { index: sB.share.index, secretShare: sB.share.secretShare, nonce: sB.nonces[7] },
      ],
      pkg.groupPublicKey,
      pkg.threshold,
    );

    // Signature is valid for wrongMessage, but circuit computes message = hash_2(nullifier, commitment)
    if (!frostVerify(sig, wrongMessage, pkg.groupPublicKey)) {
      throw new Error("Off-chain verify of wrong-message sig should pass");
    }

    const inputs = buildCircuitInputs(
      sig, pkg.groupPublicKey, spendKey, amount, blinding,
      merkleProof, nullifier, commitment,
    );

    const accepted = tryWitness(inputs);
    if (!accepted) {
      ok("Wrong message: circuit rejected (sig verified against hash_2(nullifier, commitment), not wrong M)");
    } else {
      fail("Wrong message", "Circuit should have rejected signature over wrong message");
    }
  }

  // ─── Summary ────────────────────────────────────────────────────────────────

  console.log("\n══════════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("══════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n=== FROST PROOF TEST FAILED ===");
  console.error(err);
  process.exit(1);
});
