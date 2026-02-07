/**
 * BLSGun Transaction Construction
 *
 * UTXO-based private transactions with Poseidon commitments,
 * nullifier derivation, and Merkle tree management.
 */

import { poseidon2Hash2, poseidon2Hash3 } from "./hash.js";
import type {
  Note,
  CommitmentLeaf,
  MerkleProof,
  UnsignedTransaction,
  CircuitInputs,
  FrostSignature,
  GrumpkinPoint,
} from "./types.js";
import { randomScalar, GRUMPKIN_ORDER } from "./grumpkin.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Merkle tree depth (supports 2^20 = ~1M notes) */
export const TREE_DEPTH = 20;

/** Zero value for empty tree leaves */
const ZERO_VALUE = 0n;

// ─── Commitment & Nullifier ───────────────────────────────────────────────────

/**
 * Compute a Poseidon commitment for a note.
 * commitment = Poseidon(owner, amount, blinding)
 *
 * This hides the note contents on-chain while allowing ZK proofs.
 */
export function computeCommitment(
  owner: bigint,
  amount: bigint,
  blinding: bigint
): bigint {
  return poseidon2Hash3(owner, amount, blinding);
}

/**
 * Compute a nullifier for a spent note.
 * nullifier = Poseidon(spendingKeyHash, leafIndex)
 *
 * The nullifier is unique per note and prevents double-spending.
 */
export function computeNullifier(
  spendingKeyHash: bigint,
  leafIndex: bigint
): bigint {
  return poseidon2Hash2(spendingKeyHash, leafIndex);
}

/**
 * Compute the transaction message M to be signed by FROST.
 * M = Poseidon(nullifiers || commitments || fee || deadline)
 */
export function computeTransactionMessage(
  inputNullifiers: bigint[],
  outputCommitments: bigint[],
  fee: bigint,
  deadline: bigint
): bigint {
  // Chain hash: fold all inputs into a single hash
  let h = poseidon2Hash2(fee, deadline);
  for (const n of inputNullifiers) {
    h = poseidon2Hash2(h, n);
  }
  for (const c of outputCommitments) {
    h = poseidon2Hash2(h, c);
  }
  return h;
}

// ─── Note Construction ────────────────────────────────────────────────────────

/**
 * Create a new note with random blinding factor.
 */
export function createNote(
  owner: bigint,
  asset: string,
  amount: bigint
): Note {
  return {
    owner,
    asset,
    amount,
    blinding: randomScalar(),
  };
}

// ─── Incremental Merkle Tree ──────────────────────────────────────────────────

/**
 * Incremental Merkle Tree for commitment storage.
 *
 * Uses Poseidon hashing. Pre-computes zero hashes for empty subtrees.
 * This mirrors the on-chain MerkleTree.sol contract.
 */
export class MerkleTree {
  readonly depth: number;
  readonly zeroHashes: bigint[];
  private leaves: bigint[] = [];
  private layers: bigint[][] = [];

  constructor(depth: number = TREE_DEPTH) {
    this.depth = depth;

    // Pre-compute zero hashes: zeroHashes[i] = hash of empty subtree at level i
    this.zeroHashes = new Array(depth + 1);
    this.zeroHashes[0] = ZERO_VALUE;
    for (let i = 1; i <= depth; i++) {
      this.zeroHashes[i] = poseidon2Hash2(
        this.zeroHashes[i - 1],
        this.zeroHashes[i - 1],
      );
    }

    // Initialize layers
    this.layers = Array.from({ length: depth + 1 }, () => []);
  }

  /** Current number of leaves */
  get size(): number {
    return this.leaves.length;
  }

  /** Current Merkle root */
  get root(): bigint {
    if (this.leaves.length === 0) return this.zeroHashes[this.depth];
    return this._computeRoot();
  }

  /**
   * Insert a new leaf (commitment) into the tree.
   * @returns The leaf index
   */
  insert(leaf: bigint): number {
    const index = this.leaves.length;
    if (index >= 2 ** this.depth) {
      throw new Error("Merkle tree is full");
    }
    this.leaves.push(leaf);
    return index;
  }

  /**
   * Generate a Merkle proof for a leaf at the given index.
   */
  generateProof(leafIndex: number): MerkleProof {
    if (leafIndex >= this.leaves.length) {
      throw new Error(`Leaf index ${leafIndex} out of bounds`);
    }

    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];

    // Build full tree layers
    let currentLayer = [...this.leaves];

    // Pad to power of 2 with zero values
    const layerSize = 2 ** this.depth;
    while (currentLayer.length < layerSize) {
      currentLayer.push(ZERO_VALUE);
    }

    let idx = leafIndex;
    for (let level = 0; level < this.depth; level++) {
      const isRight = idx % 2;
      const siblingIdx = isRight ? idx - 1 : idx + 1;

      pathIndices.push(isRight);
      pathElements.push(
        siblingIdx < currentLayer.length
          ? currentLayer[siblingIdx]
          : this.zeroHashes[level]
      );

      // Compute next layer
      const nextLayer: bigint[] = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i];
        const right =
          i + 1 < currentLayer.length
            ? currentLayer[i + 1]
            : this.zeroHashes[level];
        nextLayer.push(poseidon2Hash2(left, right));
      }
      currentLayer = nextLayer;
      idx = Math.floor(idx / 2);
    }

    return {
      pathElements,
      pathIndices,
      root: currentLayer[0],
    };
  }

  /** Recompute root from current leaves */
  private _computeRoot(): bigint {
    let currentLayer = [...this.leaves];
    const layerSize = 2 ** this.depth;
    while (currentLayer.length < layerSize) {
      currentLayer.push(ZERO_VALUE);
    }

    for (let level = 0; level < this.depth; level++) {
      const nextLayer: bigint[] = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i];
        const right =
          i + 1 < currentLayer.length
            ? currentLayer[i + 1]
            : this.zeroHashes[level];
        nextLayer.push(poseidon2Hash2(left, right));
      }
      currentLayer = nextLayer;
    }

    return currentLayer[0];
  }
}

/**
 * Verify a Merkle proof.
 */
export function verifyMerkleProof(
  leaf: bigint,
  proof: MerkleProof
): boolean {
  let current = leaf;
  for (let i = 0; i < proof.pathElements.length; i++) {
    if (proof.pathIndices[i] === 0) {
      current = poseidon2Hash2(current, proof.pathElements[i]);
    } else {
      current = poseidon2Hash2(proof.pathElements[i], current);
    }
  }
  return current === proof.root;
}

// ─── Transaction Building ─────────────────────────────────────────────────────

/**
 * Build an unsigned transaction for a private transfer.
 *
 * @param spendingKeyHash - Hash of the sender's spending key
 * @param inputNote - The note being spent
 * @param inputLeafIndex - Merkle leaf index of the input note
 * @param outputNote - The new note being created (for recipient)
 * @param fee - Transaction fee
 * @param deadline - Block deadline for the transaction
 * @returns Unsigned transaction ready for FROST signing
 */
export function buildTransaction(
  spendingKeyHash: bigint,
  inputNote: Note,
  inputLeafIndex: number,
  outputNote: Note,
  fee: bigint,
  deadline: bigint
): UnsignedTransaction {
  const nullifier = computeNullifier(spendingKeyHash, BigInt(inputLeafIndex));
  const outputCommitment = computeCommitment(
    outputNote.owner,
    outputNote.amount,
    outputNote.blinding
  );

  const inputNullifiers = [nullifier];
  const outputCommitments = [outputCommitment];
  const message = computeTransactionMessage(
    inputNullifiers,
    outputCommitments,
    fee,
    deadline
  );

  return {
    inputNullifiers,
    outputCommitments,
    fee,
    deadline,
    message,
  };
}

// ─── Circuit Witness Generation ───────────────────────────────────────────────

/**
 * Generate circuit inputs (Prover.toml format) for the Noir ZK proof.
 */
export function buildCircuitInputs(
  signature: FrostSignature,
  groupPubKey: GrumpkinPoint,
  spendingKeyHash: bigint,
  noteAmount: bigint,
  noteBlinding: bigint,
  merkleProof: MerkleProof,
  nullifier: bigint,
  commitment: bigint
): CircuitInputs {
  // Pad merkle proof to TREE_DEPTH
  const pathElements = [...merkleProof.pathElements];
  const pathIndices = [...merkleProof.pathIndices];
  while (pathElements.length < TREE_DEPTH) {
    pathElements.push(0n);
    pathIndices.push(0);
  }

  return {
    signature_R_x: `0x${signature.R.x.toString(16)}`,
    signature_R_y: `0x${signature.R.y.toString(16)}`,
    signature_z: `0x${signature.z.toString(16)}`,
    group_pubkey_x: `0x${groupPubKey.x.toString(16)}`,
    group_pubkey_y: `0x${groupPubKey.y.toString(16)}`,
    spending_key_hash: `0x${spendingKeyHash.toString(16)}`,
    note_amount: `0x${noteAmount.toString(16)}`,
    note_blinding: `0x${noteBlinding.toString(16)}`,
    merkle_path: pathElements.map((e) => `0x${e.toString(16)}`),
    merkle_indices: pathIndices.map((i) => `0x${i.toString(16)}`),
    nullifier: `0x${nullifier.toString(16)}`,
    commitment: `0x${commitment.toString(16)}`,
    merkle_root: `0x${merkleProof.root.toString(16)}`,
  };
}
