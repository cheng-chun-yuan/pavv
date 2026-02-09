/**
 * FROST threshold signing helpers for the browser frontend.
 *
 * Provides deterministic nonce derivation, partial signature computation,
 * and aggregation + proof generation for the three-login signing flow.
 */

import { initHash, poseidon2Hash2 } from "@blsgun/sdk/hash";
import {
  G,
  Fr,
  scalarMul,
  pointAdd,
  toAffine,
  fromAffine,
} from "@blsgun/sdk/grumpkin";
import {
  createSigningSession,
  registerNonceCommitment,
  frostPartialSign,
  frostHierarchicalPartialSign,
  frostAggregate,
  frostVerify,
} from "@blsgun/sdk/signer";
import {
  computeNullifier,
  computeCommitment,
  buildCircuitInputs,
} from "@blsgun/sdk/transaction";
import type {
  GrumpkinPoint,
  NoncePair,
  PartialSignature,
  FrostSignature,
  SigningSession,
  MerkleProof,
} from "@blsgun/sdk/types";
import { MerkleTree } from "@blsgun/sdk/transaction";
import { generateBrowserProof, initProver } from "./prover";

// ─── Deterministic Nonce Derivation ──────────────────────────────────────────

/**
 * Derive deterministic FROST nonces from a signer's secret share and payment ID.
 *
 * This allows signers to re-derive their nonces across login sessions
 * without needing to store nonce private keys.
 *
 * d = poseidon2Hash2(secretShare, poseidon2Hash2(paymentIdBigint, 0n))
 * e = poseidon2Hash2(secretShare, poseidon2Hash2(paymentIdBigint, 1n))
 */
export function deriveNonces(
  secretShareHex: string,
  paymentId: string
): NoncePair {
  const secretShare = BigInt(secretShareHex);
  // Hash paymentId to a field element
  // Payment ID is a UUID string - hash its numeric representation
  const paymentIdBigint = BigInt("0x" + paymentId.replace(/-/g, ""));

  const dSeed = poseidon2Hash2(paymentIdBigint, 0n);
  const eSeed = poseidon2Hash2(paymentIdBigint, 1n);

  const d = poseidon2Hash2(secretShare, dSeed);
  const e = poseidon2Hash2(secretShare, eSeed);

  const D = toAffine(scalarMul(G, d));
  const E = toAffine(scalarMul(G, e));

  return { d, e, D, E };
}

// ─── Partial Signature Computation ──────────────────────────────────────────

export interface ComputePartialSigParams {
  signerIndex: number;
  secretShareHex: string;
  stealthScalar: bigint;
  paymentId: string;
  message: bigint;
  allNonceCommitments: Record<string, { Dx: string; Dy: string; Ex: string; Ey: string }>;
  participants: bigint[];
  groupPubKey: GrumpkinPoint;
  threshold: number;
  // HTSS (Birkhoff) mode fields
  mode?: "TSS" | "HTSS";
  signerRank?: number;
  /** Map of signer index (string) -> rank */
  participantRanks?: Record<string, number>;
}

/**
 * Compute a FROST partial signature with stealth-adjusted share.
 *
 * For TSS (Lagrange): every signer adds stealthScalar to their share.
 *   sum(lambda_i * (share_i + s)) = secret + s * sum(lambda_i) = secret + s  (since sum(lambda_i) = 1)
 *
 * For HTSS (Birkhoff): only rank-0 signers add stealthScalar.
 *   The stealth shift is a constant added to the polynomial. The k-th derivative
 *   of a constant is 0 for k >= 1, so rank-1+ shares are unchanged.
 *   sum(beta_i * adjusted_i) = secret + s * sum_{rank=0}(beta_i) = secret + s  (since sum_{rank=0}(beta_i) = 1)
 */
export function computePartialSig(params: ComputePartialSigParams): {
  z_i: bigint;
  R: GrumpkinPoint;
} {
  const {
    signerIndex,
    secretShareHex,
    stealthScalar,
    paymentId,
    message,
    allNonceCommitments,
    participants,
    groupPubKey,
    threshold,
    mode = "TSS",
    signerRank = 0,
    participantRanks,
  } = params;

  const secretShare = BigInt(secretShareHex);
  const isHTSS = mode === "HTSS";

  // Adjust secret share with stealth scalar.
  // For HTSS: only rank-0 signers add it (derivative of constant = 0 for rank >= 1).
  const shouldAddStealth = !isHTSS || signerRank === 0;
  const adjustedShare = shouldAddStealth
    ? Fr.add(secretShare, stealthScalar)
    : secretShare;

  // Derive deterministic nonces
  const nonce = deriveNonces(secretShareHex, paymentId);

  // Compute stealth-adjusted group public key: PK_stealth = PK_group + [stealthScalar]G
  const stealthGroupPK = toAffine(
    pointAdd(fromAffine(groupPubKey), scalarMul(G, stealthScalar))
  );

  // Build signing session with stealth-adjusted key
  const session: SigningSession = {
    message,
    participants,
    nonceCommitments: new Map(),
    partials: [],
    groupPublicKey: stealthGroupPK,
  };

  // Register all nonce commitments
  for (const [idxStr, nc] of Object.entries(allNonceCommitments)) {
    const idx = BigInt(idxStr);
    registerNonceCommitment(session, idx, {
      x: BigInt(nc.Dx),
      y: BigInt(nc.Dy),
    }, {
      x: BigInt(nc.Ex),
      y: BigInt(nc.Ey),
    });
  }

  // Compute partial signature using the appropriate algorithm
  if (isHTSS && participantRanks) {
    // Birkhoff coefficients for HTSS
    const birkhoffParticipants = participants.map((idx) => ({
      index: idx,
      rank: participantRanks[idx.toString()] ?? 0,
    }));

    session.participantRanks = new Map(
      birkhoffParticipants.map((p) => [p.index, p.rank])
    );

    const partial = frostHierarchicalPartialSign(
      BigInt(signerIndex),
      signerRank,
      adjustedShare,
      nonce,
      session,
      birkhoffParticipants
    );
    return { z_i: partial.z_i, R: partial.R };
  }

  // Standard Lagrange for TSS
  const partial = frostPartialSign(
    BigInt(signerIndex),
    adjustedShare,
    nonce,
    session
  );

  return { z_i: partial.z_i, R: partial.R };
}

// ─── Aggregation + Proof Generation ─────────────────────────────────────────

export interface AggregateAndProveParams {
  partialSigs: Record<string, { z_i: string; Rx: string; Ry: string }>;
  message: bigint;
  groupPubKey: GrumpkinPoint;
  stealthScalar: bigint;
  spendingKeyHash: bigint;
  noteAmount: bigint;
  noteBlinding: bigint;
  leafIndex: number;
  inputCommitment: bigint;
  merkleTree: MerkleTree;
  threshold: number;
  onProgress?: (step: "aggregating" | "proving") => Promise<void> | void;
}

/**
 * Aggregate partial signatures, build circuit inputs, and generate browser proof.
 */
export async function aggregateAndProve(
  params: AggregateAndProveParams
): Promise<{ proofHex: string; nullifier: bigint; merkleRoot: bigint }> {
  const {
    partialSigs,
    message,
    groupPubKey,
    stealthScalar,
    spendingKeyHash,
    noteAmount,
    noteBlinding,
    leafIndex,
    inputCommitment,
    merkleTree,
    threshold,
    onProgress,
  } = params;

  // 1. Aggregate partial signatures
  console.log("[aggregateAndProve] aggregating", Object.keys(partialSigs).length, "partial sigs");
  await onProgress?.("aggregating");
  const partials: PartialSignature[] = Object.entries(partialSigs).map(
    ([idxStr, ps]) => ({
      signerIndex: BigInt(idxStr),
      z_i: BigInt(ps.z_i),
      R: { x: BigInt(ps.Rx), y: BigInt(ps.Ry) },
    })
  );

  const signature = frostAggregate(partials, threshold);
  console.log("[aggregateAndProve] signature aggregated, z=", signature.z.toString().slice(0, 20) + "...");

  // 2. Adjust group public key for stealth
  const stealthGroupPK = toAffine(
    pointAdd(fromAffine(groupPubKey), scalarMul(G, stealthScalar))
  );
  console.log("[aggregateAndProve] stealth group PK computed");

  // 3. Verify signature locally before proving
  const valid = frostVerify(signature, message, stealthGroupPK);
  console.log("[aggregateAndProve] signature valid =", valid);
  if (!valid) {
    throw new Error("FROST signature verification failed before proving");
  }

  // 4. Compute nullifier
  const nullifier = computeNullifier(spendingKeyHash, BigInt(leafIndex));
  console.log("[aggregateAndProve] nullifier =", nullifier.toString().slice(0, 20) + "...");

  // 5. Generate Merkle proof
  console.log("[aggregateAndProve] generating merkle proof for leafIndex=", leafIndex, "treeSize=", merkleTree.leaves.length);
  const merkleProof = merkleTree.generateProof(leafIndex);
  console.log("[aggregateAndProve] merkle proof generated, root =", merkleProof.root.toString().slice(0, 20) + "...");

  // 6. Build circuit inputs
  console.log("[aggregateAndProve] building circuit inputs...");
  const circuitInputs = buildCircuitInputs(
    signature,
    stealthGroupPK,
    spendingKeyHash,
    noteAmount,
    noteBlinding,
    merkleProof,
    nullifier,
    inputCommitment
  );
  console.log("[aggregateAndProve] circuit inputs built, keys:", Object.keys(circuitInputs).join(", "));

  // 7. Initialize prover and generate proof
  console.log("[aggregateAndProve] initializing prover...");
  await onProgress?.("proving");
  const t0 = performance.now();
  await initProver();
  console.log(`[aggregateAndProve] prover init done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  console.log("[aggregateAndProve] generating proof (this may take a while)...");
  const t1 = performance.now();
  const { proof } = await generateBrowserProof(circuitInputs);
  console.log(`[aggregateAndProve] proof generated in ${((performance.now() - t1) / 1000).toFixed(1)}s, size=${proof.length} bytes`);

  // 8. Convert proof to hex string for contract call
  const proofHex = "0x" + Array.from(proof).map(b => b.toString(16).padStart(2, "0")).join("");

  return {
    proofHex,
    nullifier,
    merkleRoot: merkleProof.root,
  };
}
