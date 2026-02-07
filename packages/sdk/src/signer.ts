/**
 * BLSGun FROST 2-of-3 Threshold Signing on Grumpkin
 *
 * Implements FROST (Flexible Round-Optimized Schnorr Threshold) signing
 * per RFC 9591, adapted for the Grumpkin curve. With pre-computed nonces,
 * signing is effectively 1-round.
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
 * @returns A new signing session
 */
export function createSigningSession(
  message: bigint,
  participants: bigint[],
  groupPublicKey: GrumpkinPoint
): SigningSession {
  if (participants.length < 2) {
    throw new Error("FROST requires at least 2 participants for 2-of-3");
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
 * @returns Final signature (R, z) in standard Schnorr format
 */
export function frostAggregate(partials: PartialSignature[]): FrostSignature {
  if (partials.length < 2) {
    throw new Error("Need at least 2 partial signatures for 2-of-3 FROST");
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
 * Complete FROST signing flow for 2-of-3.
 *
 * Takes two signers' key material and produces a valid Schnorr signature.
 * Handles session creation, nonce registration, partial signing, and aggregation.
 *
 * @param message - Transaction message hash
 * @param signer1 - First signer { index, secretShare, nonce }
 * @param signer2 - Second signer { index, secretShare, nonce }
 * @param groupPublicKey - The group public key
 * @returns Complete FROST signature
 */
export function frostSign(
  message: bigint,
  signer1: { index: bigint; secretShare: bigint; nonce: NoncePair },
  signer2: { index: bigint; secretShare: bigint; nonce: NoncePair },
  groupPublicKey: GrumpkinPoint
): FrostSignature {
  const participants = [signer1.index, signer2.index];

  // Create session
  const session = createSigningSession(message, participants, groupPublicKey);

  // Register nonce commitments
  registerNonceCommitment(session, signer1.index, signer1.nonce.D, signer1.nonce.E);
  registerNonceCommitment(session, signer2.index, signer2.nonce.D, signer2.nonce.E);

  // Produce partial signatures
  const partial1 = frostPartialSign(
    signer1.index,
    signer1.secretShare,
    signer1.nonce,
    session
  );
  const partial2 = frostPartialSign(
    signer2.index,
    signer2.secretShare,
    signer2.nonce,
    session
  );

  // Aggregate
  return frostAggregate([partial1, partial2]);
}
