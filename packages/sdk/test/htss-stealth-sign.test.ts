/**
 * Test: HTSS (Birkhoff) FROST signing with stealth scalar adjustment.
 *
 * Verifies that the stealth-adjusted signing works correctly for
 * hierarchical threshold signatures with mixed ranks (Admin=0, Mgr=1).
 */
import "./preload";
import { describe, test, expect, beforeAll } from "bun:test";
import {
  initHash,
  poseidon2Hash2,
  Fr,
  G,
  scalarMul,
  pointAdd,
  toAffine,
  fromAffine,
  randomScalar,
  hierarchicalCeremony,
  frostHierarchicalSign,
  frostVerify,
  createSigningSession,
  registerNonceCommitment,
  frostHierarchicalPartialSign,
  frostAggregate,
} from "../src/index";
import type { NoncePair, GrumpkinPoint, CeremonyResult } from "../src/types";

function makeNonce(): NoncePair {
  const d = randomScalar();
  const e = randomScalar();
  return {
    d,
    e,
    D: toAffine(scalarMul(G, d)),
    E: toAffine(scalarMul(G, e)),
  };
}

/** Run ceremony and save share secrets before they get zeroed */
function runCeremony(signerConfigs: { index: number; rank: number }[], threshold: number) {
  const gen = hierarchicalCeremony({ threshold, signers: signerConfigs });
  const shares: { index: bigint; rank: number; secretShare: bigint; publicShare: GrumpkinPoint }[] = [];

  for (let i = 0; i < signerConfigs.length; i++) {
    const { value } = gen.next();
    // Save secretShare before next .next() zeroes it
    shares.push({
      index: value!.index,
      rank: value!.rank,
      secretShare: value!.secretShare, // copy the bigint value
      publicShare: value!.publicShare,
    });
  }

  const { value: result } = gen.next();
  return { shares, result: result as unknown as CeremonyResult };
}

describe("HTSS stealth signing", () => {
  beforeAll(async () => {
    await initHash();
  });

  test("3-of-3 HTSS with ranks [0,0,1] + stealth scalar verifies", () => {
    const signerConfigs = [
      { index: 1, rank: 0 },
      { index: 2, rank: 0 },
      { index: 3, rank: 1 },
    ];
    const { shares, result } = runCeremony(signerConfigs, 3);
    const groupPK = result.groupPublicKey;

    const stealthScalar = randomScalar();
    const stealthGroupPK = toAffine(
      pointAdd(fromAffine(groupPK), scalarMul(G, stealthScalar))
    );

    // Adjust shares: rank-0 add stealthScalar, rank-1 does NOT
    const signers = shares.map((s) => ({
      index: s.index,
      rank: s.rank,
      secretShare: s.rank === 0 ? Fr.add(s.secretShare, stealthScalar) : s.secretShare,
      nonce: makeNonce(),
    }));

    const message = poseidon2Hash2(12345n, 67890n);
    const signature = frostHierarchicalSign(message, signers, stealthGroupPK, 3);

    const valid = frostVerify(signature, message, stealthGroupPK);
    expect(valid).toBe(true);
  });

  test("3-of-3 HTSS step-by-step partial signing (simulating browser flow)", () => {
    const signerConfigs = [
      { index: 1, rank: 0 },
      { index: 2, rank: 0 },
      { index: 3, rank: 1 },
    ];
    const { shares, result } = runCeremony(signerConfigs, 3);
    const groupPK = result.groupPublicKey;

    const stealthScalar = randomScalar();
    const stealthGroupPK = toAffine(
      pointAdd(fromAffine(groupPK), scalarMul(G, stealthScalar))
    );

    const message = poseidon2Hash2(99999n, 11111n);
    const participants = [1n, 2n, 3n];
    const nonces = [makeNonce(), makeNonce(), makeNonce()];

    // Create session with stealth-adjusted PK
    const session = createSigningSession(message, participants, stealthGroupPK, 3);
    session.participantRanks = new Map([
      [1n, 0],
      [2n, 0],
      [3n, 1],
    ]);

    for (let i = 0; i < 3; i++) {
      registerNonceCommitment(session, BigInt(i + 1), nonces[i].D, nonces[i].E);
    }

    const birkhoffParticipants = [
      { index: 1n, rank: 0 },
      { index: 2n, rank: 0 },
      { index: 3n, rank: 1 },
    ];

    // Rank-0 signers add stealthScalar, rank-1 does not
    const partial1 = frostHierarchicalPartialSign(
      1n, 0, Fr.add(shares[0].secretShare, stealthScalar), nonces[0], session, birkhoffParticipants
    );
    const partial2 = frostHierarchicalPartialSign(
      2n, 0, Fr.add(shares[1].secretShare, stealthScalar), nonces[1], session, birkhoffParticipants
    );
    const partial3 = frostHierarchicalPartialSign(
      3n, 1, shares[2].secretShare, nonces[2], session, birkhoffParticipants
    );

    const signature = frostAggregate([partial1, partial2, partial3], 3);
    const valid = frostVerify(signature, message, stealthGroupPK);
    expect(valid).toBe(true);
  });

  test("WRONG: adding stealthScalar to rank-1 signer breaks verification", () => {
    const signerConfigs = [
      { index: 1, rank: 0 },
      { index: 2, rank: 0 },
      { index: 3, rank: 1 },
    ];
    const { shares, result } = runCeremony(signerConfigs, 3);
    const groupPK = result.groupPublicKey;

    const stealthScalar = randomScalar();
    const stealthGroupPK = toAffine(
      pointAdd(fromAffine(groupPK), scalarMul(G, stealthScalar))
    );

    const message = poseidon2Hash2(55555n, 77777n);

    // WRONG: add stealthScalar to ALL shares including rank-1
    const signers = shares.map((s) => ({
      index: s.index,
      rank: s.rank,
      secretShare: Fr.add(s.secretShare, stealthScalar), // ALL get it — wrong for rank-1
      nonce: makeNonce(),
    }));

    const signature = frostHierarchicalSign(message, signers, stealthGroupPK, 3);
    const valid = frostVerify(signature, message, stealthGroupPK);
    expect(valid).toBe(false);
  });
});
