import "./preload.js";
import { describe, test, expect } from "bun:test";
import {
  generateMasterKeyPackage,
  precomputeNonces,
  shamirReconstruct,
} from "../src/keygen.js";
import {
  frostSign,
  frostVerify,
  frostPartialSign,
  frostAggregate,
  createSigningSession,
  registerNonceCommitment,
  lagrangeCoeff,
} from "../src/signer.js";
import { randomScalar, Fr } from "../src/grumpkin.js";

describe("FROST 2-of-3 Threshold Signing", () => {
  test("2-of-3 sign with signers 1,2 → verify = true", () => {
    const pkg = generateMasterKeyPackage(10);
    const message = randomScalar();

    const nonce1 = precomputeNonces(1)[0];
    const nonce2 = precomputeNonces(1)[0];

    const sig = frostSign(
      message,
      { index: 1n, secretShare: pkg.shares[0].secretShare, nonce: nonce1 },
      { index: 2n, secretShare: pkg.shares[1].secretShare, nonce: nonce2 },
      pkg.groupPublicKey
    );

    expect(frostVerify(sig, message, pkg.groupPublicKey)).toBe(true);
  });

  test("2-of-3 sign with signers 1,3 → verify = true", () => {
    const pkg = generateMasterKeyPackage(10);
    const message = randomScalar();

    const nonce1 = precomputeNonces(1)[0];
    const nonce3 = precomputeNonces(1)[0];

    const sig = frostSign(
      message,
      { index: 1n, secretShare: pkg.shares[0].secretShare, nonce: nonce1 },
      { index: 3n, secretShare: pkg.shares[2].secretShare, nonce: nonce3 },
      pkg.groupPublicKey
    );

    expect(frostVerify(sig, message, pkg.groupPublicKey)).toBe(true);
  });

  test("2-of-3 sign with signers 2,3 → verify = true", () => {
    const pkg = generateMasterKeyPackage(10);
    const message = randomScalar();

    const nonce2 = precomputeNonces(1)[0];
    const nonce3 = precomputeNonces(1)[0];

    const sig = frostSign(
      message,
      { index: 2n, secretShare: pkg.shares[1].secretShare, nonce: nonce2 },
      { index: 3n, secretShare: pkg.shares[2].secretShare, nonce: nonce3 },
      pkg.groupPublicKey
    );

    expect(frostVerify(sig, message, pkg.groupPublicKey)).toBe(true);
  });

  test("wrong message → verify = false", () => {
    const pkg = generateMasterKeyPackage(10);
    const message = randomScalar();
    const wrongMessage = randomScalar();

    const nonce1 = precomputeNonces(1)[0];
    const nonce2 = precomputeNonces(1)[0];

    const sig = frostSign(
      message,
      { index: 1n, secretShare: pkg.shares[0].secretShare, nonce: nonce1 },
      { index: 2n, secretShare: pkg.shares[1].secretShare, nonce: nonce2 },
      pkg.groupPublicKey
    );

    expect(frostVerify(sig, wrongMessage, pkg.groupPublicKey)).toBe(false);
  });

  test("wrong public key → verify = false", () => {
    const pkg = generateMasterKeyPackage(10);
    const pkg2 = generateMasterKeyPackage(10);
    const message = randomScalar();

    const nonce1 = precomputeNonces(1)[0];
    const nonce2 = precomputeNonces(1)[0];

    const sig = frostSign(
      message,
      { index: 1n, secretShare: pkg.shares[0].secretShare, nonce: nonce1 },
      { index: 2n, secretShare: pkg.shares[1].secretShare, nonce: nonce2 },
      pkg.groupPublicKey
    );

    // Verify against wrong public key
    expect(frostVerify(sig, message, pkg2.groupPublicKey)).toBe(false);
  });

  test("tampered signature z → verify = false", () => {
    const pkg = generateMasterKeyPackage(10);
    const message = randomScalar();

    const nonce1 = precomputeNonces(1)[0];
    const nonce2 = precomputeNonces(1)[0];

    const sig = frostSign(
      message,
      { index: 1n, secretShare: pkg.shares[0].secretShare, nonce: nonce1 },
      { index: 2n, secretShare: pkg.shares[1].secretShare, nonce: nonce2 },
      pkg.groupPublicKey
    );

    // Tamper with z
    const tampered = { ...sig, z: Fr.add(sig.z, 1n) };
    expect(frostVerify(tampered, message, pkg.groupPublicKey)).toBe(false);
  });
});

describe("Lagrange Coefficients", () => {
  test("coefficients sum to interpolation at 0", () => {
    // For participants [1, 2], λ_1(0) + λ_2(0) should give a valid interpolation
    const participants = [1n, 2n];
    const l1 = lagrangeCoeff(1n, participants);
    const l2 = lagrangeCoeff(2n, participants);

    // λ_1(0) = 2/(2-1) = 2
    // λ_2(0) = 1/(1-2) = -1
    expect(l1).toBe(2n);
    expect(Fr.add(l2, 1n)).toBe(0n); // l2 = -1 mod order
  });
});

describe("FROST Partial Signing Flow", () => {
  test("manual partial sign → aggregate → verify", () => {
    const pkg = generateMasterKeyPackage(10);
    const message = randomScalar();
    const participants = [1n, 3n];

    const nonce1 = precomputeNonces(1)[0];
    const nonce3 = precomputeNonces(1)[0];

    // Create session
    const session = createSigningSession(
      message,
      participants,
      pkg.groupPublicKey
    );

    // Register nonces
    registerNonceCommitment(session, 1n, nonce1.D, nonce1.E);
    registerNonceCommitment(session, 3n, nonce3.D, nonce3.E);

    // Partial sign
    const partial1 = frostPartialSign(
      1n,
      pkg.shares[0].secretShare,
      nonce1,
      session
    );
    const partial3 = frostPartialSign(
      3n,
      pkg.shares[2].secretShare,
      nonce3,
      session
    );

    // Aggregate
    const sig = frostAggregate([partial1, partial3]);

    // Verify
    expect(frostVerify(sig, message, pkg.groupPublicKey)).toBe(true);
  });

  test("insufficient signers (1-of-3) produces invalid signature", () => {
    const pkg = generateMasterKeyPackage(10);
    const message = randomScalar();

    // Only 1 signer tries to sign — aggregation should fail
    expect(() => {
      frostAggregate([
        { signerIndex: 1n, z_i: randomScalar(), R: pkg.groupPublicKey },
      ]);
    }).toThrow("Need at least 2 partial signatures, got 1");
  });
});
