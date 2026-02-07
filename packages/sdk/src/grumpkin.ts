/**
 * Grumpkin curve implementation using @noble/curves primitives.
 *
 * Grumpkin is the cycle partner of BN254:
 *   - Base field = BN254 scalar field (Fr)
 *   - Scalar field = BN254 base field (Fp)
 *   - Equation: y² = x³ - 17
 *   - Generator: G = (1, sqrt(1 + (-17) + 18)... actually G = (1, y) where y² = 1 - 17 = -16 mod p
 *
 * This is Noir/Barretenberg's native embedded curve, enabling ~1,500 constraint
 * Schnorr verification inside ZK circuits.
 */

import { Field } from "@noble/curves/abstract/modular";
import { weierstrassPoints } from "@noble/curves/abstract/weierstrass";
import type { GrumpkinPoint } from "./types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** BN254 scalar field order = Grumpkin base field */
export const GRUMPKIN_BASE_FIELD_ORDER =
  0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;

/** BN254 base field order = Grumpkin scalar field (order of Grumpkin's group) */
export const GRUMPKIN_ORDER =
  0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47n;

/** Grumpkin curve: y² = x³ + ax + b, where a=0, b=-17 */
const GRUMPKIN_A = 0n;
const GRUMPKIN_B =
  GRUMPKIN_BASE_FIELD_ORDER - 17n; // -17 mod p

// ─── Field Setup ──────────────────────────────────────────────────────────────

/** Grumpkin's base field Fp (= BN254 Fr) */
export const Fp = Field(GRUMPKIN_BASE_FIELD_ORDER);

/** Grumpkin's scalar field Fr (= BN254 Fp) */
export const Fr = Field(GRUMPKIN_ORDER);

// ─── Curve Setup ──────────────────────────────────────────────────────────────

/**
 * Grumpkin generator point G = (1, y) where y = sqrt(1 - 17) mod p.
 * For Grumpkin: y² = 1³ + 0*1 + (-17) = -16 mod p
 * We compute y = sqrt(-16 mod p)
 */
const negSixteen =
  GRUMPKIN_BASE_FIELD_ORDER - 16n;
const Gy = Fp.sqrt(negSixteen);

// Grumpkin curve constructed via noble-curves weierstrassPoints
const grumpkinCurve = weierstrassPoints({
  a: GRUMPKIN_A,
  b: GRUMPKIN_B,
  Fp,
  n: GRUMPKIN_ORDER,
  Gx: 1n,
  Gy,
  h: 1n, // cofactor = 1
});

/** The ProjectivePoint class for Grumpkin */
export const ProjectivePoint = grumpkinCurve.ProjectivePoint;
export type ProjectivePointType = InstanceType<typeof ProjectivePoint>;

/** Generator point G */
export const G = ProjectivePoint.BASE;

/** Identity point (point at infinity) */
export const ZERO = ProjectivePoint.ZERO;

// ─── Point Operations ─────────────────────────────────────────────────────────

/** Scalar multiplication: [scalar]P */
export function scalarMul(
  point: ProjectivePointType,
  scalar: bigint
): ProjectivePointType {
  if (scalar === 0n) return ZERO;
  return point.multiply(Fr.create(scalar));
}

/** Point addition: P + Q */
export function pointAdd(
  p: ProjectivePointType,
  q: ProjectivePointType
): ProjectivePointType {
  return p.add(q);
}

/** Point negation: -P */
export function pointNeg(p: ProjectivePointType): ProjectivePointType {
  return p.negate();
}

/** Check point equality */
export function pointEqual(
  p: ProjectivePointType,
  q: ProjectivePointType
): boolean {
  return p.equals(q);
}

// ─── Conversion Utilities ─────────────────────────────────────────────────────

/** Convert ProjectivePoint to our GrumpkinPoint interface */
export function toAffine(p: ProjectivePointType): GrumpkinPoint {
  if (p.equals(ZERO)) return { x: 0n, y: 0n };
  const a = p.toAffine();
  return { x: a.x, y: a.y };
}

/** Convert GrumpkinPoint to ProjectivePoint */
export function fromAffine(p: GrumpkinPoint): ProjectivePointType {
  if (p.x === 0n && p.y === 0n) return ZERO;
  return ProjectivePoint.fromAffine({ x: p.x, y: p.y });
}

// ─── Scalar Utilities ─────────────────────────────────────────────────────────

/** Generate a random scalar in Grumpkin's scalar field Fr */
export function randomScalar(): bigint {
  // Use crypto.getRandomValues for 48 bytes, then reduce mod order
  // (48 bytes > 32 bytes ensures uniform distribution via rejection-like bias reduction)
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  let n = 0n;
  for (const b of bytes) {
    n = (n << 8n) | BigInt(b);
  }
  return ((n % (GRUMPKIN_ORDER - 1n)) + 1n); // [1, order-1]
}

/** Modular inverse in Fr */
export function modInverse(a: bigint): bigint {
  return Fr.inv(Fr.create(a));
}

/** Modular addition in Fr */
export function modAdd(a: bigint, b: bigint): bigint {
  return Fr.add(Fr.create(a), Fr.create(b));
}

/** Modular multiplication in Fr */
export function modMul(a: bigint, b: bigint): bigint {
  return Fr.mul(Fr.create(a), Fr.create(b));
}

/** Modular subtraction in Fr */
export function modSub(a: bigint, b: bigint): bigint {
  return Fr.sub(Fr.create(a), Fr.create(b));
}
