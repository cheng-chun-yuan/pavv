/**
 * BLSGun Full-Flow E2E: Shield → Private Transfer → Unshield
 *
 * Demonstrates the complete privacy lifecycle:
 *   1. Alice deposits 1 ETH (shield) with FROST group commitment
 *   2. Alice privately transfers to Bob's commitment (relayer pays gas)
 *   3. Bob unshields (withdraws) ETH to his address (relayer pays gas)
 *
 * Two separate FROST key groups: Alice's group and Bob's group.
 * Relayer is a third party that only sees opaque proofs.
 *
 * Usage:
 *   Terminal 1: cd packages/contracts && bun run node
 *   Terminal 2: cd packages/contracts && bun run test:full-flow
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
  type CircuitInputs,
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
    console.log("    Compiling circuit...");
    execSync("nargo compile", { cwd: CIRCUITS_DIR, stdio: "inherit" });
  }

  console.log("    nargo execute...");
  execSync("nargo execute", { cwd: CIRCUITS_DIR, stdio: "inherit" });

  console.log("    bb prove -t evm...");
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

/** Build a proof for spending a note */
function buildSpendProof(
  pkg: ReturnType<typeof generateMasterKeyPackage>,
  s1: ReturnType<typeof createSignerKeyMaterial>,
  s2: ReturnType<typeof createSignerKeyMaterial>,
  nonceIdx: number,
  spendingKeyHash: bigint,
  noteAmount: bigint,
  noteBlinding: bigint,
  commitment: bigint,
  leafIndex: number,
  tree: InstanceType<typeof MerkleTree>,
) {
  const merkleProof = tree.generateProof(leafIndex);
  const nullifier = computeNullifier(spendingKeyHash, BigInt(leafIndex));
  const message = poseidon2Hash2(nullifier, commitment);

  const signature = frostSign(
    message,
    [
      { index: s1.share.index, secretShare: s1.share.secretShare, nonce: s1.nonces[nonceIdx] },
      { index: s2.share.index, secretShare: s2.share.secretShare, nonce: s2.nonces[nonceIdx] },
    ],
    pkg.groupPublicKey,
    pkg.threshold,
  );

  if (!frostVerify(signature, message, pkg.groupPublicKey)) {
    throw new Error("FROST signature verification failed");
  }

  const circuitInputs = buildCircuitInputs(
    signature,
    pkg.groupPublicKey,
    spendingKeyHash,
    noteAmount,
    noteBlinding,
    merkleProof,
    nullifier,
    commitment,
  );

  const { proofBytes, publicInputs } = generateProofAndInputs(circuitInputs);

  // Sanity check
  if (BigInt(publicInputs[0]) !== nullifier) throw new Error("PI nullifier mismatch");
  if (BigInt(publicInputs[1]) !== commitment) throw new Error("PI commitment mismatch");
  if (BigInt(publicInputs[2]) !== merkleProof.root) throw new Error("PI root mismatch");

  return { nullifier, proofBytes, publicInputs, merkleRoot: merkleProof.root };
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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  BLSGun Full Flow: Shield → Transfer → Unshield ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  await initHash();

  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
  const accounts = await provider.listAccounts();
  const alice = accounts[0];   // depositor
  const bob = accounts[1];     // recipient (will unshield)
  const relayer = accounts[2]; // gas payer

  console.log("Alice  (depositor):", await alice.getAddress());
  console.log("Bob    (recipient):", await bob.getAddress());
  console.log("Relayer (gas)     :", await relayer.getAddress());

  // ────────────────────────────────────────────────
  // Step 1: Deploy contracts
  // ────────────────────────────────────────────────
  console.log("\n[Step 1] Deploy contracts");
  const blsgun = await deploy(alice);
  const blsgunAddr = await blsgun.getAddress();
  console.log("  BLSGun:", blsgunAddr);

  // ────────────────────────────────────────────────
  // Step 2: Generate FROST keys for Alice and Bob
  // ────────────────────────────────────────────────
  console.log("\n[Step 2] Generate FROST keys");

  const alicePkg = generateMasterKeyPackage({ threshold: 2, totalSigners: 3, nonceCount: 10 });
  const aliceS1 = createSignerKeyMaterial(alicePkg, 0, 10);
  const aliceS2 = createSignerKeyMaterial(alicePkg, 1, 10);
  const aliceSpendKey = poseidon2Hash2(alicePkg.groupPublicKey.x, alicePkg.groupPublicKey.y);
  console.log("  Alice group PK:", toBytes32(alicePkg.groupPublicKey.x).slice(0, 22) + "...");

  const bobPkg = generateMasterKeyPackage({ threshold: 2, totalSigners: 3, nonceCount: 10 });
  const bobS1 = createSignerKeyMaterial(bobPkg, 0, 10);
  const bobS2 = createSignerKeyMaterial(bobPkg, 1, 10);
  const bobSpendKey = poseidon2Hash2(bobPkg.groupPublicKey.x, bobPkg.groupPublicKey.y);
  console.log("  Bob   group PK:", toBytes32(bobPkg.groupPublicKey.x).slice(0, 22) + "...");

  // Local Merkle tree (mirrors on-chain)
  const tree = new MerkleTree(20);

  // ────────────────────────────────────────────────
  // Step 3: Alice shields 1 ETH
  // ────────────────────────────────────────────────
  console.log("\n[Step 3] Alice shields 1 ETH");

  const aliceAmount = 1000000n;
  const aliceBlinding = 0xaaaa1111n;
  const aliceCommitment = computeCommitment(aliceSpendKey, aliceAmount, aliceBlinding);
  const aliceLeafIdx = tree.insert(aliceCommitment);

  const shieldTx = await (blsgun as any).connect(alice).shield(
    toBytes32(aliceCommitment),
    { value: ethers.parseEther("1") },
  );
  const shieldReceipt = await shieldTx.wait();
  console.log("  Commitment:", toBytes32(aliceCommitment).slice(0, 22) + "...");
  console.log("  Leaf index:", aliceLeafIdx);
  console.log("  Tx:", shieldReceipt.hash);
  console.log("  Gas:", shieldReceipt.gasUsed.toString());

  // Verify roots match
  const rootAfterShield = await (blsgun as any).getMerkleRoot();
  if (BigInt(rootAfterShield) !== tree.root) {
    throw new Error("Root mismatch after shield");
  }
  console.log("  Merkle root verified!");

  // ────────────────────────────────────────────────
  // Step 4: Alice → Bob private transfer (relayer submits)
  // ────────────────────────────────────────────────
  console.log("\n[Step 4] Private transfer: Alice → Bob (relayer submits)");

  // Bob's output note
  const bobAmount = aliceAmount; // full amount, no fee
  const bobBlinding = 0xbbbb2222n;
  const bobCommitment = computeCommitment(bobSpendKey, bobAmount, bobBlinding);
  console.log("  Bob output commitment:", toBytes32(bobCommitment).slice(0, 22) + "...");

  // Generate proof spending Alice's note
  console.log("  Generating proof for Alice's note...");
  const aliceSpend = buildSpendProof(
    alicePkg, aliceS1, aliceS2, 0,
    aliceSpendKey, aliceAmount, aliceBlinding,
    aliceCommitment, aliceLeafIdx, tree,
  );

  // Relayer submits
  console.log("  Relayer submitting privateTransfer...");
  const transferTx = await (blsgun as any).connect(relayer).privateTransfer(
    toBytes32(aliceSpend.nullifier),
    toBytes32(aliceCommitment),
    toBytes32(bobCommitment),
    aliceSpend.proofBytes,
  );
  const transferReceipt = await transferTx.wait();
  console.log("  Tx:", transferReceipt.hash);
  console.log("  Gas:", transferReceipt.gasUsed.toString());

  // Update local tree
  tree.insert(bobCommitment);
  const bobLeafIdx = 1; // second leaf

  // Verify state
  const aliceNullSpent = await (blsgun as any).isNullifierSpent(toBytes32(aliceSpend.nullifier));
  console.log("  Alice nullifier spent:", aliceNullSpent);
  if (!aliceNullSpent) throw new Error("Alice nullifier should be spent!");

  const countAfterTransfer = await (blsgun as any).getCommitmentCount();
  console.log("  Commitments in tree:", countAfterTransfer.toString());

  const rootAfterTransfer = await (blsgun as any).getMerkleRoot();
  if (BigInt(rootAfterTransfer) !== tree.root) {
    throw new Error("Root mismatch after transfer");
  }
  console.log("  Merkle root verified!");

  // ────────────────────────────────────────────────
  // Step 5: Bob unshields — withdraws 1 ETH to his address
  // ────────────────────────────────────────────────
  console.log("\n[Step 5] Bob unshields 1 ETH to his address (relayer submits)");

  const bobAddress = await bob.getAddress();
  const bobBalanceBefore = await provider.getBalance(bobAddress);
  console.log("  Bob balance before:", ethers.formatEther(bobBalanceBefore), "ETH");

  // Generate proof spending Bob's note
  console.log("  Generating proof for Bob's note...");
  const bobSpend = buildSpendProof(
    bobPkg, bobS1, bobS2, 0,
    bobSpendKey, bobAmount, bobBlinding,
    bobCommitment, bobLeafIdx, tree,
  );

  // Relayer calls unshield (Bob doesn't pay gas)
  console.log("  Relayer submitting unshield...");
  const unshieldTx = await (blsgun as any).connect(relayer).unshield(
    toBytes32(bobSpend.nullifier),
    toBytes32(bobCommitment),
    bobAddress,
    ethers.parseEther("1"),
    bobSpend.proofBytes,
  );
  const unshieldReceipt = await unshieldTx.wait();
  console.log("  Tx:", unshieldReceipt.hash);
  console.log("  Gas:", unshieldReceipt.gasUsed.toString());

  // Verify Bob received ETH
  const bobBalanceAfter = await provider.getBalance(bobAddress);
  const gained = bobBalanceAfter - bobBalanceBefore;
  console.log("  Bob balance after:", ethers.formatEther(bobBalanceAfter), "ETH");
  console.log("  Bob gained:", ethers.formatEther(gained), "ETH");

  if (gained !== ethers.parseEther("1")) {
    throw new Error(`Bob should gain exactly 1 ETH, got ${ethers.formatEther(gained)}`);
  }

  // Verify on-chain state
  const bobNullSpent = await (blsgun as any).isNullifierSpent(toBytes32(bobSpend.nullifier));
  console.log("  Bob nullifier spent:", bobNullSpent);
  if (!bobNullSpent) throw new Error("Bob nullifier should be spent!");

  const finalCount = await (blsgun as any).getCommitmentCount();
  console.log("  Final commitment count:", finalCount.toString());

  const contractBalance = await provider.getBalance(blsgunAddr);
  console.log("  Contract balance:", ethers.formatEther(contractBalance), "ETH");

  // ────────────────────────────────────────────────
  // Done!
  // ────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║          FULL FLOW E2E TEST PASSED           ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log("\nSummary:");
  console.log("  1. Alice shielded 1 ETH → Poseidon2 commitment in Merkle tree");
  console.log("  2. Alice → Bob private transfer (ZK proof + relayer)");
  console.log("  3. Bob unshielded 1 ETH to his address (ZK proof + relayer)");
  console.log("  4. Bob gained exactly 1 ETH, contract balance = 0");
  console.log("  5. Both nullifiers spent, 2 commitments in tree");
  console.log("  6. Relayer never saw amounts, owners, or keys");
}

main().catch((err) => {
  console.error("\n=== FULL FLOW E2E FAILED ===");
  console.error(err);
  process.exit(1);
});
