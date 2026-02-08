/**
 * Birkhoff Interpolation for Hierarchical Threshold Signature Scheme (HTSS)
 *
 * Generalizes Lagrange interpolation by assigning each signer a derivative order (rank):
 *   - Rank 0: holds f(x_i)   — standard evaluation (highest authority)
 *   - Rank 1: holds f'(x_i)  — first derivative
 *   - Rank 2: holds f''(x_i) — second derivative
 *
 * Any t signers can reconstruct the secret if their Birkhoff matrix is invertible (poised).
 * Higher-ranked signers are more powerful — fewer are needed to form a valid signing set.
 *
 * All arithmetic is in Grumpkin's scalar field Fr.
 */

import { Fr, modInverse } from "./grumpkin.js";

/** Participant descriptor for Birkhoff interpolation */
export interface BirkhoffParticipant {
  index: bigint;  // Evaluation point x_i (must be nonzero)
  rank: number;   // Derivative order k_i (0 = value, 1 = first derivative, etc.)
}

/**
 * Compute falling factorial: n * (n-1) * ... * (n-k+1)
 * falling_factorial(n, 0) = 1
 * falling_factorial(n, k) = n!/(n-k)!
 *
 * All arithmetic in Fr.
 */
export function fallingFactorial(n: number, k: number): bigint {
  if (k === 0) return 1n;
  if (k < 0 || n < k) return 0n;
  let result = 1n;
  for (let i = 0; i < k; i++) {
    result = Fr.mul(result, BigInt(n - i));
  }
  return result;
}

/**
 * Build the Birkhoff matrix B for a set of participants.
 *
 * For polynomial f(x) = a_0 + a_1*x + ... + a_{t-1}*x^{t-1}:
 *   B[i][j] = falling_factorial(j, k_i) * x_i^{j - k_i}   if j >= k_i
 *           = 0                                              if j < k_i
 *
 * The matrix is t x t where t = participants.length.
 *
 * @param participants - Array of {index, rank} for each participant
 * @returns t x t matrix of bigint values in Fr
 */
export function buildBirkhoffMatrix(participants: BirkhoffParticipant[]): bigint[][] {
  const t = participants.length;
  const matrix: bigint[][] = [];

  for (let i = 0; i < t; i++) {
    const { index: xi, rank: ki } = participants[i];
    const row: bigint[] = [];

    for (let j = 0; j < t; j++) {
      if (j < ki) {
        row.push(0n);
      } else {
        // B[i][j] = falling_factorial(j, ki) * xi^(j - ki)
        const ff = fallingFactorial(j, ki);
        const exp = j - ki;
        let xPow = 1n;
        for (let e = 0; e < exp; e++) {
          xPow = Fr.mul(xPow, xi);
        }
        row.push(Fr.mul(ff, xPow));
      }
    }

    matrix.push(row);
  }

  return matrix;
}

/**
 * Solve a linear system Ax = b over Fr using Gauss-Jordan elimination.
 *
 * @param matrix - t x t coefficient matrix (will be copied, not mutated)
 * @param vector - t-element right-hand side vector
 * @returns Solution vector x, or null if matrix is singular
 */
export function gaussianEliminate(matrix: bigint[][], vector: bigint[]): bigint[] | null {
  const t = matrix.length;

  // Create augmented matrix [A | b]
  const aug: bigint[][] = matrix.map((row, i) => [...row, vector[i]]);

  // Forward elimination with partial pivoting
  for (let col = 0; col < t; col++) {
    // Find pivot row
    let pivotRow = -1;
    for (let row = col; row < t; row++) {
      if (aug[row][col] !== 0n) {
        pivotRow = row;
        break;
      }
    }
    if (pivotRow === -1) return null; // Singular

    // Swap rows
    if (pivotRow !== col) {
      [aug[col], aug[pivotRow]] = [aug[pivotRow], aug[col]];
    }

    // Scale pivot row so pivot = 1
    const pivotInv = modInverse(aug[col][col]);
    for (let j = col; j <= t; j++) {
      aug[col][j] = Fr.mul(aug[col][j], pivotInv);
    }

    // Eliminate column in all other rows
    for (let row = 0; row < t; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      if (factor === 0n) continue;
      for (let j = col; j <= t; j++) {
        aug[row][j] = Fr.sub(aug[row][j], Fr.mul(factor, aug[col][j]));
      }
    }
  }

  // Extract solution (last column of augmented matrix)
  return aug.map((row) => row[t]);
}

/**
 * Check if a Birkhoff configuration is "poised" (matrix is invertible).
 *
 * @param participants - Array of {index, rank} for each participant
 * @returns true if the Birkhoff matrix is invertible
 */
export function isBirkhoffPoised(participants: BirkhoffParticipant[]): boolean {
  const matrix = buildBirkhoffMatrix(participants);
  // Try to solve a dummy system — if it returns non-null, matrix is invertible
  const identity = participants.map((_, i) => (i === 0 ? 1n : 0n));
  return gaussianEliminate(matrix, identity) !== null;
}

/**
 * Compute the Birkhoff coefficient beta_i for a specific signer.
 * This replaces the Lagrange coefficient lambda_i in FROST signing.
 *
 * beta_i is the weight such that: a_0 = sum(beta_i * share_i)
 * where a_0 is the secret (constant term of the polynomial).
 *
 * @param signerIndex - The index of the signer whose coefficient to compute
 * @param signerRank - The rank of the signer
 * @param participants - All participants in this signing session
 * @returns The Birkhoff coefficient beta_i
 * @throws If the Birkhoff matrix is not invertible
 */
export function birkhoffCoeff(
  signerIndex: bigint,
  signerRank: number,
  participants: BirkhoffParticipant[]
): bigint {
  const matrix = buildBirkhoffMatrix(participants);
  const t = participants.length;

  // We want B_inv[0], i.e., the first row of the inverse.
  // This is equivalent to solving B^T * x = e_0 where e_0 = [1, 0, ..., 0]
  // But more directly: solve B * x = e_0 to get x = B_inv[0]^T... no.
  //
  // Actually: a_0 = sum_i (B_inv[0][i] * share_i)
  // So beta_i = B_inv[0][i], the i-th element of the first row of B_inv.
  //
  // To get row 0 of B_inv, we solve B^T * y = e_0.
  // Because (B_inv)[0][i] = (B_inv)^T[i][0], and B^T * B_inv^T = I,
  // so column 0 of B_inv^T = (B^T)^{-1} * e_0.
  //
  // Alternatively, solve B * x_j = e_j for each j to get B_inv column by column.
  // We only need row 0, so we need all columns' 0th element.
  //
  // Simplest: solve B * x = e_i for each i, beta_i = x[0].
  // But that's t solves. Better: transpose approach.
  //
  // B_inv[0] = solution of B^T * y = e_0
  // Then beta_i = y[i]

  // Transpose B
  const BT: bigint[][] = Array.from({ length: t }, (_, i) =>
    Array.from({ length: t }, (_, j) => matrix[j][i])
  );

  const e0 = Array.from({ length: t }, (_, i) => (i === 0 ? 1n : 0n));
  const y = gaussianEliminate(BT, e0);
  if (y === null) {
    throw new Error("Birkhoff matrix is not invertible — signer set is not poised");
  }

  // Find the index of this signer in the participants array
  const idx = participants.findIndex(
    (p) => p.index === signerIndex && p.rank === signerRank
  );
  if (idx === -1) {
    throw new Error(`Signer ${signerIndex} with rank ${signerRank} not found in participants`);
  }

  return y[idx];
}

/**
 * Reconstruct the secret (a_0) from Birkhoff shares.
 *
 * @param shares - Array of {index, rank, value} where value is f^(rank)(index)
 * @returns The reconstructed secret a_0
 * @throws If the configuration is not poised
 */
export function birkhoffReconstruct(
  shares: { index: bigint; rank: number; value: bigint }[]
): bigint {
  const participants: BirkhoffParticipant[] = shares.map((s) => ({
    index: s.index,
    rank: s.rank,
  }));

  const matrix = buildBirkhoffMatrix(participants);
  const values = shares.map((s) => s.value);

  // Solve B * a = values, where a = [a_0, a_1, ..., a_{t-1}]
  const coeffs = gaussianEliminate(matrix, values);
  if (coeffs === null) {
    throw new Error("Birkhoff matrix is not invertible — share set is not poised");
  }

  return coeffs[0]; // a_0 is the secret
}
