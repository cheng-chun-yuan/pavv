/**
 * BLSGun Stealth Address Generation
 *
 * Implements simplified Railgun-style stealth addresses on Grumpkin.
 * Senders can pay recipients without revealing the recipient's identity on-chain.
 */

import { poseidon2Hash2 } from "./hash.js";
import type { GrumpkinPoint, StealthMetaAddress, StealthAddress } from "./types.js";
import {
  G,
  randomScalar,
  scalarMul,
  pointAdd,
  toAffine,
  fromAffine,
  Fr,
} from "./grumpkin.js";

// ─── Stealth Meta-Address ─────────────────────────────────────────────────────

/**
 * Create a stealth meta-address from spending and viewing public keys.
 * This is published by the recipient so senders can derive stealth addresses.
 */
export function createStealthMetaAddress(
  spendingPublicKey: GrumpkinPoint,
  viewingPublicKey: GrumpkinPoint
): StealthMetaAddress {
  return { spendingPublicKey, viewingPublicKey };
}

// ─── Stealth Address Generation (Sender Side) ────────────────────────────────

/**
 * Generate a one-time stealth address for a payment.
 *
 * Protocol:
 * 1. Sender generates ephemeral keypair (r, R = [r]G)
 * 2. Shared secret S = [r]PK_view (ECDH with recipient's viewing key)
 * 3. Stealth public key = [H(S)]G + PK_spend
 * 4. View tag = H(S) truncated (for efficient scanning)
 *
 * @param recipientMeta - Recipient's stealth meta-address
 * @returns Stealth address + ephemeral public key + view tag
 */
export function generateStealthAddress(
  recipientMeta: StealthMetaAddress
): StealthAddress {
  // 1. Generate ephemeral secret
  const ephemeralSk = randomScalar();
  const ephemeralPk = toAffine(scalarMul(G, ephemeralSk));

  // 2. Compute shared secret: S = [ephemeralSk]PK_view
  const sharedSecret = toAffine(
    scalarMul(fromAffine(recipientMeta.viewingPublicKey), ephemeralSk)
  );

  // 3. Derive stealth scalar: h = Poseidon(S.x, S.y)
  const stealthScalar = poseidon2Hash2(sharedSecret.x, sharedSecret.y);

  // 4. Stealth public key: [h]G + PK_spend
  const stealthPoint = pointAdd(
    scalarMul(G, stealthScalar),
    fromAffine(recipientMeta.spendingPublicKey)
  );

  // 5. View tag for efficient scanning (just the low bits of the hash)
  const viewTag = stealthScalar & 0xFFn;

  return {
    address: toAffine(stealthPoint),
    ephemeralPublicKey: ephemeralPk,
    viewTag,
    stealthScalar,
  };
}

// ─── Stealth Address Recovery (Recipient Side) ────────────────────────────────

/**
 * Check if a stealth address belongs to this recipient (scanning).
 * Uses the view tag for fast rejection.
 *
 * @param ephemeralPk - The ephemeral public key from the transaction
 * @param viewTag - The view tag from the transaction
 * @param viewingSecretKey - Recipient's viewing secret key
 * @returns The stealth scalar if it matches, null otherwise
 */
export function checkStealthAddress(
  ephemeralPk: GrumpkinPoint,
  viewTag: bigint,
  viewingSecretKey: bigint
): bigint | null {
  // Recompute shared secret: S = [viewingSk]R (where R is ephemeral pubkey)
  const sharedSecret = toAffine(
    scalarMul(fromAffine(ephemeralPk), viewingSecretKey)
  );

  // Derive stealth scalar
  const stealthScalar = poseidon2Hash2(sharedSecret.x, sharedSecret.y);

  // Check view tag
  const expectedViewTag = stealthScalar & 0xFFn;
  if (expectedViewTag !== viewTag) return null;

  return stealthScalar;
}

/**
 * Compute the stealth spending key for a matched address.
 * stealthSk = spendingSk + stealthScalar
 *
 * @param spendingSecretKey - The master spending secret (or reconstructed from FROST)
 * @param stealthScalar - The derived stealth scalar from checkStealthAddress
 * @returns The full spending key for this stealth address
 */
export function computeStealthSpendingKey(
  spendingSecretKey: bigint,
  stealthScalar: bigint
): bigint {
  return Fr.add(spendingSecretKey, stealthScalar);
}
