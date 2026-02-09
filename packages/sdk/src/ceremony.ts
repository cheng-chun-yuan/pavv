/**
 * BLSGun Distributed Key Ceremony
 *
 * Generator-based ceremony that yields one share at a time.
 * Master secret is zeroed immediately after splitting.
 * Each share is zeroed after the caller advances the generator.
 * Feldman VSS commitments allow offline share verification.
 */

import type { GrumpkinPoint } from "./types.js";
import {
  Fr,
  G,
  ZERO,
  scalarMul,
  pointAdd,
  toAffine,
  fromAffine,
  randomScalar,
  pointEqual,
} from "./grumpkin.js";
import { evaluateDerivative } from "./keygen.js";

// ── Types ──

export interface CeremonyConfig {
  threshold: number;
  totalSigners: number;
}

export interface CeremonyShare {
  index: bigint;
  secretShare: bigint;
  publicShare: GrumpkinPoint;
}

export interface CeremonyResult {
  groupPublicKey: GrumpkinPoint;
  viewingSecretKey: bigint;
  viewingPublicKey: GrumpkinPoint;
  polynomialCommitments: GrumpkinPoint[]; // Feldman VSS: [coeff_j]G
}

export interface HierarchicalCeremonyConfig {
  threshold: number;
  signers: { index: number; rank: number }[];
}

export interface HierarchicalCeremonyShare {
  index: bigint;
  rank: number;
  secretShare: bigint;
  publicShare: GrumpkinPoint;
}

// ── Memory clearing ──

/**
 * Overwrite a bigint property on an object with 0n.
 * This is a best-effort zeroing — JS GC may still hold old values,
 * but this prevents accidental reads from live references.
 */
export function clearSecret<T extends Record<string, unknown>>(
  obj: T,
  key: keyof T
): void {
  (obj as Record<string, unknown>)[key as string] = 0n;
}

// ── Shamir with coefficient export ──

/**
 * Split a secret into shares, returning both the shares and the polynomial
 * coefficients (needed for Feldman VSS commitments).
 */
function shamirSplitWithCoeffs(
  secret: bigint,
  t: number,
  n: number
): { shares: bigint[]; coeffs: bigint[] } {
  const coeffs: bigint[] = [Fr.create(secret)];
  for (let i = 1; i < t; i++) {
    coeffs.push(randomScalar());
  }

  const shares = Array.from({ length: n }, (_, idx) => {
    const x = BigInt(idx + 1);
    let result = 0n;
    let xPow = 1n;
    for (let i = 0; i < coeffs.length; i++) {
      result = Fr.add(result, Fr.mul(coeffs[i], xPow));
      xPow = Fr.mul(xPow, x);
    }
    return result;
  });

  return { shares, coeffs };
}

// ── Generator ceremony ──

/**
 * Generator-based distributed key ceremony.
 *
 * Yields one CeremonyShare at a time. After each `.next()` call,
 * the previously yielded share's secretShare has been zeroed.
 * Returns the CeremonyResult (group PK + viewing key + VSS commitments).
 *
 * Usage:
 *   const gen = distributedCeremony({ threshold: 2, totalSigners: 3 });
 *   const { value: share1 } = gen.next(); // share 1
 *   // ... signer 1 saves share1 ...
 *   const { value: share2 } = gen.next(); // share 2 (share1.secretShare now 0n)
 *   // ... signer 2 saves share2 ...
 *   const { value: share3 } = gen.next(); // share 3 (share2.secretShare now 0n)
 *   // ... signer 3 saves share3 ...
 *   const { value: result, done } = gen.next(); // done=true, result has group PK etc.
 */
export function* distributedCeremony(
  config: CeremonyConfig
): Generator<CeremonyShare, CeremonyResult, void> {
  const { threshold, totalSigners } = config;

  // 1. Generate master spending secret
  let masterSk = randomScalar();

  // 2. Split into shares, keeping polynomial coefficients for VSS
  const { shares: shareValues, coeffs } = shamirSplitWithCoeffs(
    masterSk,
    threshold,
    totalSigners
  );

  // 3. Compute group public key
  const groupPublicKey = toAffine(scalarMul(G, masterSk));

  // 4. Compute Feldman VSS polynomial commitments: C_j = [coeff_j]G
  const polynomialCommitments: GrumpkinPoint[] = coeffs.map((c) =>
    toAffine(scalarMul(G, c))
  );

  // 5. Zero the master secret — no longer needed
  masterSk = 0n;

  // 6. Generate viewing key (independent from spending key)
  const viewingSecretKey = randomScalar();
  const viewingPublicKey = toAffine(scalarMul(G, viewingSecretKey));

  // 7. Build share objects
  const ceremonyShares: CeremonyShare[] = shareValues.map((secret, idx) => ({
    index: BigInt(idx + 1),
    secretShare: secret,
    publicShare: toAffine(scalarMul(G, secret)),
  }));

  // 8. Zero polynomial coefficients — no longer needed
  for (let i = 0; i < coeffs.length; i++) {
    coeffs[i] = 0n;
  }

  // 9. Yield shares one at a time, zeroing previous after each advance
  let previousShare: CeremonyShare | null = null;

  for (const share of ceremonyShares) {
    if (previousShare) {
      previousShare.secretShare = 0n;
    }
    previousShare = share;
    yield share;
  }

  // Zero the last share
  if (previousShare) {
    previousShare.secretShare = 0n;
  }

  return {
    groupPublicKey,
    viewingSecretKey,
    viewingPublicKey,
    polynomialCommitments,
  };
}

// ── Feldman VSS Verification ──

/**
 * Verify a share against Feldman VSS polynomial commitments.
 *
 * Checks: [s_i]G == sum( i^j * C_j ) for j = 0..t-1
 *
 * @param share - The share to verify (index + secretShare)
 * @param commitments - Feldman VSS commitments C_j = [coeff_j]G
 * @returns true if the share is consistent with the commitments
 */
export function verifyShareAgainstCommitments(
  share: CeremonyShare,
  commitments: GrumpkinPoint[]
): boolean {
  // LHS: [s_i]G
  const lhs = scalarMul(G, share.secretShare);

  // RHS: sum( [i^j] * C_j )
  let rhs = ZERO;
  let iPow = 1n; // i^0 = 1
  const i = share.index;

  for (const commitment of commitments) {
    const cPoint = fromAffine(commitment);
    rhs = pointAdd(rhs, scalarMul(cPoint, iPow));
    iPow = Fr.mul(iPow, i);
  }

  return pointEqual(lhs, rhs);
}

// ── Hierarchical (Birkhoff) Ceremony ──

/**
 * Generator-based hierarchical key ceremony using Birkhoff interpolation.
 *
 * Each signer gets f^(rank)(index) — the rank-th derivative of the polynomial
 * evaluated at the signer's index. Rank 0 = standard Shamir, rank 1 = first
 * derivative, etc.
 *
 * Yields one HierarchicalCeremonyShare at a time with the same memory-zeroing
 * pattern as distributedCeremony.
 *
 * Returns CeremonyResult (group PK + viewing key + VSS commitments).
 */
export function* hierarchicalCeremony(
  config: HierarchicalCeremonyConfig
): Generator<HierarchicalCeremonyShare, CeremonyResult, void> {
  const { threshold, signers } = config;

  // Validate ranks
  for (const s of signers) {
    if (s.rank >= threshold) {
      throw new Error(
        `Signer ${s.index} has rank ${s.rank} >= threshold ${threshold}. ` +
        `Rank must be < threshold for the derivative to be nonzero.`
      );
    }
  }

  // 1. Generate master spending secret
  let masterSk = randomScalar();

  // 2. Build polynomial coefficients [masterSk, c1, ..., c_{t-1}]
  const coeffs: bigint[] = [Fr.create(masterSk)];
  for (let i = 1; i < threshold; i++) {
    coeffs.push(randomScalar());
  }

  // 3. Evaluate f^(rank)(index) for each signer
  const shareValues = signers.map((s) =>
    evaluateDerivative(coeffs, BigInt(s.index), s.rank)
  );

  // 4. Compute group public key
  const groupPublicKey = toAffine(scalarMul(G, masterSk));

  // 5. Compute Feldman VSS polynomial commitments: C_j = [coeff_j]G
  const polynomialCommitments: GrumpkinPoint[] = coeffs.map((c) =>
    toAffine(scalarMul(G, c))
  );

  // 6. Zero the master secret
  masterSk = 0n;

  // 7. Generate viewing key (independent from spending key)
  const viewingSecretKey = randomScalar();
  const viewingPublicKey = toAffine(scalarMul(G, viewingSecretKey));

  // 8. Build share objects
  const ceremonyShares: HierarchicalCeremonyShare[] = shareValues.map(
    (secret, idx) => ({
      index: BigInt(signers[idx].index),
      rank: signers[idx].rank,
      secretShare: secret,
      publicShare: toAffine(scalarMul(G, secret)),
    })
  );

  // 9. Zero polynomial coefficients
  for (let i = 0; i < coeffs.length; i++) {
    coeffs[i] = 0n;
  }

  // 10. Yield shares one at a time, zeroing previous after each advance
  let previousShare: HierarchicalCeremonyShare | null = null;

  for (const share of ceremonyShares) {
    if (previousShare) {
      previousShare.secretShare = 0n;
    }
    previousShare = share;
    yield share;
  }

  // Zero the last share
  if (previousShare) {
    previousShare.secretShare = 0n;
  }

  return {
    groupPublicKey,
    viewingSecretKey,
    viewingPublicKey,
    polynomialCommitments,
  };
}
