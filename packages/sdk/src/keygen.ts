/**
 * BLSGun Key Generation — FROST 2-of-3 on Grumpkin
 *
 * Generates master spending key, splits into Shamir shares,
 * pre-computes FROST nonces, and derives viewing keys.
 */

import type {
  KeyShare,
  MasterKeyPackage,
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
 * Generate a complete FROST 2-of-3 key package on Grumpkin.
 *
 * This is a trusted dealer ceremony (suitable for hackathon).
 * In production, this would use FROST DKG (Distributed Key Generation).
 *
 * @param nonceCount - Number of nonces to pre-compute per signer
 * @returns MasterKeyPackage with group public key, shares, and viewing key
 */
export function generateMasterKeyPackage(
  nonceCount: number = DEFAULT_NONCE_COUNT
): MasterKeyPackage {
  // 1. Generate master spending secret
  const masterSk = randomScalar();

  // 2. Split into 2-of-3 Shamir shares
  const shareValues = shamirSplit(masterSk, 2, 3);

  // 3. Compute public keys
  const groupPublicKey = toAffine(scalarMul(G, masterSk));

  const shares: KeyShare[] = shareValues.map((secret, idx) => ({
    index: BigInt(idx + 1),
    secretShare: secret,
    publicShare: toAffine(scalarMul(G, secret)),
  }));

  // 4. Generate viewing key (separate from spending)
  const viewingSecretKey = randomScalar();
  const viewingPublicKey = toAffine(scalarMul(G, viewingSecretKey));

  return {
    groupPublicKey,
    shares,
    viewingSecretKey,
    viewingPublicKey,
  };
}

/**
 * Create SignerKeyMaterial for a specific signer from the master package.
 *
 * @param pkg - The master key package
 * @param signerIndex - Which signer (0, 1, or 2)
 * @param nonceCount - Number of nonces to pre-compute
 * @returns Key material for the signer
 */
export function createSignerKeyMaterial(
  pkg: MasterKeyPackage,
  signerIndex: number,
  nonceCount: number = DEFAULT_NONCE_COUNT
): SignerKeyMaterial {
  return {
    share: pkg.shares[signerIndex],
    nonces: precomputeNonces(nonceCount),
  };
}
