import "./preload.js";
import { describe, test, expect } from "bun:test";
import {
  computeCommitment,
  computeNullifier,
  computeTransactionMessage,
  createNote,
  MerkleTree,
  verifyMerkleProof,
  buildTransaction,
  TREE_DEPTH,
} from "../src/transaction.js";
import { randomScalar } from "../src/grumpkin.js";

describe("Poseidon Commitments", () => {
  test("commitment is deterministic", () => {
    const owner = 123n;
    const amount = 50000n;
    const blinding = 456789n;

    const c1 = computeCommitment(owner, amount, blinding);
    const c2 = computeCommitment(owner, amount, blinding);

    expect(c1).toBe(c2);
  });

  test("different inputs → different commitments", () => {
    const c1 = computeCommitment(1n, 100n, 999n);
    const c2 = computeCommitment(1n, 101n, 999n);
    const c3 = computeCommitment(2n, 100n, 999n);

    expect(c1).not.toBe(c2);
    expect(c1).not.toBe(c3);
  });
});

describe("Nullifier Derivation", () => {
  test("nullifier is deterministic", () => {
    const keyHash = randomScalar();
    const leafIdx = 42n;

    const n1 = computeNullifier(keyHash, leafIdx);
    const n2 = computeNullifier(keyHash, leafIdx);

    expect(n1).toBe(n2);
  });

  test("different leaf indices → different nullifiers", () => {
    const keyHash = randomScalar();

    const n1 = computeNullifier(keyHash, 0n);
    const n2 = computeNullifier(keyHash, 1n);

    expect(n1).not.toBe(n2);
  });
});

describe("Transaction Message", () => {
  test("message hash is deterministic", () => {
    const nullifiers = [111n, 222n];
    const commitments = [333n, 444n];
    const fee = 1000n;
    const deadline = 999999n;

    const m1 = computeTransactionMessage(nullifiers, commitments, fee, deadline);
    const m2 = computeTransactionMessage(nullifiers, commitments, fee, deadline);

    expect(m1).toBe(m2);
  });

  test("different inputs → different messages", () => {
    const m1 = computeTransactionMessage([1n], [2n], 0n, 100n);
    const m2 = computeTransactionMessage([1n], [3n], 0n, 100n);

    expect(m1).not.toBe(m2);
  });
});

describe("Merkle Tree", () => {
  test("empty tree has valid root", () => {
    const tree = new MerkleTree(4); // small tree for testing
    expect(tree.root).toBeDefined();
    expect(tree.size).toBe(0);
  });

  test("insert and generate proof", () => {
    const tree = new MerkleTree(4);
    const commitment = computeCommitment(1n, 100n, 999n);

    const idx = tree.insert(commitment);
    expect(idx).toBe(0);
    expect(tree.size).toBe(1);

    const proof = tree.generateProof(0);
    expect(proof.pathElements.length).toBe(4);
    expect(proof.pathIndices.length).toBe(4);
  });

  test("Merkle proof verifies correctly", () => {
    const tree = new MerkleTree(4);
    const commitment = computeCommitment(1n, 100n, 999n);

    tree.insert(commitment);
    const proof = tree.generateProof(0);

    expect(verifyMerkleProof(commitment, proof)).toBe(true);
  });

  test("multiple insertions with valid proofs", () => {
    const tree = new MerkleTree(4);
    const commitments = [
      computeCommitment(1n, 100n, 111n),
      computeCommitment(2n, 200n, 222n),
      computeCommitment(3n, 300n, 333n),
    ];

    for (const c of commitments) {
      tree.insert(c);
    }

    // All proofs should verify
    for (let i = 0; i < commitments.length; i++) {
      const proof = tree.generateProof(i);
      expect(verifyMerkleProof(commitments[i], proof)).toBe(true);
    }
  });

  test("wrong leaf fails verification", () => {
    const tree = new MerkleTree(4);
    const commitment = computeCommitment(1n, 100n, 999n);
    tree.insert(commitment);

    const proof = tree.generateProof(0);
    const wrongLeaf = computeCommitment(1n, 101n, 999n);

    expect(verifyMerkleProof(wrongLeaf, proof)).toBe(false);
  });

  test("root changes after insertion", () => {
    const tree = new MerkleTree(4);
    const root1 = tree.root;

    tree.insert(computeCommitment(1n, 100n, 999n));
    const root2 = tree.root;

    expect(root1).not.toBe(root2);
  });
});

describe("Build Transaction", () => {
  test("builds valid unsigned transaction", () => {
    const spendingKeyHash = randomScalar();
    const inputNote = createNote(spendingKeyHash, "CFX", 50000n);
    const outputNote = createNote(randomScalar(), "CFX", 49000n);

    const tx = buildTransaction(
      spendingKeyHash,
      inputNote,
      0,
      outputNote,
      1000n,
      999999n
    );

    expect(tx.inputNullifiers.length).toBe(1);
    expect(tx.outputCommitments.length).toBe(1);
    expect(tx.fee).toBe(1000n);
    expect(tx.deadline).toBe(999999n);
    expect(tx.message).toBeDefined();
  });
});
