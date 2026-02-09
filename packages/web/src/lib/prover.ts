/**
 * Browser-side ZK proof generation.
 * Pattern follows: https://noir-lang.org/docs/tutorials/noirjs_app
 */

import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { Noir } from "@noir-lang/noir_js";
import initACVM from "@noir-lang/acvm_js";
import initNoirC from "@noir-lang/noirc_abi";
import acvm from "@noir-lang/acvm_js/web/acvm_js_bg.wasm?url";
import noirc from "@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm?url";
import circuit from "../../../circuits/target/blsgun.json";

let backend: UltraHonkBackend | null = null;
let noir: Noir | null = null;
let bbApi: Barretenberg | null = null;

/**
 * Patch global fetch to intercept CRS requests to crs.aztec.network
 * and redirect them to our local /crs/ files (avoids CORS issues).
 */
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("crs.aztec.network")) {
    const filename = url.split("/").pop()!; // g1.dat, g2.dat, or grumpkin_g1.dat
    console.log(`[prover] intercepting CRS fetch → /crs/${filename}`);
    return originalFetch(`/crs/${filename}`, init);
  }
  return originalFetch(input, init);
};

export async function initProver(): Promise<void> {
  if (backend && noir) { console.log("[prover] already initialized"); return; }

  const t0 = performance.now();

  // 1. Init WASM (official pattern)
  console.log("[prover] 1/3 initializing WASM modules...");
  await Promise.all([initACVM(fetch(acvm)), initNoirC(fetch(noirc))]);
  console.log(`[prover] 1/3 WASM ready (${((performance.now() - t0) / 1000).toFixed(1)}s)`);

  // 2. Create Barretenberg (downloads CRS via intercepted fetch)
  console.log("[prover] 2/3 creating Barretenberg instance...");
  const t1 = performance.now();
  bbApi = await Barretenberg.new();
  console.log(`[prover] 2/3 Barretenberg ready (${((performance.now() - t1) / 1000).toFixed(1)}s)`);

  // 3. Create Noir + Backend
  console.log("[prover] 3/3 creating Noir + UltraHonkBackend...");
  noir = new Noir(circuit as any);
  backend = new UltraHonkBackend(circuit.bytecode, bbApi);
  console.log(`[prover] initialized in ${((performance.now() - t0) / 1000).toFixed(1)}s total`);
}

export async function generateBrowserProof(
  inputs: Record<string, string | string[]>
): Promise<{ proof: Uint8Array; publicInputs: string[] }> {
  if (!noir || !backend) await initProver();

  const t0 = performance.now();
  const { witness } = await noir!.execute(inputs);
  console.log(`[prover] witness ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  const t1 = performance.now();
  const proof = await backend!.generateProof(witness, { verifierTarget: "evm" });
  console.log(`[prover] proof ${((performance.now() - t1) / 1000).toFixed(1)}s, size=${proof.proof.length}`);

  return { proof: proof.proof, publicInputs: proof.publicInputs };
}

export async function destroyProver(): Promise<void> {
  await backend?.destroy();
  await bbApi?.destroy();
  backend = null;
  bbApi = null;
  noir = null;
}
