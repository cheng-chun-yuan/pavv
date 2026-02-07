import "./preload.js";
import { describe, test, expect } from "bun:test";
import {
  createStealthMetaAddress,
  generateStealthAddress,
  checkStealthAddress,
} from "../src/stealth.js";
import { G, scalarMul, toAffine, randomScalar } from "../src/grumpkin.js";

describe("Stealth Addresses", () => {
  test("generate and recover stealth address", () => {
    // Recipient setup
    const spendingSk = randomScalar();
    const viewingSk = randomScalar();
    const spendingPk = toAffine(scalarMul(G, spendingSk));
    const viewingPk = toAffine(scalarMul(G, viewingSk));

    const meta = createStealthMetaAddress(spendingPk, viewingPk);

    // Sender generates stealth address
    const stealth = generateStealthAddress(meta);

    expect(stealth.address.x).not.toBe(0n);
    expect(stealth.ephemeralPublicKey.x).not.toBe(0n);

    // Recipient checks if it's theirs
    const stealthScalar = checkStealthAddress(
      stealth.ephemeralPublicKey,
      stealth.viewTag,
      viewingSk
    );

    expect(stealthScalar).not.toBeNull();
  });

  test("wrong viewing key → no match", () => {
    const spendingSk = randomScalar();
    const viewingSk = randomScalar();
    const wrongViewingSk = randomScalar();

    const spendingPk = toAffine(scalarMul(G, spendingSk));
    const viewingPk = toAffine(scalarMul(G, viewingSk));

    const meta = createStealthMetaAddress(spendingPk, viewingPk);
    const stealth = generateStealthAddress(meta);

    // Try to recover with wrong key
    const result = checkStealthAddress(
      stealth.ephemeralPublicKey,
      stealth.viewTag,
      wrongViewingSk
    );

    expect(result).toBeNull();
  });

  test("different stealth addresses for same recipient", () => {
    const spendingSk = randomScalar();
    const viewingSk = randomScalar();
    const spendingPk = toAffine(scalarMul(G, spendingSk));
    const viewingPk = toAffine(scalarMul(G, viewingSk));

    const meta = createStealthMetaAddress(spendingPk, viewingPk);

    // Generate two stealth addresses
    const stealth1 = generateStealthAddress(meta);
    const stealth2 = generateStealthAddress(meta);

    // They should be different (different ephemeral keys)
    expect(stealth1.address.x).not.toBe(stealth2.address.x);
    expect(stealth1.ephemeralPublicKey.x).not.toBe(stealth2.ephemeralPublicKey.x);
  });
});
