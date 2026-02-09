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
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  type Hex,
  type Address,
} from "viem";
import { hardhat } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
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

// -- Paths --

const CONTRACTS_DIR = resolve(import.meta.dir, "..");
const CIRCUITS_DIR = resolve(CONTRACTS_DIR, "../circuits");
const TARGET_DIR = join(CIRCUITS_DIR, "target");
const ARTIFACTS_DIR = join(CONTRACTS_DIR, "artifacts/contracts");

// -- Clients --

const DEPLOYER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const deployerAccount = privateKeyToAccount(DEPLOYER_PK);

const publicClient = createPublicClient({
  chain: hardhat,
  transport: http("http://127.0.0.1:8545"),
});

const walletClient = createWalletClient({
  account: deployerAccount,
  chain: hardhat,
  transport: http("http://127.0.0.1:8545"),
});

const ZERO_BYTES32: Hex = `0x${"0".repeat(64)}`;

// -- Helpers --

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

function toBytes32(n: bigint): Hex {
  return `0x${n.toString(16).padStart(64, "0")}`;
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
): { proofBytes: Hex; publicInputs: Hex[] } {
  if (!existsSync(TARGET_DIR)) {
    mkdirSync(TARGET_DIR, { recursive: true });
  }

  writeFileSync(join(CIRCUITS_DIR, "Prover.toml"), toProverToml(inputs));

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

  const publicInputs: Hex[] = [];
  for (let i = 0; i < piData.length / 32; i++) {
    publicInputs.push(("0x" + Buffer.from(piData.slice(i * 32, (i + 1) * 32)).toString("hex")) as Hex);
  }

  return {
    proofBytes: ("0x" + Buffer.from(proofData).toString("hex")) as Hex,
    publicInputs,
  };
}

// -- BLSGun ABI (minimal for this test) --

const blsGunAbi = [
  {
    type: "function" as const,
    name: "shield" as const,
    stateMutability: "payable" as const,
    inputs: [
      { name: "commitment", type: "bytes32" as const },
      { name: "ephPubKeyX", type: "bytes32" as const },
      { name: "ephPubKeyY", type: "bytes32" as const },
      { name: "viewTag", type: "uint8" as const },
      { name: "encryptedAmount", type: "uint128" as const },
    ],
    outputs: [],
  },
  {
    type: "function" as const,
    name: "privateTransfer" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "nullifier", type: "bytes32" as const },
      { name: "inputCommitment", type: "bytes32" as const },
      { name: "outputCommitment", type: "bytes32" as const },
      { name: "proof", type: "bytes" as const },
      { name: "ephPubKeyX", type: "bytes32" as const },
      { name: "ephPubKeyY", type: "bytes32" as const },
      { name: "viewTag", type: "uint8" as const },
      { name: "encryptedAmount", type: "uint128" as const },
    ],
    outputs: [],
  },
] as const;

/** Build circuit inputs for a spend with a specific signer pair */
function buildInputsForSignerPair(
  pkg: MasterKeyPackage,
  signerIdxA: number,
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

// -- Deploy --

async function deploy(): Promise<Address> {
  const transcriptArtifact = loadArtifact("Verifier.sol/ZKTranscriptLib.json");
  const libHash = await walletClient.deployContract({
    abi: transcriptArtifact.abi,
    bytecode: transcriptArtifact.bytecode as Hex,
  });
  const libReceipt = await publicClient.waitForTransactionReceipt({ hash: libHash });
  const libAddr = libReceipt.contractAddress!;

  const verifierArtifact = loadArtifact("Verifier.sol/HonkVerifier.json");
  const linkedBytecode = (verifierArtifact.bytecode as string).replace(
    /__\$[0-9a-fA-F]{34}\$__/g,
    libAddr.slice(2).toLowerCase(),
  ) as Hex;
  const verifierHash = await walletClient.deployContract({
    abi: verifierArtifact.abi,
    bytecode: linkedBytecode,
  });
  const verifierReceipt = await publicClient.waitForTransactionReceipt({ hash: verifierHash });
  const verifierAddr = verifierReceipt.contractAddress!;

  const blsgunArtifact = loadArtifact("BLSGun.sol/BLSGun.json");
  const blsgunHash = await walletClient.deployContract({
    abi: blsgunArtifact.abi,
    bytecode: blsgunArtifact.bytecode as Hex,
    args: [verifierAddr],
  });
  const blsgunReceipt = await publicClient.waitForTransactionReceipt({ hash: blsgunHash });
  return blsgunReceipt.contractAddress!;
}

// -- Test Runner --

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

// -- Main --

async function main() {
  console.log("+=================================================+");
  console.log("|  FROST TSS -> ZK Proof -> On-Chain Verify Test   |");
  console.log("+=================================================+\n");

  await initHash();

  // Generate FROST 2-of-3 keys
  console.log("[Setup] Generating FROST 2-of-3 keys...");
  const pkg = generateMasterKeyPackage({ threshold: 2, totalSigners: 3, nonceCount: 20 });
  const spendKey = poseidon2Hash2(pkg.groupPublicKey.x, pkg.groupPublicKey.y);
  console.log("  Group PK:", toBytes32(pkg.groupPublicKey.x).slice(0, 22) + "...");

  // Create note
  const amount = 1000000n;
  const blinding = 0xdeadbeefn;
  const commitment = computeCommitment(spendKey, amount, blinding);

  const tree = new MerkleTree(20);
  tree.insert(commitment);

  console.log("\n--------------------------------------------");
  console.log("Test 1: FROST signers (1,2) -> ZK proof + on-chain verify");
  console.log("--------------------------------------------");
  {
    const gun = await deploy();
    console.log("  [Setup] Deploying contracts...");
    console.log("  BLSGun:", gun);

    const shieldHash = await walletClient.writeContract({
      address: gun,
      abi: blsGunAbi,
      functionName: "shield",
      args: [toBytes32(commitment), ZERO_BYTES32, ZERO_BYTES32, 0, 0n],
      value: parseEther("1"),
    });
    await publicClient.waitForTransactionReceipt({ hash: shieldHash });

    const inputs = buildInputsForSignerPair(pkg, 0, 1, 0, spendKey, amount, blinding, commitment, 0, tree);

    console.log("  Generating ZK proof...");
    const { proofBytes, publicInputs } = generateProofAndInputs(inputs);
    console.log("  Proof size:", (proofBytes.length - 2) / 2, "bytes");

    const outputCommitment = computeCommitment(999n, amount, 0x42n);
    try {
      const txHash = await walletClient.writeContract({
        address: gun,
        abi: blsGunAbi,
        functionName: "privateTransfer",
        args: [
          publicInputs[0],
          publicInputs[1],
          toBytes32(outputCommitment),
          proofBytes,
          ZERO_BYTES32, ZERO_BYTES32, 0, 0n,
        ],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      ok("Signers (1,2): proof accepted on-chain");
    } catch (e: any) {
      fail("Signers (1,2)", e.message?.slice(0, 120));
    }
  }

  console.log("\n--------------------------------------------");
  console.log("Test 2: FROST signers (1,3) -> ZK proof + on-chain verify");
  console.log("--------------------------------------------");
  {
    const gun = await deploy();
    const shieldHash = await walletClient.writeContract({
      address: gun,
      abi: blsGunAbi,
      functionName: "shield",
      args: [toBytes32(commitment), ZERO_BYTES32, ZERO_BYTES32, 0, 0n],
      value: parseEther("1"),
    });
    await publicClient.waitForTransactionReceipt({ hash: shieldHash });

    const inputs = buildInputsForSignerPair(pkg, 0, 2, 1, spendKey, amount, blinding, commitment, 0, tree);

    console.log("  Generating ZK proof...");
    const { proofBytes, publicInputs } = generateProofAndInputs(inputs);

    const outputCommitment = computeCommitment(888n, amount, 0x43n);
    try {
      const txHash = await walletClient.writeContract({
        address: gun,
        abi: blsGunAbi,
        functionName: "privateTransfer",
        args: [
          publicInputs[0],
          publicInputs[1],
          toBytes32(outputCommitment),
          proofBytes,
          ZERO_BYTES32, ZERO_BYTES32, 0, 0n,
        ],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      ok("Signers (1,3): proof accepted on-chain");
    } catch (e: any) {
      fail("Signers (1,3)", e.message?.slice(0, 120));
    }
  }

  console.log("\n--------------------------------------------");
  console.log("Test 3: FROST signers (2,3) -> ZK proof + on-chain verify");
  console.log("--------------------------------------------");
  {
    const gun = await deploy();
    const shieldHash = await walletClient.writeContract({
      address: gun,
      abi: blsGunAbi,
      functionName: "shield",
      args: [toBytes32(commitment), ZERO_BYTES32, ZERO_BYTES32, 0, 0n],
      value: parseEther("1"),
    });
    await publicClient.waitForTransactionReceipt({ hash: shieldHash });

    const inputs = buildInputsForSignerPair(pkg, 1, 2, 2, spendKey, amount, blinding, commitment, 0, tree);

    console.log("  Generating ZK proof...");
    const { proofBytes, publicInputs } = generateProofAndInputs(inputs);

    const outputCommitment = computeCommitment(777n, amount, 0x44n);
    try {
      const txHash = await walletClient.writeContract({
        address: gun,
        abi: blsGunAbi,
        functionName: "privateTransfer",
        args: [
          publicInputs[0],
          publicInputs[1],
          toBytes32(outputCommitment),
          proofBytes,
          ZERO_BYTES32, ZERO_BYTES32, 0, 0n,
        ],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      ok("Signers (2,3): proof accepted on-chain");
    } catch (e: any) {
      fail("Signers (2,3)", e.message?.slice(0, 120));
    }
  }

  console.log("\n--------------------------------------------");
  console.log("Test 4: Tampered signature -> circuit rejects");
  console.log("--------------------------------------------");
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

  console.log("\n--------------------------------------------");
  console.log("Test 5: Wrong group public key -> circuit rejects");
  console.log("--------------------------------------------");
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

  console.log("\n--------------------------------------------");
  console.log("Test 6: Wrong spending key -> circuit rejects (commitment mismatch)");
  console.log("--------------------------------------------");
  {
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

  console.log("\n--------------------------------------------");
  console.log("Test 7: Wrong nullifier -> circuit rejects");
  console.log("--------------------------------------------");
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

  console.log("\n--------------------------------------------");
  console.log("Test 8: Wrong message (sign different M) -> circuit rejects");
  console.log("--------------------------------------------");
  {
    const merkleProof = tree.generateProof(0);
    const nullifier = computeNullifier(spendKey, 0n);
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

  // -- Summary --

  console.log("\n==================================================");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("==================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n=== FROST PROOF TEST FAILED ===");
  console.error(err);
  process.exit(1);
});
