/**
 * BLSGun Key Generation — FROST t-of-n on Grumpkin
 *
 * Generates master spending key, splits into Shamir shares,
 * pre-computes FROST nonces, and derives viewing keys.
 * Threshold and total signers are configurable.
 */

import type {
  KeyShare,
  MasterKeyPackage,
  HierarchicalKeyPackage,
  NoncePair,
  SignerKeyMaterial,
} from "./types.js";
import {
  GRUMPKIN_ORDER,
  Fr,
  G,
  scalarMul,
  toAffine,
  randomScalar,
  modInverse,
  modMul,
  modAdd,
} from "./grumpkin.js";

// ─── Shamir Secret Sharing ────────────────────────────────────────────────────

/**
 * Split a secret into n shares with threshold t using Shamir's Secret Sharing.
 * Polynomial: S(x) = secret + c1*x + c2*x² + ... + c(t-1)*x^(t-1)
 * All arithmetic in Grumpkin's scalar field Fr.
 *
 * @param secret - The secret to split
 * @param t - Threshold (minimum shares needed to reconstruct)
 * @param n - Total number of shares
 * @returns Array of n shares evaluated at x = 1, 2, ..., n
 */
export function shamirSplit(secret: bigint, t: number, n: number): bigint[] {
  // Generate random polynomial coefficients [secret, c1, ..., c(t-1)]
  const coeffs: bigint[] = [Fr.create(secret)];
  for (let i = 1; i < t; i++) {
    coeffs.push(randomScalar());
  }

  // Evaluate polynomial at x = 1, 2, ..., n
  return Array.from({ length: n }, (_, idx) => {
    const x = BigInt(idx + 1);
    let result = 0n;
    let xPow = 1n; // x^0 = 1
    for (let i = 0; i < coeffs.length; i++) {
      result = Fr.add(result, Fr.mul(coeffs[i], xPow));
      xPow = Fr.mul(xPow, x);
    }
    return result;
  });
}

/**
 * Reconstruct a secret from t or more Shamir shares using Lagrange interpolation.
 * Evaluates the polynomial at x = 0.
 *
 * @param shares - Array of [index, share] pairs
 * @returns The reconstructed secret
 */
export function shamirReconstruct(shares: [bigint, bigint][]): bigint {
  let secret = 0n;

  for (let i = 0; i < shares.length; i++) {
    const [xi, yi] = shares[i];
    let num = 1n;
    let den = 1n;

    for (let j = 0; j < shares.length; j++) {
      if (i === j) continue;
      const [xj] = shares[j];
      // Lagrange basis: L_i(0) = prod(xj / (xj - xi)) for j != i
      num = Fr.mul(num, xj);
      den = Fr.mul(den, Fr.sub(xj, xi));
    }

    const lambda = Fr.mul(num, modInverse(den));
    secret = Fr.add(secret, Fr.mul(lambda, yi));
  }

  return secret;
}

// ─── Nonce Pre-computation ────────────────────────────────────────────────────

/**
 * Pre-compute FROST nonce pairs for a signer.
 * Each transaction consumes one nonce pair. Pre-computing enables 1-round signing.
 *
 * @param count - Number of nonce pairs to pre-compute
 * @returns Array of NoncePair objects
 */
export function precomputeNonces(count: number): NoncePair[] {
  return Array.from({ length: count }, () => {
    const d = randomScalar();
    const e = randomScalar();
    return {
      d,
      e,
      D: toAffine(scalarMul(G, d)),
      E: toAffine(scalarMul(G, e)),
    };
  });
}

// ─── Master Key Generation ────────────────────────────────────────────────────

/** Default number of pre-computed nonces per signer */
const DEFAULT_NONCE_COUNT = 100;

/**
 * Generate a complete FROST t-of-n key package on Grumpkin.
 *
 * This is a trusted dealer ceremony (suitable for hackathon).
 * In production, this would use FROST DKG (Distributed Key Generation).
 *
 * @param options - Configuration: threshold (t), totalSigners (n), nonceCount
 * @returns MasterKeyPackage with group public key, shares, and viewing key
 */
export function generateMasterKeyPackage(
  options: {
    threshold?: number;
    totalSigners?: number;
    nonceCount?: number;
  } | number = {}
): MasterKeyPackage {
  // Support legacy call: generateMasterKeyPackage(nonceCount)
  const opts = typeof options === "number"
    ? { nonceCount: options }
    : options;
  const threshold = opts.threshold ?? 2;
  const totalSigners = opts.totalSigners ?? 3;
  const nonceCount = opts.nonceCount ?? DEFAULT_NONCE_COUNT;

  if (threshold < 1 || threshold > totalSigners) {
    throw new Error(`Invalid threshold: need 1 <= t(${threshold}) <= n(${totalSigners})`);
  }

  // 1. Generate master spending secret
  const masterSk = randomScalar();

  // 2. Split into t-of-n Shamir shares
  const shareValues = shamirSplit(masterSk, threshold, totalSigners);

  // 3. Compute public keys
  const groupPublicKey = toAffine(scalarMul(G, masterSk));

  const shares: KeyShare[] = shareValues.map((secret, idx) => ({
    index: BigInt(idx + 1),
    rank: 0,
    secretShare: secret,
    publicShare: toAffine(scalarMul(G, secret)),
  }));

  // 4. Generate viewing key (separate from spending)
  const viewingSecretKey = randomScalar();
  const viewingPublicKey = toAffine(scalarMul(G, viewingSecretKey));

  return {
    threshold,
    groupPublicKey,
    shares,
    viewingSecretKey,
    viewingPublicKey,
  };
}

/**
 * Create SignerKeyMaterial for a specific signer from the master package.
 * All signers receive the full viewing key for balance scanning.
 *
 * @param pkg - The master key package
 * @param signerIndex - Which signer (0-based index into shares array)
 * @param nonceCount - Number of nonces to pre-compute
 * @returns Key material for the signer (includes viewing key)
 */
export function createSignerKeyMaterial(
  pkg: MasterKeyPackage,
  signerIndex: number,
  nonceCount: number = DEFAULT_NONCE_COUNT
): SignerKeyMaterial {
  return {
    share: pkg.shares[signerIndex],
    nonces: precomputeNonces(nonceCount),
    viewingKey: pkg.viewingSecretKey,
  };
}

// ─── Hierarchical Key Generation (Birkhoff) ──────────────────────────────────

/**
 * Evaluate the k-th derivative of a polynomial at point x.
 *
 * For f(x) = a_0 + a_1*x + ... + a_{t-1}*x^{t-1}:
 *   f^(k)(x) = sum_{j=k}^{t-1} falling_factorial(j, k) * a_j * x^{j-k}
 *
 * @param coeffs - Polynomial coefficients [a_0, a_1, ..., a_{t-1}]
 * @param x - Evaluation point
 * @param k - Derivative order (0 = value, 1 = first derivative, etc.)
 * @returns f^(k)(x) in Fr
 */
export function evaluateDerivative(coeffs: bigint[], x: bigint, k: number): bigint {
  let result = 0n;
  for (let j = k; j < coeffs.length; j++) {
    // falling_factorial(j, k) = j * (j-1) * ... * (j-k+1)
    let ff = 1n;
    for (let i = 0; i < k; i++) {
      ff = Fr.mul(ff, BigInt(j - i));
    }
    // x^{j-k}
    const exp = j - k;
    let xPow = 1n;
    for (let e = 0; e < exp; e++) {
      xPow = Fr.mul(xPow, x);
    }
    result = Fr.add(result, Fr.mul(Fr.mul(ff, coeffs[j]), xPow));
  }
  return result;
}

/**
 * Split a secret into hierarchical shares using derivative evaluations.
 *
 * Each signer gets f^(rank)(index), where rank determines the derivative order.
 * Rank 0 signers get f(x_i) (standard Shamir), rank 1 get f'(x_i), etc.
 *
 * @param secret - The secret to split (a_0)
 * @param threshold - Polynomial degree + 1
 * @param signers - Array of {index, rank} assignments
 * @returns Array of share values corresponding to each signer
 */
export function hierarchicalSplit(
  secret: bigint,
  threshold: number,
  signers: { index: number; rank: number }[]
): bigint[] {
  // Generate random polynomial: f(x) = secret + c1*x + ... + c_{t-1}*x^{t-1}
  const coeffs: bigint[] = [Fr.create(secret)];
  for (let i = 1; i < threshold; i++) {
    coeffs.push(randomScalar());
  }

  // Evaluate appropriate derivative at each signer's index
  return signers.map((s) => evaluateDerivative(coeffs, BigInt(s.index), s.rank));
}

/**
 * Generate a hierarchical FROST key package with rank assignments.
 *
 * Like generateMasterKeyPackage but assigns different derivative orders (ranks)
 * to different signers. Higher ranks (lower derivative order) have more authority.
 *
 * @param options - Configuration including signer rank assignments
 * @returns HierarchicalKeyPackage with ranked shares
 */
export function generateHierarchicalKeyPackage(options: {
  threshold: number;
  signers: { index: number; rank: number }[];
}): HierarchicalKeyPackage {
  const { threshold, signers } = options;

  if (threshold < 1) {
    throw new Error(`Invalid threshold: ${threshold}`);
  }

  for (const s of signers) {
    if (s.rank >= threshold) {
      throw new Error(
        `Signer ${s.index} has rank ${s.rank} >= threshold ${threshold}. ` +
        `Rank must be < threshold for the derivative to be nonzero.`
      );
    }
  }

  // 1. Generate master spending secret
  const masterSk = randomScalar();

  // 2. Split into hierarchical shares
  const shareValues = hierarchicalSplit(masterSk, threshold, signers);

  // 3. Compute public keys
  const groupPublicKey = toAffine(scalarMul(G, masterSk));

  const shares: KeyShare[] = shareValues.map((secret, idx) => ({
    index: BigInt(signers[idx].index),
    rank: signers[idx].rank,
    secretShare: secret,
    publicShare: toAffine(scalarMul(G, secret)),
  }));

  // 4. Generate viewing key
  const viewingSecretKey = randomScalar();
  const viewingPublicKey = toAffine(scalarMul(G, viewingSecretKey));

  return {
    threshold,
    groupPublicKey,
    shares,
    viewingSecretKey,
    viewingPublicKey,
    signerRanks: signers.map((s) => ({ index: BigInt(s.index), rank: s.rank })),
  };
}
