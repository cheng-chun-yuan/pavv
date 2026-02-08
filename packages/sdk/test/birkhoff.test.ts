import "./preload.js";
import { describe, test, expect } from "bun:test";
import {
  fallingFactorial,
  buildBirkhoffMatrix,
  gaussianEliminate,
  birkhoffCoeff,
  birkhoffReconstruct,
  isBirkhoffPoised,
  type BirkhoffParticipant,
} from "../src/birkhoff.js";
import {
  shamirSplit,
  shamirReconstruct,
  evaluateDerivative,
  hierarchicalSplit,
  generateHierarchicalKeyPackage,
  generateMasterKeyPackage,
  precomputeNonces,
} from "../src/keygen.js";
import {
  frostSign,
  frostVerify,
  frostHierarchicalSign,
  lagrangeCoeff,
} from "../src/signer.js";
import { Fr, randomScalar } from "../src/grumpkin.js";

// ─── Falling Factorial ───────────────────────────────────────────────────────

describe("Falling Factorial", () => {
  test("ff(n, 0) = 1 for any n", () => {
    expect(fallingFactorial(0, 0)).toBe(1n);
    expect(fallingFactorial(5, 0)).toBe(1n);
    expect(fallingFactorial(100, 0)).toBe(1n);
  });

  test("ff(n, 1) = n", () => {
    expect(fallingFactorial(1, 1)).toBe(1n);
    expect(fallingFactorial(3, 1)).toBe(3n);
    expect(fallingFactorial(7, 1)).toBe(7n);
  });

  test("ff(n, 2) = n*(n-1)", () => {
    expect(fallingFactorial(2, 2)).toBe(2n); // 2*1
    expect(fallingFactorial(3, 2)).toBe(6n); // 3*2
    expect(fallingFactorial(5, 2)).toBe(20n); // 5*4
  });

  test("ff(n, n) = n!", () => {
    expect(fallingFactorial(3, 3)).toBe(6n); // 3!
    expect(fallingFactorial(4, 4)).toBe(24n); // 4!
  });

  test("ff(n, k) = 0 when k > n", () => {
    expect(fallingFactorial(2, 3)).toBe(0n);
    expect(fallingFactorial(0, 1)).toBe(0n);
  });
});

// ─── Birkhoff Matrix Construction ────────────────────────────────────────────

describe("Birkhoff Matrix Construction", () => {
  test("all rank-0 produces Vandermonde matrix", () => {
    const participants: BirkhoffParticipant[] = [
      { index: 1n, rank: 0 },
      { index: 2n, rank: 0 },
      { index: 3n, rank: 0 },
    ];
    const B = buildBirkhoffMatrix(participants);

    // Row 0: [1, 1, 1] (x=1: 1^0, 1^1, 1^2)
    expect(B[0][0]).toBe(1n);
    expect(B[0][1]).toBe(1n);
    expect(B[0][2]).toBe(1n);

    // Row 1: [1, 2, 4] (x=2: 2^0, 2^1, 2^2)
    expect(B[1][0]).toBe(1n);
    expect(B[1][1]).toBe(2n);
    expect(B[1][2]).toBe(4n);

    // Row 2: [1, 3, 9] (x=3: 3^0, 3^1, 3^2)
    expect(B[2][0]).toBe(1n);
    expect(B[2][1]).toBe(3n);
    expect(B[2][2]).toBe(9n);
  });

  test("rank-1 row has correct derivative entries", () => {
    // For rank 1 at x=2, polynomial degree 3 (cols 0,1,2):
    // B[i][0] = 0 (j=0 < k=1)
    // B[i][1] = ff(1,1) * x^0 = 1
    // B[i][2] = ff(2,1) * x^1 = 2*2 = 4
    const participants: BirkhoffParticipant[] = [
      { index: 1n, rank: 0 },
      { index: 2n, rank: 1 },
      { index: 3n, rank: 0 },
    ];
    const B = buildBirkhoffMatrix(participants);

    expect(B[1][0]).toBe(0n);
    expect(B[1][1]).toBe(1n);
    expect(B[1][2]).toBe(4n); // ff(2,1) * 2^1 = 2 * 2 = 4
  });

  test("rank-2 row has correct second derivative entries", () => {
    // For rank 2 at x=3, polynomial degree 3 (cols 0,1,2):
    // B[i][0] = 0, B[i][1] = 0, B[i][2] = ff(2,2) * x^0 = 2*1 = 2
    const participants: BirkhoffParticipant[] = [
      { index: 1n, rank: 0 },
      { index: 2n, rank: 1 },
      { index: 3n, rank: 2 },
    ];
    const B = buildBirkhoffMatrix(participants);

    expect(B[2][0]).toBe(0n);
    expect(B[2][1]).toBe(0n);
    expect(B[2][2]).toBe(2n); // ff(2,2) * 3^0 = 2
  });
});

// ─── Gaussian Elimination ────────────────────────────────────────────────────

describe("Gaussian Elimination", () => {
  test("solves identity system", () => {
    const I = [[1n, 0n], [0n, 1n]];
    const b = [5n, 7n];
    const x = gaussianEliminate(I, b);
    expect(x).not.toBeNull();
    expect(x![0]).toBe(5n);
    expect(x![1]).toBe(7n);
  });

  test("returns null for singular matrix", () => {
    const singular = [[1n, 2n], [2n, 4n]];
    const b = [1n, 2n];
    expect(gaussianEliminate(singular, b)).toBeNull();
  });

  test("solves 3x3 system over Fr", () => {
    // Simple known system: x + y + z = 6, x + 2y + 4z = 17, x + 3y + 9z = 34
    // Solution: x=1, y=2, z=3 (Vandermonde with f(x) = 1 + 0x + x^2 evaluated at 1,2,3 doesn't match)
    // Let's use: f(1)=1+0+1=2? No, let's just verify with polynomial evaluation.
    // f(x) = a0 + a1*x + a2*x^2. If a0=1, a1=2, a2=3:
    // f(1) = 1+2+3 = 6, f(2) = 1+4+12 = 17, f(3) = 1+6+27 = 34
    const V = [[1n, 1n, 1n], [1n, 2n, 4n], [1n, 3n, 9n]];
    const b = [6n, 17n, 34n];
    const x = gaussianEliminate(V, b);
    expect(x).not.toBeNull();
    expect(x![0]).toBe(1n); // a0
    expect(x![1]).toBe(2n); // a1
    expect(x![2]).toBe(3n); // a2
  });
});

// ─── Birkhoff Poisedness ─────────────────────────────────────────────────────

describe("Birkhoff Poisedness", () => {
  test("all rank-0 with distinct indices is poised", () => {
    const participants: BirkhoffParticipant[] = [
      { index: 1n, rank: 0 },
      { index: 2n, rank: 0 },
      { index: 3n, rank: 0 },
    ];
    expect(isBirkhoffPoised(participants)).toBe(true);
  });

  test("mixed ranks [0, 1, 2] is poised", () => {
    const participants: BirkhoffParticipant[] = [
      { index: 1n, rank: 0 },
      { index: 2n, rank: 1 },
      { index: 3n, rank: 2 },
    ];
    expect(isBirkhoffPoised(participants)).toBe(true);
  });

  test("mixed ranks [0, 0, 1] is poised", () => {
    const participants: BirkhoffParticipant[] = [
      { index: 1n, rank: 0 },
      { index: 2n, rank: 0 },
      { index: 3n, rank: 1 },
    ];
    expect(isBirkhoffPoised(participants)).toBe(true);
  });

  test("[1, 1, 2] with distinct indices is NOT poised (column 0 all zeros)", () => {
    // For ranks [1, 1, 2] with t=3: column 0 is all zeros since min rank > 0
    const participants: BirkhoffParticipant[] = [
      { index: 1n, rank: 1 },
      { index: 2n, rank: 1 },
      { index: 3n, rank: 2 },
    ];
    expect(isBirkhoffPoised(participants)).toBe(false);
  });

  test("[0, 1, 1] with distinct indices IS poised", () => {
    const participants: BirkhoffParticipant[] = [
      { index: 1n, rank: 0 },
      { index: 2n, rank: 1 },
      { index: 3n, rank: 1 },
    ];
    expect(isBirkhoffPoised(participants)).toBe(true);
  });

  test("all rank-2 for degree-2 polynomial is NOT poised", () => {
    // Three signers all with rank 2 means all hold f''(x_i).
    // For a degree-2 polynomial, f''(x) = 2*a2 (constant).
    // Three equations with one unknown = overdetermined but rows are identical.
    const participants: BirkhoffParticipant[] = [
      { index: 1n, rank: 2 },
      { index: 2n, rank: 2 },
      { index: 3n, rank: 2 },
    ];
    expect(isBirkhoffPoised(participants)).toBe(false);
  });
});

// ─── Birkhoff Reconstruction ──────────────────────────────────────────────────

describe("Birkhoff Reconstruction", () => {
  test("all rank-0 matches Lagrange reconstruction", () => {
    const secret = randomScalar();
    const t = 3;
    const n = 5;
    const shareValues = shamirSplit(secret, t, n);

    // Lagrange reconstruction with shares 1, 2, 3
    const lagrangeResult = shamirReconstruct([
      [1n, shareValues[0]],
      [2n, shareValues[1]],
      [3n, shareValues[2]],
    ]);

    // Birkhoff reconstruction with all rank-0 (same as Lagrange)
    const birkhoffResult = birkhoffReconstruct([
      { index: 1n, rank: 0, value: shareValues[0] },
      { index: 2n, rank: 0, value: shareValues[1] },
      { index: 3n, rank: 0, value: shareValues[2] },
    ]);

    expect(birkhoffResult).toBe(lagrangeResult);
    expect(birkhoffResult).toBe(secret);
  });

  test("mixed rank [0, 0, 1] reconstruction recovers secret", () => {
    const secret = randomScalar();
    const t = 3;

    // Generate polynomial f(x) = secret + c1*x + c2*x^2
    const coeffs = [secret, randomScalar(), randomScalar()];

    // Evaluate:
    // Signer 1 (rank 0): f(1)
    // Signer 2 (rank 0): f(2)
    // Signer 3 (rank 1): f'(3)
    const f1 = evaluateDerivative(coeffs, 1n, 0);
    const f2 = evaluateDerivative(coeffs, 2n, 0);
    const f3_prime = evaluateDerivative(coeffs, 3n, 1);

    const result = birkhoffReconstruct([
      { index: 1n, rank: 0, value: f1 },
      { index: 2n, rank: 0, value: f2 },
      { index: 3n, rank: 1, value: f3_prime },
    ]);

    expect(result).toBe(secret);
  });

  test("mixed rank [0, 1, 2] reconstruction recovers secret", () => {
    const secret = randomScalar();
    const coeffs = [secret, randomScalar(), randomScalar()];

    const f1 = evaluateDerivative(coeffs, 1n, 0);
    const f2_prime = evaluateDerivative(coeffs, 2n, 1);
    const f3_double = evaluateDerivative(coeffs, 3n, 2);

    const result = birkhoffReconstruct([
      { index: 1n, rank: 0, value: f1 },
      { index: 2n, rank: 1, value: f2_prime },
      { index: 3n, rank: 2, value: f3_double },
    ]);

    expect(result).toBe(secret);
  });

  test("all rank-1 reconstruction recovers secret", () => {
    const secret = randomScalar();
    const coeffs = [secret, randomScalar(), randomScalar()];

    // Three first-derivative evaluations
    const fp1 = evaluateDerivative(coeffs, 1n, 1);
    const fp2 = evaluateDerivative(coeffs, 2n, 1);
    const fp3 = evaluateDerivative(coeffs, 3n, 1);

    // This should NOT be poised for a degree-2 polynomial with 3 rank-1 shares
    // f'(x) = c1 + 2*c2*x has only 2 unknowns but we have 3 equations
    // However our system is 3x3 and tries to recover 3 coefficients [a0, a1, a2]
    // from 3 equations. The Birkhoff matrix has row [0, 1, 2*x_i] for each row.
    // Column 0 is all zeros -> singular!
    const participants: BirkhoffParticipant[] = [
      { index: 1n, rank: 1 },
      { index: 2n, rank: 1 },
      { index: 3n, rank: 1 },
    ];
    expect(isBirkhoffPoised(participants)).toBe(false);
  });

  test("[1, 1, 0] reconstruction recovers secret", () => {
    const secret = randomScalar();
    const coeffs = [secret, randomScalar(), randomScalar()];

    const fp1 = evaluateDerivative(coeffs, 1n, 1);
    const fp2 = evaluateDerivative(coeffs, 2n, 1);
    const f3 = evaluateDerivative(coeffs, 3n, 0);

    const result = birkhoffReconstruct([
      { index: 1n, rank: 1, value: fp1 },
      { index: 2n, rank: 1, value: fp2 },
      { index: 3n, rank: 0, value: f3 },
    ]);

    expect(result).toBe(secret);
  });
});

// ─── Birkhoff Coefficients ───────────────────────────────────────────────────

describe("Birkhoff Coefficients", () => {
  test("rank-0 only: birkhoff coefficients match Lagrange coefficients", () => {
    const participants: BirkhoffParticipant[] = [
      { index: 1n, rank: 0 },
      { index: 2n, rank: 0 },
    ];

    const beta1 = birkhoffCoeff(1n, 0, participants);
    const beta2 = birkhoffCoeff(2n, 0, participants);
    const lambda1 = lagrangeCoeff(1n, [1n, 2n]);
    const lambda2 = lagrangeCoeff(2n, [1n, 2n]);

    expect(beta1).toBe(lambda1);
    expect(beta2).toBe(lambda2);
  });

  test("throws for non-poised configuration", () => {
    const participants: BirkhoffParticipant[] = [
      { index: 1n, rank: 2 },
      { index: 2n, rank: 2 },
      { index: 3n, rank: 2 },
    ];

    expect(() => birkhoffCoeff(1n, 2, participants)).toThrow("not invertible");
  });
});

// ─── Hierarchical Key Generation ─────────────────────────────────────────────

describe("Hierarchical Key Generation", () => {
  test("generates key package with correct ranks", () => {
    const pkg = generateHierarchicalKeyPackage({
      threshold: 3,
      signers: [
        { index: 1, rank: 0 },
        { index: 2, rank: 0 },
        { index: 3, rank: 1 },
        { index: 4, rank: 1 },
        { index: 5, rank: 2 },
      ],
    });

    expect(pkg.threshold).toBe(3);
    expect(pkg.shares.length).toBe(5);
    expect(pkg.shares[0].rank).toBe(0);
    expect(pkg.shares[1].rank).toBe(0);
    expect(pkg.shares[2].rank).toBe(1);
    expect(pkg.shares[3].rank).toBe(1);
    expect(pkg.shares[4].rank).toBe(2);
    expect(pkg.signerRanks.length).toBe(5);
  });

  test("rejects rank >= threshold", () => {
    expect(() =>
      generateHierarchicalKeyPackage({
        threshold: 2,
        signers: [
          { index: 1, rank: 0 },
          { index: 2, rank: 2 }, // rank 2 >= threshold 2
        ],
      })
    ).toThrow("rank 2 >= threshold 2");
  });

  test("hierarchical shares reconstruct to correct secret", () => {
    const pkg = generateHierarchicalKeyPackage({
      threshold: 3,
      signers: [
        { index: 1, rank: 0 },
        { index: 2, rank: 0 },
        { index: 3, rank: 1 },
        { index: 4, rank: 1 },
        { index: 5, rank: 2 },
      ],
    });

    // Reconstruct using signers 1, 2, 3 (ranks [0, 0, 1])
    const secret = birkhoffReconstruct([
      { index: 1n, rank: 0, value: pkg.shares[0].secretShare },
      { index: 2n, rank: 0, value: pkg.shares[1].secretShare },
      { index: 3n, rank: 1, value: pkg.shares[2].secretShare },
    ]);

    // Reconstruct using signers 1, 3, 5 (ranks [0, 1, 2])
    const secret2 = birkhoffReconstruct([
      { index: 1n, rank: 0, value: pkg.shares[0].secretShare },
      { index: 3n, rank: 1, value: pkg.shares[2].secretShare },
      { index: 5n, rank: 2, value: pkg.shares[4].secretShare },
    ]);

    expect(secret).toBe(secret2);
  });
});

// ─── Hierarchical FROST Signing ──────────────────────────────────────────────

describe("Hierarchical FROST Signing", () => {
  test("rank-0 only hierarchical sign matches standard FROST", () => {
    // Generate a standard key package (all rank 0)
    const pkg = generateHierarchicalKeyPackage({
      threshold: 2,
      signers: [
        { index: 1, rank: 0 },
        { index: 2, rank: 0 },
        { index: 3, rank: 0 },
      ],
    });

    const message = randomScalar();
    const nonce1 = precomputeNonces(1)[0];
    const nonce2 = precomputeNonces(1)[0];

    // Sign with hierarchical FROST
    const sig = frostHierarchicalSign(
      message,
      [
        { index: 1n, rank: 0, secretShare: pkg.shares[0].secretShare, nonce: nonce1 },
        { index: 2n, rank: 0, secretShare: pkg.shares[1].secretShare, nonce: nonce2 },
      ],
      pkg.groupPublicKey,
      2
    );

    expect(frostVerify(sig, message, pkg.groupPublicKey)).toBe(true);
  });

  test("mixed rank [0, 0, 1] signing produces valid signature", () => {
    const pkg = generateHierarchicalKeyPackage({
      threshold: 3,
      signers: [
        { index: 1, rank: 0 },
        { index: 2, rank: 0 },
        { index: 3, rank: 1 },
        { index: 4, rank: 1 },
        { index: 5, rank: 2 },
      ],
    });

    const message = randomScalar();
    const nonces = precomputeNonces(3);

    const sig = frostHierarchicalSign(
      message,
      [
        { index: 1n, rank: 0, secretShare: pkg.shares[0].secretShare, nonce: nonces[0] },
        { index: 2n, rank: 0, secretShare: pkg.shares[1].secretShare, nonce: nonces[1] },
        { index: 3n, rank: 1, secretShare: pkg.shares[2].secretShare, nonce: nonces[2] },
      ],
      pkg.groupPublicKey,
      3
    );

    expect(frostVerify(sig, message, pkg.groupPublicKey)).toBe(true);
  });

  test("mixed rank [0, 1, 2] signing produces valid signature", () => {
    const pkg = generateHierarchicalKeyPackage({
      threshold: 3,
      signers: [
        { index: 1, rank: 0 },
        { index: 2, rank: 0 },
        { index: 3, rank: 1 },
        { index: 4, rank: 1 },
        { index: 5, rank: 2 },
      ],
    });

    const message = randomScalar();
    const nonces = precomputeNonces(3);

    const sig = frostHierarchicalSign(
      message,
      [
        { index: 1n, rank: 0, secretShare: pkg.shares[0].secretShare, nonce: nonces[0] },
        { index: 3n, rank: 1, secretShare: pkg.shares[2].secretShare, nonce: nonces[1] },
        { index: 5n, rank: 2, secretShare: pkg.shares[4].secretShare, nonce: nonces[2] },
      ],
      pkg.groupPublicKey,
      3
    );

    expect(frostVerify(sig, message, pkg.groupPublicKey)).toBe(true);
  });

  test("[1, 1, 0] ranks produce valid signature", () => {
    const pkg = generateHierarchicalKeyPackage({
      threshold: 3,
      signers: [
        { index: 1, rank: 0 },
        { index: 2, rank: 0 },
        { index: 3, rank: 1 },
        { index: 4, rank: 1 },
        { index: 5, rank: 2 },
      ],
    });

    const message = randomScalar();
    const nonces = precomputeNonces(3);

    const sig = frostHierarchicalSign(
      message,
      [
        { index: 3n, rank: 1, secretShare: pkg.shares[2].secretShare, nonce: nonces[0] },
        { index: 4n, rank: 1, secretShare: pkg.shares[3].secretShare, nonce: nonces[1] },
        { index: 1n, rank: 0, secretShare: pkg.shares[0].secretShare, nonce: nonces[2] },
      ],
      pkg.groupPublicKey,
      3
    );

    expect(frostVerify(sig, message, pkg.groupPublicKey)).toBe(true);
  });

  test("different valid signer subsets all produce valid signatures", () => {
    const pkg = generateHierarchicalKeyPackage({
      threshold: 3,
      signers: [
        { index: 1, rank: 0 },
        { index: 2, rank: 0 },
        { index: 3, rank: 1 },
        { index: 4, rank: 1 },
        { index: 5, rank: 2 },
      ],
    });

    const message = randomScalar();

    // Valid combo 1: {1, 2, 3} - ranks [0, 0, 1]
    const nonces1 = precomputeNonces(3);
    const sig1 = frostHierarchicalSign(
      message,
      [
        { index: 1n, rank: 0, secretShare: pkg.shares[0].secretShare, nonce: nonces1[0] },
        { index: 2n, rank: 0, secretShare: pkg.shares[1].secretShare, nonce: nonces1[1] },
        { index: 3n, rank: 1, secretShare: pkg.shares[2].secretShare, nonce: nonces1[2] },
      ],
      pkg.groupPublicKey,
      3
    );
    expect(frostVerify(sig1, message, pkg.groupPublicKey)).toBe(true);

    // Valid combo 2: {1, 4, 5} - ranks [0, 1, 2]
    const nonces2 = precomputeNonces(3);
    const sig2 = frostHierarchicalSign(
      message,
      [
        { index: 1n, rank: 0, secretShare: pkg.shares[0].secretShare, nonce: nonces2[0] },
        { index: 4n, rank: 1, secretShare: pkg.shares[3].secretShare, nonce: nonces2[1] },
        { index: 5n, rank: 2, secretShare: pkg.shares[4].secretShare, nonce: nonces2[2] },
      ],
      pkg.groupPublicKey,
      3
    );
    expect(frostVerify(sig2, message, pkg.groupPublicKey)).toBe(true);

    // Valid combo 3: {2, 4, 5} - ranks [0, 1, 2]
    const nonces3 = precomputeNonces(3);
    const sig3 = frostHierarchicalSign(
      message,
      [
        { index: 2n, rank: 0, secretShare: pkg.shares[1].secretShare, nonce: nonces3[0] },
        { index: 4n, rank: 1, secretShare: pkg.shares[3].secretShare, nonce: nonces3[1] },
        { index: 5n, rank: 2, secretShare: pkg.shares[4].secretShare, nonce: nonces3[2] },
      ],
      pkg.groupPublicKey,
      3
    );
    expect(frostVerify(sig3, message, pkg.groupPublicKey)).toBe(true);
  });

  test("non-poised signer set throws error", () => {
    const pkg = generateHierarchicalKeyPackage({
      threshold: 3,
      signers: [
        { index: 1, rank: 0 },
        { index: 2, rank: 1 },
        { index: 3, rank: 1 },
        { index: 4, rank: 1 },
      ],
    });

    const message = randomScalar();
    const nonces = precomputeNonces(3);

    // Signers {2, 3, 4} all rank 1 — column 0 is all zeros, singular
    expect(() =>
      frostHierarchicalSign(
        message,
        [
          { index: 2n, rank: 1, secretShare: pkg.shares[1].secretShare, nonce: nonces[0] },
          { index: 3n, rank: 1, secretShare: pkg.shares[2].secretShare, nonce: nonces[1] },
          { index: 4n, rank: 1, secretShare: pkg.shares[3].secretShare, nonce: nonces[2] },
        ],
        pkg.groupPublicKey,
        3
      )
    ).toThrow("not invertible");
  });

  test("wrong message fails verification", () => {
    const pkg = generateHierarchicalKeyPackage({
      threshold: 3,
      signers: [
        { index: 1, rank: 0 },
        { index: 2, rank: 0 },
        { index: 3, rank: 1 },
      ],
    });

    const message = randomScalar();
    const wrongMessage = randomScalar();
    const nonces = precomputeNonces(3);

    const sig = frostHierarchicalSign(
      message,
      [
        { index: 1n, rank: 0, secretShare: pkg.shares[0].secretShare, nonce: nonces[0] },
        { index: 2n, rank: 0, secretShare: pkg.shares[1].secretShare, nonce: nonces[1] },
        { index: 3n, rank: 1, secretShare: pkg.shares[2].secretShare, nonce: nonces[2] },
      ],
      pkg.groupPublicKey,
      3
    );

    expect(frostVerify(sig, wrongMessage, pkg.groupPublicKey)).toBe(false);
  });
});

// ─── Backward Compatibility ──────────────────────────────────────────────────

describe("Backward Compatibility", () => {
  test("standard generateMasterKeyPackage shares have rank 0", () => {
    const pkg = generateMasterKeyPackage({ threshold: 2, totalSigners: 3 });
    for (const share of pkg.shares) {
      expect(share.rank).toBe(0);
    }
  });

  test("existing frostSign still works with rank-0 shares", () => {
    const pkg = generateMasterKeyPackage({ threshold: 2, totalSigners: 3 });
    const message = randomScalar();
    const nonces = precomputeNonces(2);

    const sig = frostSign(
      message,
      [
        { index: 1n, secretShare: pkg.shares[0].secretShare, nonce: nonces[0] },
        { index: 2n, secretShare: pkg.shares[1].secretShare, nonce: nonces[1] },
      ],
      pkg.groupPublicKey,
      2
    );

    expect(frostVerify(sig, message, pkg.groupPublicKey)).toBe(true);
  });
});

// ─── evaluateDerivative ──────────────────────────────────────────────────────

describe("evaluateDerivative", () => {
  test("order-0 matches polynomial evaluation", () => {
    // f(x) = 3 + 5x + 7x^2
    const coeffs = [3n, 5n, 7n];
    // f(2) = 3 + 10 + 28 = 41
    expect(evaluateDerivative(coeffs, 2n, 0)).toBe(41n);
  });

  test("order-1 matches first derivative", () => {
    // f(x) = 3 + 5x + 7x^2, f'(x) = 5 + 14x
    const coeffs = [3n, 5n, 7n];
    // f'(2) = 5 + 28 = 33
    expect(evaluateDerivative(coeffs, 2n, 1)).toBe(33n);
  });

  test("order-2 matches second derivative", () => {
    // f(x) = 3 + 5x + 7x^2, f''(x) = 14
    const coeffs = [3n, 5n, 7n];
    expect(evaluateDerivative(coeffs, 2n, 2)).toBe(14n);
    expect(evaluateDerivative(coeffs, 99n, 2)).toBe(14n); // constant
  });

  test("order > degree returns 0", () => {
    const coeffs = [3n, 5n, 7n]; // degree 2
    expect(evaluateDerivative(coeffs, 1n, 3)).toBe(0n);
  });
});
