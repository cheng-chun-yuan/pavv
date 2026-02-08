import { describe, test, expect } from "bun:test";
import {
  distributedCeremony,
  verifyShareAgainstCommitments,
  clearSecret,
} from "../src/ceremony.js";
import type { CeremonyShare, CeremonyResult } from "../src/ceremony.js";
import { shamirReconstruct } from "../src/keygen.js";
import { G, scalarMul, toAffine } from "../src/grumpkin.js";

describe("Distributed Ceremony", () => {
  test("generator yields exactly 3 shares one at a time", () => {
    const gen = distributedCeremony({ threshold: 2, totalSigners: 3 });
    const shares: CeremonyShare[] = [];

    // First 3 .next() calls yield shares
    for (let i = 0; i < 3; i++) {
      const result = gen.next();
      expect(result.done).toBe(false);
      const share = result.value as CeremonyShare;
      expect(share.index).toBe(BigInt(i + 1));
      expect(share.secretShare).not.toBe(0n);
      shares.push({ ...share, publicShare: { ...share.publicShare } });
    }

    // 4th .next() returns the CeremonyResult (done = true)
    const final = gen.next();
    expect(final.done).toBe(true);
    const result = final.value as CeremonyResult;
    expect(result.groupPublicKey.x).not.toBe(0n);
    expect(result.polynomialCommitments.length).toBe(2); // t=2 coefficients
  });

  test("all 3 shares reconstruct to match group PK", () => {
    const gen = distributedCeremony({ threshold: 2, totalSigners: 3 });
    const shares: CeremonyShare[] = [];

    for (let i = 0; i < 3; i++) {
      const { value } = gen.next();
      shares.push({
        index: (value as CeremonyShare).index,
        secretShare: (value as CeremonyShare).secretShare,
        publicShare: { ...(value as CeremonyShare).publicShare },
      });
    }

    const { value: result } = gen.next();
    const ceremonyResult = result as CeremonyResult;

    // Reconstruct from shares 1,2
    const masterSk12 = shamirReconstruct([
      [shares[0].index, shares[0].secretShare],
      [shares[1].index, shares[1].secretShare],
    ]);
    const derivedPk12 = toAffine(scalarMul(G, masterSk12));
    expect(derivedPk12.x).toBe(ceremonyResult.groupPublicKey.x);
    expect(derivedPk12.y).toBe(ceremonyResult.groupPublicKey.y);

    // Reconstruct from shares 1,3
    const masterSk13 = shamirReconstruct([
      [shares[0].index, shares[0].secretShare],
      [shares[2].index, shares[2].secretShare],
    ]);
    const derivedPk13 = toAffine(scalarMul(G, masterSk13));
    expect(derivedPk13.x).toBe(ceremonyResult.groupPublicKey.x);

    // Reconstruct from shares 2,3
    const masterSk23 = shamirReconstruct([
      [shares[1].index, shares[1].secretShare],
      [shares[2].index, shares[2].secretShare],
    ]);
    const derivedPk23 = toAffine(scalarMul(G, masterSk23));
    expect(derivedPk23.x).toBe(ceremonyResult.groupPublicKey.x);
  });

  test("yielded shares have secretShare zeroed after ceremony completes", () => {
    const gen = distributedCeremony({ threshold: 2, totalSigners: 3 });

    // Collect references to the actual yielded share objects
    const shareRefs: CeremonyShare[] = [];
    for (let i = 0; i < 3; i++) {
      const { value } = gen.next();
      shareRefs.push(value as CeremonyShare);
    }

    // After yielding all 3, shares 0 and 1 should be zeroed (previous share zeroed on advance)
    expect(shareRefs[0].secretShare).toBe(0n);
    expect(shareRefs[1].secretShare).toBe(0n);
    // Share 2 still has its value until the generator returns
    expect(shareRefs[2].secretShare).not.toBe(0n);

    // Advancing once more to complete — this zeros share 2
    gen.next();
    expect(shareRefs[2].secretShare).toBe(0n);
  });
});

describe("Feldman VSS Verification", () => {
  test("honest shares pass verification", () => {
    const gen = distributedCeremony({ threshold: 2, totalSigners: 3 });
    const shares: CeremonyShare[] = [];

    for (let i = 0; i < 3; i++) {
      const { value } = gen.next();
      const s = value as CeremonyShare;
      shares.push({
        index: s.index,
        secretShare: s.secretShare,
        publicShare: { ...s.publicShare },
      });
    }

    const { value: result } = gen.next();
    const commitments = (result as CeremonyResult).polynomialCommitments;

    for (const share of shares) {
      expect(verifyShareAgainstCommitments(share, commitments)).toBe(true);
    }
  });

  test("tampered share fails verification", () => {
    const gen = distributedCeremony({ threshold: 2, totalSigners: 3 });
    const shares: CeremonyShare[] = [];

    for (let i = 0; i < 3; i++) {
      const { value } = gen.next();
      const s = value as CeremonyShare;
      shares.push({
        index: s.index,
        secretShare: s.secretShare,
        publicShare: { ...s.publicShare },
      });
    }

    const { value: result } = gen.next();
    const commitments = (result as CeremonyResult).polynomialCommitments;

    // Tamper with share 0's secret
    const tampered: CeremonyShare = {
      ...shares[0],
      secretShare: shares[0].secretShare + 1n,
    };
    expect(verifyShareAgainstCommitments(tampered, commitments)).toBe(false);
  });
});

describe("clearSecret", () => {
  test("zeros the target field", () => {
    const obj = { secretShare: 42n, index: 1n };
    clearSecret(obj, "secretShare");
    expect(obj.secretShare).toBe(0n);
    // Other fields untouched
    expect(obj.index).toBe(1n);
  });
});
