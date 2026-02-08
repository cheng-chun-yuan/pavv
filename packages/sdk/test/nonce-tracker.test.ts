import { describe, test, expect } from "bun:test";
import { NonceTracker } from "../src/nonce-tracker.js";
import { precomputeNonces } from "../src/keygen.js";

describe("NonceTracker", () => {
  test("consumeNext returns nonces sequentially", () => {
    const nonces = precomputeNonces(5);
    // Save original d values for comparison
    const originalDs = nonces.map((n) => n.d);

    const tracker = new NonceTracker(nonces);

    const first = tracker.consumeNext();
    expect(first.d).toBe(originalDs[0]);

    const second = tracker.consumeNext();
    expect(second.d).toBe(originalDs[1]);
  });

  test("consumed nonce d and e are zeroed in source array", () => {
    const nonces = precomputeNonces(3);
    const tracker = new NonceTracker(nonces);

    tracker.consumeNext();

    // The source nonce's private scalars should be zeroed
    expect(nonces[0].d).toBe(0n);
    expect(nonces[0].e).toBe(0n);

    // Public commitments are still intact
    expect(nonces[0].D.x).not.toBe(0n);
    expect(nonces[0].E.x).not.toBe(0n);

    // Unconsumed nonces are untouched
    expect(nonces[1].d).not.toBe(0n);
    expect(nonces[2].d).not.toBe(0n);
  });

  test("remaining count decrements", () => {
    const nonces = precomputeNonces(4);
    const tracker = new NonceTracker(nonces);

    expect(tracker.remaining).toBe(4);
    expect(tracker.hasNonces).toBe(true);

    tracker.consumeNext();
    expect(tracker.remaining).toBe(3);

    tracker.consumeNext();
    expect(tracker.remaining).toBe(2);

    tracker.consumeNext();
    expect(tracker.remaining).toBe(1);

    tracker.consumeNext();
    expect(tracker.remaining).toBe(0);
    expect(tracker.hasNonces).toBe(false);
  });

  test("throws when exhausted", () => {
    const nonces = precomputeNonces(2);
    const tracker = new NonceTracker(nonces);

    tracker.consumeNext();
    tracker.consumeNext();

    expect(() => tracker.consumeNext()).toThrow("all nonces consumed");
  });
});
