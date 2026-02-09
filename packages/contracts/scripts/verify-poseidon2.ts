/**
 * Verify that on-chain Poseidon2 (Poseidon2Raw.sol) matches SDK's poseidon2Hash2.
 *
 * Usage: bun run scripts/verify-poseidon2.ts
 * Requires a running hardhat node: bun run node
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
} from "viem";
import { hardhat } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { join } from "path";

// SDK imports
import { initHash, poseidon2Hash2 } from "../../sdk/src/index.ts";

const CONTRACTS_DIR = join(import.meta.dir, "..");
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

// MerkleTree ABI (just the parts we need)
const merkleTreeAbi = [
  {
    type: "function" as const,
    name: "zeroHashes" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "", type: "uint256" as const }],
    outputs: [{ name: "", type: "bytes32" as const }],
  },
  {
    type: "function" as const,
    name: "root" as const,
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ name: "", type: "bytes32" as const }],
  },
] as const;

async function main() {
  console.log("=== Poseidon2 Compatibility Verification ===\n");

  // Init SDK hash
  await initHash();

  // Test vectors: compute SDK hashes
  const testVectors = [
    { a: 0n, b: 0n },
    { a: 1n, b: 2n },
    { a: 42n, b: 123n },
    {
      a: 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefn,
      b: 0x0edcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321n,
    },
  ];

  console.log("SDK poseidon2Hash2 test vectors:");
  for (const { a, b } of testVectors) {
    const h = poseidon2Hash2(a, b);
    console.log(`  hash2(${a}, ${b}) = 0x${h.toString(16).padStart(64, "0")}`);
  }

  // Deploy MerkleTree to verify on-chain Poseidon2
  console.log("\nDeploying MerkleTree to verify on-chain Poseidon2...");
  const merkleArtifact = JSON.parse(
    readFileSync(
      join(CONTRACTS_DIR, "artifacts/contracts/MerkleTree.sol/MerkleTree.json"),
      "utf-8",
    ),
  );

  const deployHash = await walletClient.deployContract({
    abi: merkleArtifact.abi,
    bytecode: merkleArtifact.bytecode as Hex,
  });
  const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  const merkleAddr = deployReceipt.contractAddress!;
  console.log("  MerkleTree deployed to:", merkleAddr);

  // Compare zero hashes
  // SDK: zeroHashes[0] = 0, zeroHashes[1] = hash2(0, 0), zeroHashes[2] = hash2(zh1, zh1), ...
  const sdkZeroHashes: bigint[] = [0n];
  for (let i = 1; i <= 20; i++) {
    sdkZeroHashes.push(poseidon2Hash2(sdkZeroHashes[i - 1], sdkZeroHashes[i - 1]));
  }

  console.log("\nComparing zero hashes (SDK vs On-chain):");
  let allMatch = true;
  for (let i = 0; i <= 5; i++) {
    const onChain = await publicClient.readContract({
      address: merkleAddr,
      abi: merkleTreeAbi,
      functionName: "zeroHashes",
      args: [BigInt(i)],
    });
    const sdk = "0x" + sdkZeroHashes[i].toString(16).padStart(64, "0");
    const match = BigInt(onChain) === sdkZeroHashes[i];
    console.log(`  Level ${i}: ${match ? "MATCH" : "MISMATCH"}`);
    if (!match) {
      console.log(`    SDK:     ${sdk}`);
      console.log(`    On-chain: ${onChain}`);
      allMatch = false;
    }
  }

  // Compare roots (empty tree)
  const sdkRoot = sdkZeroHashes[20];
  const onChainRoot = await publicClient.readContract({
    address: merkleAddr,
    abi: merkleTreeAbi,
    functionName: "root",
  });
  const rootMatch = BigInt(onChainRoot) === sdkRoot;
  console.log(`\n  Empty tree root: ${rootMatch ? "MATCH" : "MISMATCH"}`);
  if (!rootMatch) {
    console.log(`    SDK:      0x${sdkRoot.toString(16).padStart(64, "0")}`);
    console.log(`    On-chain: ${onChainRoot}`);
  }

  if (allMatch && rootMatch) {
    console.log("\n=== ALL POSEIDON2 HASHES MATCH ===");
  } else {
    console.log("\n=== MISMATCH DETECTED - CHECK IMPLEMENTATION ===");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
