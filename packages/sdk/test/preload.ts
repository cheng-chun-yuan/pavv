/**
 * Test preload: suppress @aztec/foundation's expect.addEqualityTesters
 * which isn't supported in bun:test.
 */
import { expect, beforeAll } from "bun:test";

// Patch expect to avoid crash from @aztec/foundation's fields.js
if (typeof (expect as any).addEqualityTesters !== "function") {
  (expect as any).addEqualityTesters = () => {};
}

import { initHash } from "../src/hash.js";

beforeAll(async () => {
  await initHash();
});
