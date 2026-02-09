/**
 * Full-Flow Integration Test
 *
 * End-to-end test: viewing key scans stealth notes, spending key spends them.
 * Covers standard TSS, hierarchical HTSS, and audit report generation.
 */
import "./preload.js";
import { describe, test, expect } from "bun:test";
import {
  generateMasterKeyPackage,
  generateHierarchicalKeyPackage,
  precomputeNonces,
  shamirReconstruct,
} from "../src/keygen.js";
import {
  frostSign,
  frostVerify,
  frostHierarchicalSign,
} from "../src/signer.js";
import {
  createStealthMetaAddress,
  generateStealthAddress,
  checkStealthAddress,
  computeStealthSpendingKey,
} from "../src/stealth.js";
import {
  computeCommitment,
  computeNullifier,
  buildTransaction,
} from "../src/transaction.js";
import {
  generateAuditReport,
  type ShieldEvent,
} from "../src/audit.js";
import { G, scalarMul, pointAdd, toAffine, fromAffine, randomScalar, Fr } from "../src/grumpkin.js";

describe("Full Flow: Scan-then-Spend", () => {
  test("viewing key scans stealth notes, spending key spends them (standard TSS)", () => {
    // 1. Generate a FROST key package (2-of-3)
    const pkg = generateMasterKeyPackage({ threshold: 2, totalSigners: 3 });

    // 2. Derive viewing key pair (already in package)
    const viewingSk = pkg.viewingSecretKey;
    const viewingPk = pkg.viewingPublicKey;

    // 3. Create stealth meta-address from (groupPK, viewingPK)
    const meta = createStealthMetaAddress(pkg.groupPublicKey, viewingPk);

    // 4. Sender generates stealth address
    const stealth = generateStealthAddress(meta);

    // 5. Create a note at the stealth address
    const amount = 1000n;
    const blinding = randomScalar();
    const owner = stealth.address.x; // use stealth address x as owner identifier
    const commitment = computeCommitment(owner, amount, blinding);

    // 6. Scan: use checkStealthAddress to find the note
    const stealthScalar = checkStealthAddress(
      stealth.ephemeralPublicKey,
      stealth.viewTag,
      viewingSk
    );

    // 7. Verify stealthScalar is not null
    expect(stealthScalar).not.toBeNull();

    // 8. Compute stealth spending key: needs master sk reconstructed from shares
    const masterSk = shamirReconstruct([
      [pkg.shares[0].index, pkg.shares[0].secretShare],
      [pkg.shares[1].index, pkg.shares[1].secretShare],
    ]);
    const stealthSpendingSk = computeStealthSpendingKey(masterSk, stealthScalar!);

    // 9. Verify [stealthSpendingSk]G == stealthAddress
    const derivedPk = toAffine(scalarMul(G, stealthSpendingSk));
    expect(derivedPk.x).toBe(stealth.address.x);
    expect(derivedPk.y).toBe(stealth.address.y);

    // 10. Build a transaction message
    const spendingKeyHash = Fr.create(stealthSpendingSk);
    const nullifier = computeNullifier(spendingKeyHash, 0);
    const message = randomScalar(); // simplified transaction message

    // 11. Sign with FROST (2-of-3)
    const nonce1 = precomputeNonces(1)[0];
    const nonce2 = precomputeNonces(1)[0];

    const sig = frostSign(
      message,
      [
        { index: 1n, secretShare: pkg.shares[0].secretShare, nonce: nonce1 },
        { index: 2n, secretShare: pkg.shares[1].secretShare, nonce: nonce2 },
      ],
      pkg.groupPublicKey,
      2
    );

    // 12. Verify signature
    expect(frostVerify(sig, message, pkg.groupPublicKey)).toBe(true);
  });

  test("hierarchical FROST scan-then-spend flow (HTSS)", () => {
    // 1. Generate hierarchical key package with ranks [0, 0, 1]
    const pkg = generateHierarchicalKeyPackage({
      threshold: 2,
      signers: [
        { index: 1, rank: 0 },
        { index: 2, rank: 0 },
        { index: 3, rank: 1 },
      ],
    });

    // 2. Create stealth meta-address
    const meta = createStealthMetaAddress(pkg.groupPublicKey, pkg.viewingPublicKey);

    // 3. Sender generates stealth address
    const stealth = generateStealthAddress(meta);

    // 4. Scan with viewing key
    const stealthScalar = checkStealthAddress(
      stealth.ephemeralPublicKey,
      stealth.viewTag,
      pkg.viewingSecretKey
    );
    expect(stealthScalar).not.toBeNull();

    // 5. Verify stealth scalar produces correct stealth address
    // For hierarchical, we need to reconstruct master from birkhoff shares
    // But we can still verify the stealth scalar is correct by checking
    // the point relationship: stealthAddress = [stealthScalar]G + groupPK
    const recomputed = toAffine(
      pointAdd(
        scalarMul(G, stealthScalar!),
        fromAffine(pkg.groupPublicKey)
      )
    );
    expect(recomputed.x).toBe(stealth.address.x);
    expect(recomputed.y).toBe(stealth.address.y);

    // 6. Sign with hierarchical FROST using mixed ranks
    const message = randomScalar();

    // Sign with signers 1 (rank 0) and 3 (rank 1) — mixed ranks
    const nonce1 = precomputeNonces(1)[0];
    const nonce3 = precomputeNonces(1)[0];

    const sig = frostHierarchicalSign(
      message,
      [
        { index: 1n, rank: 0, secretShare: pkg.shares[0].secretShare, nonce: nonce1 },
        { index: 3n, rank: 1, secretShare: pkg.shares[2].secretShare, nonce: nonce3 },
      ],
      pkg.groupPublicKey,
      2
    );

    // 7. Verify — standard frostVerify works for hierarchical signatures too
    expect(frostVerify(sig, message, pkg.groupPublicKey)).toBe(true);

    // Also sign with two rank-0 signers
    const nonce1b = precomputeNonces(1)[0];
    const nonce2b = precomputeNonces(1)[0];

    const sig2 = frostHierarchicalSign(
      message,
      [
        { index: 1n, rank: 0, secretShare: pkg.shares[0].secretShare, nonce: nonce1b },
        { index: 2n, rank: 0, secretShare: pkg.shares[1].secretShare, nonce: nonce2b },
      ],
      pkg.groupPublicKey,
      2
    );
    expect(frostVerify(sig2, message, pkg.groupPublicKey)).toBe(true);
  });

  test("audit report from simulated events", () => {
    // 1. Generate viewing key
    const pkg = generateMasterKeyPackage({ threshold: 2, totalSigners: 3 });
    const viewingSk = pkg.viewingSecretKey;
    const viewingPk = pkg.viewingPublicKey;

    const meta = createStealthMetaAddress(pkg.groupPublicKey, viewingPk);

    // 2. Create multiple stealth addresses for same recipient
    const stealth1 = generateStealthAddress(meta);
    const stealth2 = generateStealthAddress(meta);
    const stealth3 = generateStealthAddress(meta);

    // 3. Build ShieldEvent[] with encrypted amounts
    const amount1 = 500n;
    const amount2 = 1000n;
    const amount3 = 250n;

    // Encrypt amounts: XOR with low 128 bits of stealth scalar
    function encryptAmount(amount: bigint, ephPK: { x: bigint; y: bigint }, viewTag: bigint): bigint {
      const scalar = checkStealthAddress(ephPK, viewTag, viewingSk);
      if (scalar === null) throw new Error("Should match");
      return amount ^ (scalar & ((1n << 128n) - 1n));
    }

    const events: ShieldEvent[] = [
      {
        commitment: 100n, // simplified
        ephemeralPubKey: stealth1.ephemeralPublicKey,
        viewTag: stealth1.viewTag,
        encryptedAmount: encryptAmount(amount1, stealth1.ephemeralPublicKey, stealth1.viewTag),
        blockNumber: 10,
        timestamp: 1000,
        txHash: "0xaaa",
      },
      {
        commitment: 200n,
        ephemeralPubKey: stealth2.ephemeralPublicKey,
        viewTag: stealth2.viewTag,
        encryptedAmount: encryptAmount(amount2, stealth2.ephemeralPublicKey, stealth2.viewTag),
        blockNumber: 20,
        timestamp: 2000,
        txHash: "0xbbb",
      },
      {
        commitment: 300n,
        ephemeralPubKey: stealth3.ephemeralPublicKey,
        viewTag: stealth3.viewTag,
        encryptedAmount: encryptAmount(amount3, stealth3.ephemeralPublicKey, stealth3.viewTag),
        blockNumber: 50,
        timestamp: 3000,
        txHash: "0xccc",
      },
    ];

    // 4. Call generateAuditReport
    const report = generateAuditReport(viewingSk, events, 0, 100);

    // 5. Verify: correct number of transactions found
    expect(report.transactions.length).toBe(3);

    // Amounts match (inflow since these are shield events)
    expect(report.totalInflow).toBe(amount1 + amount2 + amount3);
    expect(report.totalOutflow).toBe(0n);

    // Individual amounts correct
    expect(report.transactions[0].amount).toBe(amount1);
    expect(report.transactions[1].amount).toBe(amount2);
    expect(report.transactions[2].amount).toBe(amount3);

    // 6. Wrong viewing key finds nothing
    const wrongVk = randomScalar();
    const reportWrong = generateAuditReport(wrongVk, events, 0, 100);
    expect(reportWrong.transactions.length).toBe(0);
    expect(reportWrong.totalInflow).toBe(0n);

    // Block range filtering
    const reportPartial = generateAuditReport(viewingSk, events, 15, 30);
    expect(reportPartial.transactions.length).toBe(1);
    expect(reportPartial.transactions[0].amount).toBe(amount2);
  });
});
