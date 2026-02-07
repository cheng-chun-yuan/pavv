import { describe, test, expect } from "bun:test";
import {
  shamirSplit,
  shamirReconstruct,
  precomputeNonces,
  generateMasterKeyPackage,
} from "../src/keygen.js";
import {
  GRUMPKIN_ORDER,
  G,
  scalarMul,
  toAffine,
  randomScalar,
  Fr,
} from "../src/grumpkin.js";

describe("Shamir Secret Sharing", () => {
  test("split and reconstruct with 2-of-3 shares (using shares 1,2)", () => {
    const secret = randomScalar();
    const shares = shamirSplit(secret, 2, 3);

    expect(shares.length).toBe(3);

    // Reconstruct from shares 1 and 2
    const reconstructed = shamirReconstruct([
      [1n, shares[0]],
      [2n, shares[1]],
    ]);
    expect(reconstructed).toBe(secret);
  });

  test("reconstruct with shares 1,3", () => {
    const secret = randomScalar();
    const shares = shamirSplit(secret, 2, 3);

    const reconstructed = shamirReconstruct([
      [1n, shares[0]],
      [3n, shares[2]],
    ]);
    expect(reconstructed).toBe(secret);
  });

  test("reconstruct with shares 2,3", () => {
    const secret = randomScalar();
    const shares = shamirSplit(secret, 2, 3);

    const reconstructed = shamirReconstruct([
      [2n, shares[1]],
      [3n, shares[2]],
    ]);
    expect(reconstructed).toBe(secret);
  });

  test("reconstruct with all 3 shares", () => {
    const secret = randomScalar();
    const shares = shamirSplit(secret, 2, 3);

    const reconstructed = shamirReconstruct([
      [1n, shares[0]],
      [2n, shares[1]],
      [3n, shares[2]],
    ]);
    expect(reconstructed).toBe(secret);
  });

  test("shares are all different", () => {
    const secret = randomScalar();
    const shares = shamirSplit(secret, 2, 3);

    expect(shares[0]).not.toBe(shares[1]);
    expect(shares[1]).not.toBe(shares[2]);
    expect(shares[0]).not.toBe(shares[2]);
  });

  test("single share cannot reconstruct", () => {
    const secret = randomScalar();
    const shares = shamirSplit(secret, 2, 3);

    // With only 1 share, we can't reconstruct (but the function will return a value)
    // The value should NOT equal the secret
    const wrong = shamirReconstruct([[1n, shares[0]]]);
    // With t=2, a single share gives back the share itself evaluated at x=0
    // which should not be the secret
    expect(wrong).not.toBe(secret);
  });
});

describe("Nonce Pre-computation", () => {
  test("generates correct number of nonces", () => {
    const nonces = precomputeNonces(5);
    expect(nonces.length).toBe(5);
  });

  test("nonce commitments are valid curve points", () => {
    const nonces = precomputeNonces(3);

    for (const nonce of nonces) {
      // D = [d]G
      const expectedD = toAffine(scalarMul(G, nonce.d));
      expect(nonce.D.x).toBe(expectedD.x);
      expect(nonce.D.y).toBe(expectedD.y);

      // E = [e]G
      const expectedE = toAffine(scalarMul(G, nonce.e));
      expect(nonce.E.x).toBe(expectedE.x);
      expect(nonce.E.y).toBe(expectedE.y);
    }
  });

  test("all nonces are unique", () => {
    const nonces = precomputeNonces(10);
    const dValues = nonces.map((n) => n.d);
    const uniqueD = new Set(dValues);
    expect(uniqueD.size).toBe(10);
  });
});

describe("Master Key Package", () => {
  test("generates valid key package", () => {
    const pkg = generateMasterKeyPackage(5);

    // Has 3 shares
    expect(pkg.shares.length).toBe(3);

    // Shares have correct indices
    expect(pkg.shares[0].index).toBe(1n);
    expect(pkg.shares[1].index).toBe(2n);
    expect(pkg.shares[2].index).toBe(3n);

    // Group public key is non-zero
    expect(pkg.groupPublicKey.x).not.toBe(0n);
    expect(pkg.groupPublicKey.y).not.toBe(0n);

    // Viewing key is non-zero
    expect(pkg.viewingPublicKey.x).not.toBe(0n);
  });

  test("public shares match secret shares", () => {
    const pkg = generateMasterKeyPackage(5);

    for (const share of pkg.shares) {
      const expectedPk = toAffine(scalarMul(G, share.secretShare));
      expect(share.publicShare.x).toBe(expectedPk.x);
      expect(share.publicShare.y).toBe(expectedPk.y);
    }
  });

  test("any 2 shares can reconstruct master key matching group PK", () => {
    const pkg = generateMasterKeyPackage(5);

    // Reconstruct master key from shares 1 and 2
    const masterSk = shamirReconstruct([
      [1n, pkg.shares[0].secretShare],
      [2n, pkg.shares[1].secretShare],
    ]);

    // Verify it matches the group public key
    const derivedPk = toAffine(scalarMul(G, masterSk));
    expect(derivedPk.x).toBe(pkg.groupPublicKey.x);
    expect(derivedPk.y).toBe(pkg.groupPublicKey.y);
  });
});
