/**
 * BLSGun Viem E2E: Shield -> Scan -> Private Transfer -> Scan -> Unshield
 *
 * Full privacy lifecycle using viem (no ethers.js):
 *   1. Deploy contracts via viem walletClient
 *   2. Generate FROST 2-of-3 keys for Alice & Bob (with viewing keys)
 *   3. Shield: sender deposits CFX to Alice's stealth address
 *   4. Scan: find Alice's note with her viewing key
 *   5. Private Transfer: Alice -> Bob's stealth address (ZK proof)
 *   6. Scan: find Bob's note with his viewing key
 *   7. Unshield: Bob withdraws CFX to a public address
 *   8. Final assertions
 *
 * Usage:
 *   Terminal 1: cd packages/contracts && bun run node
 *   Terminal 2: cd packages/contracts && bun run test:viem-e2e
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  getContractAddress as getCreateAddress,
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
  randomScalar,
  type CircuitInputs,
  type MasterKeyPackage,
  type GrumpkinPoint,
} from "../../sdk/src/index.ts";

import {
  generateStealthAddress,
  checkStealthAddress,
  createStealthMetaAddress,
} from "../../sdk/src/stealth.ts";

// -- Config --

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const MASK_128 = (1n << 128n) - 1n;

// Hardhat default account #0 private key
const DEPLOYER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
// Hardhat default account #1 for recipient
const RECIPIENT_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

// -- Paths --

const CONTRACTS_DIR = resolve(import.meta.dir, "..");
const CIRCUITS_DIR = resolve(CONTRACTS_DIR, "../circuits");
const TARGET_DIR = join(CIRCUITS_DIR, "target");
const ARTIFACTS_DIR = join(CONTRACTS_DIR, "artifacts/contracts");

// -- Clients --

const publicClient = createPublicClient({
  chain: hardhat,
  transport: http(RPC_URL),
});

const deployerAccount = privateKeyToAccount(DEPLOYER_PK);
const recipientAccount = privateKeyToAccount(RECIPIENT_PK);

const walletClient = createWalletClient({
  account: deployerAccount,
  chain: hardhat,
  transport: http(RPC_URL),
});

const recipientWalletClient = createWalletClient({
  account: recipientAccount,
  chain: hardhat,
  transport: http(RPC_URL),
});

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

function generateProofAndInputs(
  inputs: CircuitInputs,
): { proofBytes: Hex; publicInputs: Hex[] } {
  if (!existsSync(TARGET_DIR)) {
    mkdirSync(TARGET_DIR, { recursive: true });
  }

  writeFileSync(join(CIRCUITS_DIR, "Prover.toml"), toProverToml(inputs));

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

  const publicInputs: Hex[] = [];
  for (let i = 0; i < piData.length / 32; i++) {
    publicInputs.push(("0x" + Buffer.from(piData.slice(i * 32, (i + 1) * 32)).toString("hex")) as Hex);
  }

  return {
    proofBytes: ("0x" + Buffer.from(proofData).toString("hex")) as Hex,
    publicInputs,
  };
}

// -- BLSGun ABI (viem format) --

const blsGunAbi = [
  {
    type: "event" as const,
    name: "Shield" as const,
    inputs: [
      { name: "sender", type: "address" as const, indexed: true },
      { name: "commitment", type: "bytes32" as const, indexed: true },
      { name: "ephPubKeyX", type: "bytes32" as const, indexed: false },
      { name: "ephPubKeyY", type: "bytes32" as const, indexed: false },
      { name: "viewTag", type: "uint8" as const, indexed: false },
      { name: "encryptedAmount", type: "uint128" as const, indexed: false },
    ],
  },
  {
    type: "event" as const,
    name: "PrivateTransfer" as const,
    inputs: [
      { name: "nullifier", type: "bytes32" as const, indexed: true },
      { name: "outputCommitment", type: "bytes32" as const, indexed: true },
      { name: "ephPubKeyX", type: "bytes32" as const, indexed: false },
      { name: "ephPubKeyY", type: "bytes32" as const, indexed: false },
      { name: "viewTag", type: "uint8" as const, indexed: false },
      { name: "encryptedAmount", type: "uint128" as const, indexed: false },
    ],
  },
  {
    type: "event" as const,
    name: "Unshield" as const,
    inputs: [
      { name: "nullifier", type: "bytes32" as const, indexed: true },
      { name: "recipient", type: "address" as const, indexed: true },
      { name: "amount", type: "uint256" as const, indexed: false },
    ],
  },
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
  {
    type: "function" as const,
    name: "unshield" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "nullifier", type: "bytes32" as const },
      { name: "inputCommitment", type: "bytes32" as const },
      { name: "recipient", type: "address" as const },
      { name: "amount", type: "uint256" as const },
      { name: "proof", type: "bytes" as const },
    ],
    outputs: [],
  },
  {
    type: "function" as const,
    name: "isNullifierSpent" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "nullifier", type: "bytes32" as const }],
    outputs: [{ name: "", type: "bool" as const }],
  },
  {
    type: "function" as const,
    name: "getMerkleRoot" as const,
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ name: "", type: "bytes32" as const }],
  },
  {
    type: "function" as const,
    name: "getCommitmentCount" as const,
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ name: "", type: "uint256" as const }],
  },
] as const;

// -- Deploy --

async function deploy(): Promise<Address> {
  // 1. Deploy ZKTranscriptLib
  const transcriptArtifact = loadArtifact("Verifier.sol/ZKTranscriptLib.json");
  const libHash = await walletClient.deployContract({
    abi: transcriptArtifact.abi,
    bytecode: transcriptArtifact.bytecode as Hex,
  });
  const libReceipt = await publicClient.waitForTransactionReceipt({ hash: libHash });
  const libAddr = libReceipt.contractAddress!;
  console.log("  ZKTranscriptLib:", libAddr);

  // 2. Deploy HonkVerifier (linked with ZKTranscriptLib)
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
  console.log("  HonkVerifier:", verifierAddr);

  // 3. Deploy BLSGun
  const blsgunArtifact = loadArtifact("BLSGun.sol/BLSGun.json");
  const blsgunHash = await walletClient.deployContract({
    abi: blsgunArtifact.abi,
    bytecode: blsgunArtifact.bytecode as Hex,
    args: [verifierAddr],
  });
  const blsgunReceipt = await publicClient.waitForTransactionReceipt({ hash: blsgunHash });
  const blsgunAddr = blsgunReceipt.contractAddress!;
  console.log("  BLSGun:", blsgunAddr);

  return blsgunAddr;
}

// -- Build stealth spend proof --

function buildStealthSpendProof(
  pkg: MasterKeyPackage,
  signerIdxA: number,
  signerIdxB: number,
  nonceIdx: number,
  stealthScalar: bigint,
  stealthPubKey: GrumpkinPoint,
  noteAmount: bigint,
  noteBlinding: bigint,
  commitment: bigint,
  leafIndex: number,
  tree: InstanceType<typeof MerkleTree>,
) {
  const spendingKeyHash = poseidon2Hash2(stealthPubKey.x, stealthPubKey.y);
  const merkleProof = tree.generateProof(leafIndex);
  const nullifier = computeNullifier(spendingKeyHash, BigInt(leafIndex));
  const message = poseidon2Hash2(nullifier, commitment);

  const sA = createSignerKeyMaterial(pkg, signerIdxA, nonceIdx + 1);
  const sB = createSignerKeyMaterial(pkg, signerIdxB, nonceIdx + 1);

  // Adjust shares by stealth scalar (Shamir linearity)
  const adjustedShareA = Fr.add(sA.share.secretShare, stealthScalar);
  const adjustedShareB = Fr.add(sB.share.secretShare, stealthScalar);

  const sig = frostSign(
    message,
    [
      { index: sA.share.index, secretShare: adjustedShareA, nonce: sA.nonces[nonceIdx] },
      { index: sB.share.index, secretShare: adjustedShareB, nonce: sB.nonces[nonceIdx] },
    ],
    stealthPubKey,
    pkg.threshold,
  );

  if (!frostVerify(sig, message, stealthPubKey)) {
    throw new Error("FROST verify failed for stealth-adjusted key");
  }
  console.log("    FROST signature valid for stealth key!");

  const circuitInputs = buildCircuitInputs(
    sig, stealthPubKey, spendingKeyHash, noteAmount, noteBlinding,
    merkleProof, nullifier, commitment,
  );

  const { proofBytes, publicInputs } = generateProofAndInputs(circuitInputs);

  // Sanity checks
  if (BigInt(publicInputs[0]) !== nullifier) throw new Error("PI nullifier mismatch");
  if (BigInt(publicInputs[1]) !== commitment) throw new Error("PI commitment mismatch");
  if (BigInt(publicInputs[2]) !== merkleProof.root) throw new Error("PI root mismatch");

  return { nullifier, proofBytes, publicInputs, spendingKeyHash };
}

// -- Main --

async function main() {
  console.log("+==============================================+");
  console.log("|  BLSGun Viem E2E: Full Privacy Flow         |");
  console.log("|  Shield -> Scan -> Transfer -> Scan -> Unshield |");
  console.log("+==============================================+\n");

  console.log("RPC:", RPC_URL);
  console.log("Deployer:", deployerAccount.address);
  console.log("Recipient:", recipientAccount.address);

  await initHash();

  // -- Step 1: Deploy contracts --
  console.log("\n[Step 1] Deploy contracts");
  const blsgunAddr = await deploy();

  const tree = new MerkleTree(20);

  // -- Step 2: Generate FROST keys + viewing keys --
  console.log("\n[Step 2] Generate FROST 2-of-3 keys for Alice & Bob");

  const alicePkg = generateMasterKeyPackage({ threshold: 2, totalSigners: 3, nonceCount: 10 });
  const aliceViewingSk = alicePkg.viewingSecretKey;
  const aliceViewingPk = alicePkg.viewingPublicKey;
  console.log("  Alice group PK:", toBytes32(alicePkg.groupPublicKey.x).slice(0, 22) + "...");
  console.log("  Alice viewing PK:", toBytes32(aliceViewingPk.x).slice(0, 22) + "...");

  const aliceMeta = createStealthMetaAddress(alicePkg.groupPublicKey, aliceViewingPk);

  const bobPkg = generateMasterKeyPackage({ threshold: 2, totalSigners: 3, nonceCount: 10 });
  const bobViewingSk = bobPkg.viewingSecretKey;
  const bobViewingPk = bobPkg.viewingPublicKey;
  console.log("  Bob group PK:", toBytes32(bobPkg.groupPublicKey.x).slice(0, 22) + "...");
  console.log("  Bob viewing PK:", toBytes32(bobViewingPk.x).slice(0, 22) + "...");

  const bobMeta = createStealthMetaAddress(bobPkg.groupPublicKey, bobViewingPk);

  // -- Step 3: Shield -- sender deposits CFX to Alice's stealth address --
  console.log("\n[Step 3] Shield: sender deposits 1 CFX to Alice's stealth address");

  const aliceStealth = generateStealthAddress(aliceMeta);
  console.log("  Stealth PK:", toBytes32(aliceStealth.address.x).slice(0, 22) + "...");
  console.log("  Ephemeral PK:", toBytes32(aliceStealth.ephemeralPublicKey.x).slice(0, 22) + "...");
  console.log("  View tag:", "0x" + aliceStealth.viewTag.toString(16));

  const aliceStealthKeyHash = poseidon2Hash2(aliceStealth.address.x, aliceStealth.address.y);
  const shieldAmount = 1000000n;
  const shieldBlinding = randomScalar();
  const aliceCommitment = computeCommitment(aliceStealthKeyHash, shieldAmount, shieldBlinding);
  console.log("  Commitment:", toBytes32(aliceCommitment).slice(0, 22) + "...");

  const aliceEncryptedAmount = shieldAmount ^ (aliceStealth.stealthScalar & MASK_128);
  const aliceLeafIdx = tree.insert(aliceCommitment);

  const shieldHash = await walletClient.writeContract({
    address: blsgunAddr,
    abi: blsGunAbi,
    functionName: "shield",
    args: [
      toBytes32(aliceCommitment),
      toBytes32(aliceStealth.ephemeralPublicKey.x),
      toBytes32(aliceStealth.ephemeralPublicKey.y),
      Number(aliceStealth.viewTag),
      aliceEncryptedAmount,
    ],
    value: parseEther("1"),
  });
  const shieldReceipt = await publicClient.waitForTransactionReceipt({ hash: shieldHash });
  console.log("  Tx:", shieldReceipt.transactionHash);
  console.log("  Gas:", shieldReceipt.gasUsed.toString());

  // Verify Merkle root
  const rootAfterShield = await publicClient.readContract({
    address: blsgunAddr,
    abi: blsGunAbi,
    functionName: "getMerkleRoot",
  });
  if (BigInt(rootAfterShield) !== tree.root) {
    throw new Error("Merkle root mismatch after shield");
  }
  console.log("  Merkle root verified!");

  // Verify Shield event emitted
  const shieldLogs = await publicClient.getLogs({
    address: blsgunAddr,
    event: blsGunAbi[0], // Shield event
    fromBlock: shieldReceipt.blockNumber,
    toBlock: shieldReceipt.blockNumber,
  });
  if (shieldLogs.length !== 1) throw new Error(`Expected 1 Shield event, got ${shieldLogs.length}`);
  console.log("  Shield event emitted!");

  // -- Step 4: Scan chain with Alice's viewing key --
  console.log("\n[Step 4] Scan chain with Alice's viewing key");

  const allShieldLogs = await publicClient.getLogs({
    address: blsgunAddr,
    event: blsGunAbi[0],
    fromBlock: 0n,
  });
  console.log("  Found", allShieldLogs.length, "Shield event(s)");

  let foundAliceNote = false;
  let recoveredStealthScalar = 0n;
  let recoveredAmount = 0n;

  for (const log of allShieldLogs) {
    const { ephPubKeyX, ephPubKeyY, viewTag, encryptedAmount } = log.args;
    const ephX = BigInt(ephPubKeyX!);
    const ephY = BigInt(ephPubKeyY!);

    if (ephX === 0n) continue;

    const scalar = checkStealthAddress({ x: ephX, y: ephY }, BigInt(viewTag!), aliceViewingSk);
    if (scalar === null) {
      console.log("  Event viewTag mismatch, skipping");
      continue;
    }

    recoveredStealthScalar = scalar;
    recoveredAmount = BigInt(encryptedAmount!) ^ (scalar & MASK_128);
    foundAliceNote = true;

    console.log("  MATCH! Alice's note found on-chain!");
    console.log("  Decrypted amount:", recoveredAmount.toString());
  }

  if (!foundAliceNote) throw new Error("Alice's note not found on chain!");
  if (recoveredAmount !== shieldAmount) {
    throw new Error(`Amount mismatch: expected ${shieldAmount}, got ${recoveredAmount}`);
  }
  console.log("  Amount verified: matches original", shieldAmount.toString());

  // -- Step 5: Private Transfer -- Alice -> Bob --
  console.log("\n[Step 5] Private Transfer: Alice -> Bob (stealth + ZK proof)");

  const bobStealth = generateStealthAddress(bobMeta);
  console.log("  Bob stealth PK:", toBytes32(bobStealth.address.x).slice(0, 22) + "...");

  const bobStealthKeyHash = poseidon2Hash2(bobStealth.address.x, bobStealth.address.y);
  const transferAmount = shieldAmount;
  const bobBlinding = randomScalar();
  const bobCommitment = computeCommitment(bobStealthKeyHash, transferAmount, bobBlinding);
  console.log("  Bob output commitment:", toBytes32(bobCommitment).slice(0, 22) + "...");

  const bobEncryptedAmount = transferAmount ^ (bobStealth.stealthScalar & MASK_128);

  console.log("  Generating ZK proof for Alice's stealth note...");
  const aliceSpend = buildStealthSpendProof(
    alicePkg, 0, 1, 0,
    recoveredStealthScalar,
    aliceStealth.address,
    shieldAmount, shieldBlinding,
    aliceCommitment, aliceLeafIdx, tree,
  );
  console.log("  Proof generated!");

  console.log("  Submitting privateTransfer...");
  const transferHash = await walletClient.writeContract({
    address: blsgunAddr,
    abi: blsGunAbi,
    functionName: "privateTransfer",
    args: [
      toBytes32(aliceSpend.nullifier),
      toBytes32(aliceCommitment),
      toBytes32(bobCommitment),
      aliceSpend.proofBytes,
      toBytes32(bobStealth.ephemeralPublicKey.x),
      toBytes32(bobStealth.ephemeralPublicKey.y),
      Number(bobStealth.viewTag),
      bobEncryptedAmount,
    ],
  });
  const transferReceipt = await publicClient.waitForTransactionReceipt({ hash: transferHash });
  console.log("  Tx:", transferReceipt.transactionHash);
  console.log("  Gas:", transferReceipt.gasUsed.toString());

  tree.insert(bobCommitment);
  const bobLeafIdx = 1;

  // Verify nullifier spent
  const aliceNullSpent = await publicClient.readContract({
    address: blsgunAddr,
    abi: blsGunAbi,
    functionName: "isNullifierSpent",
    args: [toBytes32(aliceSpend.nullifier)],
  });
  console.log("  Alice nullifier spent:", aliceNullSpent);
  if (!aliceNullSpent) throw new Error("Alice nullifier should be spent!");

  // Verify Merkle root
  const rootAfterTransfer = await publicClient.readContract({
    address: blsgunAddr,
    abi: blsGunAbi,
    functionName: "getMerkleRoot",
  });
  if (BigInt(rootAfterTransfer) !== tree.root) {
    throw new Error("Merkle root mismatch after transfer");
  }
  console.log("  Merkle root verified!");

  // Verify PrivateTransfer event
  const transferLogs = await publicClient.getLogs({
    address: blsgunAddr,
    event: blsGunAbi[1], // PrivateTransfer event
    fromBlock: transferReceipt.blockNumber,
    toBlock: transferReceipt.blockNumber,
  });
  if (transferLogs.length !== 1) throw new Error(`Expected 1 PrivateTransfer event, got ${transferLogs.length}`);
  console.log("  PrivateTransfer event emitted!");

  // -- Step 6: Scan chain with Bob's viewing key --
  console.log("\n[Step 6] Scan chain with Bob's viewing key");

  const allTransferLogs = await publicClient.getLogs({
    address: blsgunAddr,
    event: blsGunAbi[1],
    fromBlock: 0n,
  });
  console.log("  Found", allTransferLogs.length, "PrivateTransfer event(s)");

  let foundBobNote = false;
  let bobRecoveredScalar = 0n;
  let bobRecoveredAmount = 0n;

  for (const log of allTransferLogs) {
    const { ephPubKeyX, ephPubKeyY, viewTag, encryptedAmount } = log.args;
    const ephX = BigInt(ephPubKeyX!);
    const ephY = BigInt(ephPubKeyY!);

    if (ephX === 0n) continue;

    const scalar = checkStealthAddress({ x: ephX, y: ephY }, BigInt(viewTag!), bobViewingSk);
    if (scalar === null) {
      console.log("  Event viewTag mismatch for Bob, skipping");
      continue;
    }

    bobRecoveredScalar = scalar;
    bobRecoveredAmount = BigInt(encryptedAmount!) ^ (scalar & MASK_128);
    foundBobNote = true;

    console.log("  MATCH! Bob's note found on-chain!");
    console.log("  Decrypted amount:", bobRecoveredAmount.toString());
  }

  if (!foundBobNote) throw new Error("Bob's note not found on chain!");
  if (bobRecoveredAmount !== transferAmount) {
    throw new Error(`Bob amount mismatch: expected ${transferAmount}, got ${bobRecoveredAmount}`);
  }
  console.log("  Amount verified: matches transfer amount", transferAmount.toString());

  // -- Step 7: Unshield -- Bob withdraws to public address --
  console.log("\n[Step 7] Unshield: Bob withdraws 1 CFX to recipient address");

  const recipientAddress = recipientAccount.address;
  const recipientBalanceBefore = await publicClient.getBalance({ address: recipientAddress });
  console.log("  Recipient:", recipientAddress);
  console.log("  Balance before:", formatEther(recipientBalanceBefore));

  console.log("  Generating ZK proof for Bob's stealth note...");
  const bobSpend = buildStealthSpendProof(
    bobPkg, 0, 1, 0,
    bobRecoveredScalar,
    bobStealth.address,
    transferAmount, bobBlinding,
    bobCommitment, bobLeafIdx, tree,
  );
  console.log("  Proof generated!");

  console.log("  Submitting unshield...");
  const unshieldHash = await walletClient.writeContract({
    address: blsgunAddr,
    abi: blsGunAbi,
    functionName: "unshield",
    args: [
      toBytes32(bobSpend.nullifier),
      toBytes32(bobCommitment),
      recipientAddress,
      parseEther("1"),
      bobSpend.proofBytes,
    ],
  });
  const unshieldReceipt = await publicClient.waitForTransactionReceipt({ hash: unshieldHash });
  console.log("  Tx:", unshieldReceipt.transactionHash);
  console.log("  Gas:", unshieldReceipt.gasUsed.toString());

  // Verify Bob's nullifier spent
  const bobNullSpent = await publicClient.readContract({
    address: blsgunAddr,
    abi: blsGunAbi,
    functionName: "isNullifierSpent",
    args: [toBytes32(bobSpend.nullifier)],
  });
  console.log("  Bob nullifier spent:", bobNullSpent);
  if (!bobNullSpent) throw new Error("Bob nullifier should be spent!");

  // Verify recipient received CFX
  const recipientBalanceAfter = await publicClient.getBalance({ address: recipientAddress });
  const gained = recipientBalanceAfter - recipientBalanceBefore;
  console.log("  Recipient balance after:", formatEther(recipientBalanceAfter));
  console.log("  Recipient gained:", formatEther(gained), "CFX");
  if (gained !== parseEther("1")) {
    throw new Error(`Recipient should gain exactly 1 CFX, got ${formatEther(gained)}`);
  }

  // Verify Unshield event
  const unshieldLogs = await publicClient.getLogs({
    address: blsgunAddr,
    event: blsGunAbi[2], // Unshield event
    fromBlock: unshieldReceipt.blockNumber,
    toBlock: unshieldReceipt.blockNumber,
  });
  if (unshieldLogs.length !== 1) throw new Error(`Expected 1 Unshield event, got ${unshieldLogs.length}`);
  console.log("  Unshield event emitted!");

  // -- Step 8: Final assertions --
  console.log("\n[Step 8] Final assertions");

  const finalCount = await publicClient.readContract({
    address: blsgunAddr,
    abi: blsGunAbi,
    functionName: "getCommitmentCount",
  });
  console.log("  Commitments in tree:", finalCount.toString());
  if (finalCount !== 2n) throw new Error(`Expected 2 commitments, got ${finalCount}`);

  const contractBalance = await publicClient.getBalance({ address: blsgunAddr });
  console.log("  Contract balance:", formatEther(contractBalance), "CFX");
  if (contractBalance !== 0n) throw new Error(`Contract should be drained, balance: ${formatEther(contractBalance)}`);

  // Both nullifiers spent
  const nullifier1Spent = await publicClient.readContract({
    address: blsgunAddr,
    abi: blsGunAbi,
    functionName: "isNullifierSpent",
    args: [toBytes32(aliceSpend.nullifier)],
  });
  const nullifier2Spent = await publicClient.readContract({
    address: blsgunAddr,
    abi: blsGunAbi,
    functionName: "isNullifierSpent",
    args: [toBytes32(bobSpend.nullifier)],
  });
  if (!nullifier1Spent || !nullifier2Spent) throw new Error("Both nullifiers should be spent!");
  console.log("  Both nullifiers spent: true");

  // -- Done! --
  console.log("\n+==============================================+");
  console.log("|      VIEM E2E TEST PASSED!                  |");
  console.log("+==============================================+");
  console.log("\nSummary:");
  console.log("  1. Deployed HonkVerifier + BLSGun (viem deployContract)");
  console.log("  2. Generated FROST 2-of-3 keys for Alice & Bob (with viewing keys)");
  console.log("  3. Shielded 1 CFX to Alice's stealth address (viem writeContract)");
  console.log("  4. Scanned chain with Alice's viewing key (viem getLogs) -> found & decrypted note");
  console.log("  5. Private transfer: Alice -> Bob's stealth address (ZK proof via viem)");
  console.log("  6. Scanned chain with Bob's viewing key (viem getLogs) -> found & decrypted note");
  console.log("  7. Bob unshielded 1 CFX to recipient address (viem writeContract)");
  console.log("  8. All assertions passed: 2 commitments, contract drained, both nullifiers spent");
}

main().catch((err) => {
  console.error("\n=== VIEM E2E FAILED ===");
  console.error(err);
  process.exit(1);
});
