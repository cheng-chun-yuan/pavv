/**
 * BLSGun Nonce Tracker
 *
 * Sequential nonce consumption with zeroing of consumed nonces.
 * Prevents nonce reuse (which could lead to key recovery in Schnorr).
 */

import type { NoncePair } from "./types.js";

export class NonceTracker {
  private _nonces: NoncePair[];
  private _nextIndex: number;

  constructor(nonces: NoncePair[]) {
    this._nonces = nonces;
    this._nextIndex = 0;
  }

  /**
   * Consume and return the next nonce pair.
   * The consumed nonce's private scalars (d, e) are zeroed.
   * @throws Error if no nonces remain
   */
  consumeNext(): NoncePair {
    if (this._nextIndex >= this._nonces.length) {
      throw new Error("NonceTracker: all nonces consumed");
    }

    const nonce = this._nonces[this._nextIndex];
    this._nextIndex++;

    // Return a copy of the nonce data, then zero the stored private scalars
    const result: NoncePair = {
      d: nonce.d,
      e: nonce.e,
      D: { ...nonce.D },
      E: { ...nonce.E },
    };

    // Zero the private scalars in the stored array
    nonce.d = 0n;
    nonce.e = 0n;

    return result;
  }

  /** Number of nonces remaining */
  get remaining(): number {
    return this._nonces.length - this._nextIndex;
  }

  /** Whether any nonces are available */
  get hasNonces(): boolean {
    return this._nextIndex < this._nonces.length;
  }
}
