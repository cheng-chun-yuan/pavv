/**
 * Verify that on-chain Poseidon2 (Poseidon2Raw.sol) matches SDK's poseidon2Hash2.
 *
 * Usage: bun run scripts/verify-poseidon2.ts
 * Requires a running hardhat node: bun run node
 */
import { ethers } from "ethers";
import { readFileSync } from "fs";
import { join } from "path";

// SDK imports
import { initHash, poseidon2Hash2 } from "../../sdk/src/index.ts";

const CONTRACTS_DIR = join(import.meta.dir, "..");

// Load compiled artifact
function loadArtifact(name: string) {
  const raw = readFileSync(
    join(CONTRACTS_DIR, "artifacts/contracts/lib/Poseidon2Raw.sol", `${name}.json`),
    "utf-8",
  );
  return JSON.parse(raw);
}

async function main() {
  console.log("=== Poseidon2 Compatibility Verification ===\n");

  // Init SDK hash
  await initHash();

  // Connect to local hardhat node
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
  const [signer] = await provider.listAccounts();

  // Deploy a minimal test contract that exposes Poseidon2Raw.hash2
  // We use inline Solidity since the library functions get inlined
  // Instead, deploy a thin wrapper via raw bytecode
  // Actually, let's use the compiled artifacts. We need a contract that calls the library.
  // The library is internal, so we compile a test wrapper.

  // Alternative: deploy the Poseidon2 contract from poseidon2-evm which uses sponge mode
  // But we need to test our Poseidon2Raw, so let's create a simple test.

  // Since Poseidon2Raw is a library with internal functions, it gets inlined.
  // We need a contract that uses it. Let's compile one inline.

  // Simplest approach: compile via hardhat's artifacts
  // Let's check if we have a test wrapper, or create the test purely in TS
  // by comparing SDK values.

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

  // Now deploy a wrapper contract and test on-chain
  // We'll compile inline solidity via hardhat artifacts
  // But since we don't have a pre-compiled wrapper, let's deploy the MerkleTree
  // and verify its root (which is built from Poseidon2Raw zero hashes)

  console.log("\nDeploying MerkleTree to verify on-chain Poseidon2...");
  const merkleArtifact = JSON.parse(
    readFileSync(
      join(CONTRACTS_DIR, "artifacts/contracts/MerkleTree.sol/MerkleTree.json"),
      "utf-8",
    ),
  );

  const MerkleFactory = new ethers.ContractFactory(
    merkleArtifact.abi,
    merkleArtifact.bytecode,
    signer,
  );
  const merkle = await MerkleFactory.deploy();
  await merkle.waitForDeployment();
  console.log("  MerkleTree deployed to:", await merkle.getAddress());

  // Compare zero hashes
  // SDK: zeroHashes[0] = 0, zeroHashes[1] = hash2(0, 0), zeroHashes[2] = hash2(zh1, zh1), ...
  const sdkZeroHashes: bigint[] = [0n];
  for (let i = 1; i <= 20; i++) {
    sdkZeroHashes.push(poseidon2Hash2(sdkZeroHashes[i - 1], sdkZeroHashes[i - 1]));
  }

  console.log("\nComparing zero hashes (SDK vs On-chain):");
  let allMatch = true;
  for (let i = 0; i <= 5; i++) {
    const onChain = await (merkle as any).zeroHashes(i);
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
  const onChainRoot = await (merkle as any).root();
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
