/**
 * BLSGun Poseidon2 Hashing
 *
 * Uses @aztec/foundation's synchronous Poseidon2 permutation which matches
 * Noir's std::hash::poseidon2_permutation exactly.
 *
 * IMPORTANT: Call `await initHash()` once before using any hash functions.
 */

let _poseidon2Permutation: (input: any[]) => any[];
let _FrClass: any;
let _initialized = false;

/**
 * Initialize the hash module. Must be called once before using hash functions.
 * This loads the BarretenbergSync WASM module.
 */
export async function initHash(): Promise<void> {
  if (_initialized) return;

  const bbModule = await import("@aztec/bb.js");
  // BarretenbergSync.initSingleton() returns a promise-like in newer versions
  const singleton = bbModule.BarretenbergSync.initSingleton();
  if (singleton && typeof (singleton as any).then === "function") {
    await singleton;
  }

  const foundationCrypto = await import("@aztec/foundation/crypto/sync");
  _poseidon2Permutation = foundationCrypto.poseidon2Permutation;

  const foundationFields = await import("@aztec/foundation/fields");
  _FrClass = foundationFields.Fr;

  _initialized = true;
}

function ensureInit() {
  if (!_initialized) {
    throw new Error("Hash not initialized. Call `await initHash()` first.");
  }
}

/**
 * Raw Poseidon2 permutation with state [a, b, 0, 0].
 * Matches Noir: poseidon2_permutation([a, b, 0, 0], 4)[0]
 */
export function poseidon2Hash2(a: bigint, b: bigint): bigint {
  ensureInit();
  const result = _poseidon2Permutation([
    new _FrClass(a),
    new _FrClass(b),
    _FrClass.ZERO,
    _FrClass.ZERO,
  ]);
  return result[0].toBigInt();
}

/**
 * Raw Poseidon2 permutation with state [a, b, c, 0].
 * Matches Noir: poseidon2_permutation([a, b, c, 0], 4)[0]
 */
export function poseidon2Hash3(a: bigint, b: bigint, c: bigint): bigint {
  ensureInit();
  const result = _poseidon2Permutation([
    new _FrClass(a),
    new _FrClass(b),
    new _FrClass(c),
    _FrClass.ZERO,
  ]);
  return result[0].toBigInt();
}

/**
 * Raw Poseidon2 permutation with state [a, b, c, d].
 * Matches Noir: poseidon2_permutation([a, b, c, d], 4)[0]
 */
export function poseidon2Hash4(
  a: bigint,
  b: bigint,
  c: bigint,
  d: bigint
): bigint {
  ensureInit();
  const result = _poseidon2Permutation([
    new _FrClass(a),
    new _FrClass(b),
    new _FrClass(c),
    new _FrClass(d),
  ]);
  return result[0].toBigInt();
}
