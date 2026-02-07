/**
 * BLSGun Prover — Wrapper for Noir/Barretenberg proof generation
 *
 * Handles compiling circuits, generating witnesses, and producing
 * ZK proofs that verify FROST signatures + transaction validity.
 */

import { execSync } from "child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import type { CircuitInputs } from "./types.js";

// ─── Paths ────────────────────────────────────────────────────────────────────

const CIRCUITS_DIR = resolve(import.meta.dir, "../../circuits");
const TARGET_DIR = join(CIRCUITS_DIR, "target");

// ─── TOML Serialization ──────────────────────────────────────────────────────

/**
 * Convert CircuitInputs to Noir's Prover.toml format.
 */
function toProverToml(inputs: CircuitInputs): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(inputs)) {
    if (Array.isArray(value)) {
      lines.push(`${key} = [${value.map((v) => `"${v}"`).join(", ")}]`);
    } else {
      lines.push(`${key} = "${value}"`);
    }
  }

  return lines.join("\n");
}

// ─── Compilation ──────────────────────────────────────────────────────────────

/**
 * Compile the Noir circuit.
 * Uses nargo compile — takes seconds with Grumpkin (native curve).
 */
export function compileCircuit(): void {
  console.log("[BLSGun] Compiling circuit...");
  execSync("nargo compile", { cwd: CIRCUITS_DIR, stdio: "inherit" });
  console.log("[BLSGun] Circuit compiled successfully.");
}

// ─── Proof Generation ─────────────────────────────────────────────────────────

/**
 * Generate a ZK proof for a private transaction.
 *
 * Steps:
 * 1. Write witness inputs to Prover.toml
 * 2. Execute circuit to generate witness
 * 3. Generate proof with bb
 *
 * @param inputs - Circuit inputs (private + public)
 * @returns The proof bytes
 */
export function generateProof(inputs: CircuitInputs): Uint8Array {
  // Ensure target directory exists
  if (!existsSync(TARGET_DIR)) {
    mkdirSync(TARGET_DIR, { recursive: true });
  }

  // 1. Write Prover.toml
  const proverToml = toProverToml(inputs);
  writeFileSync(join(CIRCUITS_DIR, "Prover.toml"), proverToml);

  // 2. Generate witness with nargo
  console.log("[BLSGun] Generating witness...");
  execSync("nargo execute", { cwd: CIRCUITS_DIR, stdio: "inherit" });

  // 3. Generate proof with bb
  console.log("[BLSGun] Generating proof...");
  execSync(
    `bb prove -b ${join(TARGET_DIR, "blsgun.json")} -w ${join(TARGET_DIR, "blsgun.gz")} -o ${TARGET_DIR}`,
    { cwd: CIRCUITS_DIR, stdio: "inherit" }
  );

  // 4. Read proof
  const proofPath = join(TARGET_DIR, "proof");
  if (!existsSync(proofPath)) {
    throw new Error("Proof generation failed — proof file not found");
  }

  return new Uint8Array(readFileSync(proofPath));
}

// ─── Verification Key ─────────────────────────────────────────────────────────

/**
 * Generate the verification key (needed for Solidity verifier).
 */
export function generateVerificationKey(): void {
  console.log("[BLSGun] Generating verification key...");
  execSync(
    `bb write_vk -b ${join(TARGET_DIR, "blsgun.json")} --oracle_hash keccak`,
    { cwd: CIRCUITS_DIR, stdio: "inherit" }
  );
  console.log("[BLSGun] Verification key generated.");
}

/**
 * Generate the Solidity verifier contract from the circuit.
 */
export function generateSolidityVerifier(outputPath: string): void {
  console.log("[BLSGun] Generating Solidity verifier...");
  execSync(
    `bb contract -b ${join(TARGET_DIR, "blsgun.json")} -o ${outputPath}`,
    { cwd: CIRCUITS_DIR, stdio: "inherit" }
  );
  console.log(`[BLSGun] Solidity verifier written to ${outputPath}`);
}

// ─── Proof Verification (Off-chain) ──────────────────────────────────────────

/**
 * Verify a proof off-chain using bb.
 */
export function verifyProof(): boolean {
  try {
    execSync(
      `bb verify -b ${join(TARGET_DIR, "blsgun.json")} -p ${join(TARGET_DIR, "proof")}`,
      { cwd: CIRCUITS_DIR, stdio: "inherit" }
    );
    return true;
  } catch {
    return false;
  }
}
