/**
 * BLSGun FROST t-of-n Threshold Signing on Grumpkin
 *
 * Implements FROST (Flexible Round-Optimized Schnorr Threshold) signing
 * per RFC 9591, adapted for the Grumpkin curve. With pre-computed nonces,
 * signing is effectively 1-round. Threshold is configurable.
 *
 * The resulting Schnorr signature (R, z) satisfies: [z]G = R + [c]PK_group
 * This is verified inside the Noir ZK circuit — nothing leaks on-chain.
 */

import { poseidon2Hash2, poseidon2Hash4 } from "./hash.js";
import type {
  FrostSignature,
  GrumpkinPoint,
  NoncePair,
  PartialSignature,
  SigningSession,
} from "./types.js";
import { birkhoffCoeff, type BirkhoffParticipant } from "./birkhoff.js";
import {
  Fr,
  G,
  ZERO,
  scalarMul,
  pointAdd,
  pointEqual,
  toAffine,
  fromAffine,
  modInverse,
  modMul,
  modAdd,
  type ProjectivePointType,
} from "./grumpkin.js";

// ─── Hash Functions ───────────────────────────────────────────────────────────

/**
 * Hash to scalar for FROST binding factor.
 * ρ_i = H("frost_binding", message, D_i, E_i, signer_index)
 *
 * Uses Poseidon hash (BN254-native) for ZK compatibility.
 */
function hashBinding(
  message: bigint,
  D: GrumpkinPoint,
  E: GrumpkinPoint,
  signerIndex: bigint
): bigint {
  // Chain two poseidon2 hashes to fold 5+ inputs through state-4 permutation
  // h1 = Poseidon2([message, D.x, D.y, E.x])
  // result = Poseidon2([h1, E.y, signerIndex, 0])
  const h1 = poseidon2Hash4(message, D.x, D.y, E.x);
  return poseidon2Hash4(h1, E.y, signerIndex, 0n);
}

/**
 * Hash to scalar for Schnorr challenge.
 * c = H("frost_challenge", R, PK_group, message)
 *
 * Must match the challenge computation in the Noir circuit exactly.
 */
export function hashChallenge(
  R: GrumpkinPoint,
  groupPubKey: GrumpkinPoint,
  message: bigint
): bigint {
  const c = poseidon2Hash4(R.x, R.y, groupPubKey.x, groupPubKey.y);
  return poseidon2Hash2(c, message);
}

// ─── Lagrange Coefficient ─────────────────────────────────────────────────────

/**
 * Compute Lagrange coefficient λ_i for interpolation at x=0.
 * λ_i = Π(j / (j - i)) for j in participants, j ≠ i
 *
 * All arithmetic in Grumpkin's scalar field Fr.
 */
export function lagrangeCoeff(i: bigint, participants: bigint[]): bigint {
  let num = 1n;
  let den = 1n;
  for (const j of participants) {
    if (i === j) continue;
    num = Fr.mul(num, j);
    den = Fr.mul(den, Fr.sub(j, i));
  }
  return Fr.mul(num, modInverse(den));
}

// ─── Signing Session ──────────────────────────────────────────────────────────

/**
 * Create a new FROST signing session.
 *
 * @param message - The transaction message hash M
 * @param participants - Signer indices participating (e.g., [1n, 2n])
 * @param groupPublicKey - The group public key PK_group
 * @param threshold - Minimum number of signers required (default: 2)
 * @returns A new signing session
 */
export function createSigningSession(
  message: bigint,
  participants: bigint[],
  groupPublicKey: GrumpkinPoint,
  threshold: number = 2
): SigningSession {
  if (participants.length < threshold) {
    throw new Error(
      `FROST requires at least ${threshold} participants, got ${participants.length}`
    );
  }
  return {
    message,
    participants,
    nonceCommitments: new Map(),
    partials: [],
    groupPublicKey,
  };
}

/**
 * Register a signer's nonce commitments for this session.
 * In pre-computed mode, each signer consumes their next available nonce pair.
 */
export function registerNonceCommitment(
  session: SigningSession,
  signerIndex: bigint,
  D: GrumpkinPoint,
  E: GrumpkinPoint
): void {
  session.nonceCommitments.set(signerIndex, { D, E });
}

// ─── Partial Signing ──────────────────────────────────────────────────────────

/**
 * Produce a FROST partial signature.
 *
 * Each signer calls this with their secret share and a consumed nonce pair.
 * The partial signature z_i can be aggregated with other partials.
 *
 * @param signerIndex - This signer's index
 * @param secretShare - This signer's Shamir share k_i
 * @param nonce - Pre-computed nonce pair (consumed after use)
 * @param session - The signing session with all nonce commitments
 * @returns Partial signature { z_i, R }
 */
export function frostPartialSign(
  signerIndex: bigint,
  secretShare: bigint,
  nonce: NoncePair,
  session: SigningSession
): PartialSignature {
  const { message, participants, nonceCommitments, groupPublicKey } = session;

  // Verify all participants have registered nonce commitments
  for (const p of participants) {
    if (!nonceCommitments.has(p)) {
      throw new Error(`Missing nonce commitment for signer ${p}`);
    }
  }

  // 1. Compute binding factor for this signer
  const rho_i = hashBinding(message, nonce.D, nonce.E, signerIndex);

  // 2. Compute group nonce commitment R = Σ(D_j + [ρ_j]E_j) for j in participants
  let R: ProjectivePointType = ZERO;
  for (const j of participants) {
    const { D, E } = nonceCommitments.get(j)!;
    const rho_j = hashBinding(message, D, E, j);
    const Ej_scaled = scalarMul(fromAffine(E), rho_j);
    const term = pointAdd(fromAffine(D), Ej_scaled);
    R = pointAdd(R, term);
  }

  // 3. Compute challenge c = H("frost_challenge", R, PK_group, message)
  const R_affine = toAffine(R);
  const c = hashChallenge(R_affine, groupPublicKey, message);

  // 4. Compute Lagrange coefficient λ_i
  const lambda_i = lagrangeCoeff(signerIndex, participants);

  // 5. Partial signature: z_i = d_i + ρ_i·e_i + λ_i·k_i·c (mod order)
  const z_i = Fr.add(
    Fr.add(nonce.d, Fr.mul(rho_i, nonce.e)),
    Fr.mul(Fr.mul(lambda_i, secretShare), c)
  );

  return { signerIndex, z_i, R: R_affine };
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

/**
 * Aggregate partial signatures into a final FROST Schnorr signature.
 *
 * @param partials - Partial signatures from t signers
 * @param threshold - Minimum number of partial signatures required (default: 2)
 * @returns Final signature (R, z) in standard Schnorr format
 */
export function frostAggregate(
  partials: PartialSignature[],
  threshold: number = 2
): FrostSignature {
  if (partials.length < threshold) {
    throw new Error(
      `Need at least ${threshold} partial signatures, got ${partials.length}`
    );
  }

  // All partials should have the same R
  const R = partials[0].R;
  for (let i = 1; i < partials.length; i++) {
    if (partials[i].R.x !== R.x || partials[i].R.y !== R.y) {
      throw new Error("Partial signatures have inconsistent R values");
    }
  }

  // z = Σ z_i
  const z = partials.reduce(
    (sum, p) => Fr.add(sum, p.z_i),
    0n
  );

  return { R, z };
}

// ─── Verification ─────────────────────────────────────────────────────────────

/**
 * Verify a FROST Schnorr signature.
 * Check: [z]G == R + [c]PK_group
 *
 * This is the same verification done inside the Noir ZK circuit.
 *
 * @param signature - The FROST signature (R, z)
 * @param message - The signed message hash
 * @param groupPubKey - The group public key
 * @returns true if signature is valid
 */
export function frostVerify(
  signature: FrostSignature,
  message: bigint,
  groupPubKey: GrumpkinPoint
): boolean {
  const { R, z } = signature;
  const c = hashChallenge(R, groupPubKey, message);

  // LHS = [z]G
  const lhs = scalarMul(G, z);

  // RHS = R + [c]PK
  const rhs = pointAdd(fromAffine(R), scalarMul(fromAffine(groupPubKey), c));

  return pointEqual(lhs, rhs);
}

// ─── Convenience: Full Sign Flow ──────────────────────────────────────────────

/**
 * Complete FROST signing flow for t-of-n.
 *
 * Takes t signers' key material and produces a valid Schnorr signature.
 * Handles session creation, nonce registration, partial signing, and aggregation.
 *
 * @param message - Transaction message hash
 * @param signers - Array of signers { index, secretShare, nonce } (length >= threshold)
 * @param groupPublicKey - The group public key
 * @param threshold - Minimum signers required (default: signers.length)
 * @returns Complete FROST signature
 */
export function frostSign(
  message: bigint,
  signers: { index: bigint; secretShare: bigint; nonce: NoncePair }[],
  groupPublicKey: GrumpkinPoint,
  threshold?: number
): FrostSignature;
/**
 * @deprecated Use the array form: frostSign(message, [signer1, signer2], groupPK)
 */
export function frostSign(
  message: bigint,
  signer1: { index: bigint; secretShare: bigint; nonce: NoncePair },
  signer2: { index: bigint; secretShare: bigint; nonce: NoncePair },
  groupPublicKey: GrumpkinPoint
): FrostSignature;
export function frostSign(
  message: bigint,
  signersOrSigner1: { index: bigint; secretShare: bigint; nonce: NoncePair }[] | { index: bigint; secretShare: bigint; nonce: NoncePair },
  groupPKOrSigner2: GrumpkinPoint | { index: bigint; secretShare: bigint; nonce: NoncePair },
  thresholdOrGroupPK?: number | GrumpkinPoint
): FrostSignature {
  // Detect legacy 2-arg form: frostSign(msg, signer1, signer2, groupPK)
  let signers: { index: bigint; secretShare: bigint; nonce: NoncePair }[];
  let groupPublicKey: GrumpkinPoint;
  let threshold: number;

  if (Array.isArray(signersOrSigner1)) {
    // New form: frostSign(message, signers[], groupPK, threshold?)
    signers = signersOrSigner1;
    groupPublicKey = groupPKOrSigner2 as GrumpkinPoint;
    threshold = (thresholdOrGroupPK as number | undefined) ?? signers.length;
  } else {
    // Legacy form: frostSign(message, signer1, signer2, groupPK)
    signers = [signersOrSigner1, groupPKOrSigner2 as { index: bigint; secretShare: bigint; nonce: NoncePair }];
    groupPublicKey = thresholdOrGroupPK as GrumpkinPoint;
    threshold = 2;
  }

  const participants = signers.map((s) => s.index);

  // Create session
  const session = createSigningSession(message, participants, groupPublicKey, threshold);

  // Register nonce commitments
  for (const signer of signers) {
    registerNonceCommitment(session, signer.index, signer.nonce.D, signer.nonce.E);
  }

  // Produce partial signatures
  const partials = signers.map((signer) =>
    frostPartialSign(signer.index, signer.secretShare, signer.nonce, session)
  );

  // Aggregate
  return frostAggregate(partials, threshold);
}

// ─── Hierarchical FROST Signing (Birkhoff) ──────────────────────────────────

/**
 * Produce a FROST partial signature using Birkhoff coefficients.
 *
 * Replaces Lagrange coefficient with Birkhoff coefficient for hierarchical signing.
 * The formula changes from:
 *   z_i = d_i + rho_i*e_i + lambda_i*k_i*c
 * to:
 *   z_i = d_i + rho_i*e_i + beta_i*k_i*c
 *
 * @param signerIndex - This signer's index
 * @param signerRank - This signer's rank (derivative order)
 * @param secretShare - This signer's share (f^(rank)(index))
 * @param nonce - Pre-computed nonce pair
 * @param session - The signing session (must have participantRanks set)
 * @param participants - All participants with their ranks
 * @returns Partial signature { z_i, R }
 */
export function frostHierarchicalPartialSign(
  signerIndex: bigint,
  signerRank: number,
  secretShare: bigint,
  nonce: NoncePair,
  session: SigningSession,
  participants: BirkhoffParticipant[]
): PartialSignature {
  const { message, nonceCommitments, groupPublicKey } = session;
  const participantIndices = participants.map((p) => p.index);

  // Verify all participants have registered nonce commitments
  for (const p of participantIndices) {
    if (!nonceCommitments.has(p)) {
      throw new Error(`Missing nonce commitment for signer ${p}`);
    }
  }

  // 1. Compute binding factor
  const rho_i = hashBinding(message, nonce.D, nonce.E, signerIndex);

  // 2. Compute group nonce R
  let R: ProjectivePointType = ZERO;
  for (const j of participantIndices) {
    const { D, E } = nonceCommitments.get(j)!;
    const rho_j = hashBinding(message, D, E, j);
    const Ej_scaled = scalarMul(fromAffine(E), rho_j);
    const term = pointAdd(fromAffine(D), Ej_scaled);
    R = pointAdd(R, term);
  }

  // 3. Compute challenge
  const R_affine = toAffine(R);
  const c = hashChallenge(R_affine, groupPublicKey, message);

  // 4. Compute Birkhoff coefficient (replaces Lagrange)
  const beta_i = birkhoffCoeff(signerIndex, signerRank, participants);

  // 5. Partial signature: z_i = d_i + rho_i*e_i + beta_i*k_i*c
  const z_i = Fr.add(
    Fr.add(nonce.d, Fr.mul(rho_i, nonce.e)),
    Fr.mul(Fr.mul(beta_i, secretShare), c)
  );

  return { signerIndex, z_i, R: R_affine };
}

/**
 * Complete hierarchical FROST signing flow.
 *
 * Uses Birkhoff interpolation instead of Lagrange for signers with ranks.
 * Produces the same signature format (R, z) that passes standard verification.
 *
 * @param message - Transaction message hash
 * @param signers - Array of signers with index, rank, secretShare, and nonce
 * @param groupPublicKey - The group public key
 * @param threshold - Minimum signers required
 * @returns Complete FROST signature
 * @throws If the signer set is not Birkhoff-poised
 */
export function frostHierarchicalSign(
  message: bigint,
  signers: { index: bigint; rank: number; secretShare: bigint; nonce: NoncePair }[],
  groupPublicKey: GrumpkinPoint,
  threshold: number
): FrostSignature {
  if (signers.length < threshold) {
    throw new Error(
      `Need at least ${threshold} signers, got ${signers.length}`
    );
  }

  const participants: BirkhoffParticipant[] = signers.map((s) => ({
    index: s.index,
    rank: s.rank,
  }));
  const participantIndices = signers.map((s) => s.index);

  // Create session with rank metadata
  const session = createSigningSession(message, participantIndices, groupPublicKey, threshold);
  session.participantRanks = new Map(signers.map((s) => [s.index, s.rank]));

  // Register nonce commitments
  for (const signer of signers) {
    registerNonceCommitment(session, signer.index, signer.nonce.D, signer.nonce.E);
  }

  // Produce partial signatures using Birkhoff coefficients
  const partials = signers.map((signer) =>
    frostHierarchicalPartialSign(
      signer.index,
      signer.rank,
      signer.secretShare,
      signer.nonce,
      session,
      participants
    )
  );

  // Aggregate
  return frostAggregate(partials, threshold);
}
