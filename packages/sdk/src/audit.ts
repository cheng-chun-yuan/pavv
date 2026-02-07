/**
 * BLSGun Compliance Audit Export
 *
 * Decrypt transaction history using viewing key for regulatory compliance.
 * Supports scoped access by block range and JSON export.
 */

import type { AuditReport, AuditTransaction, GrumpkinPoint } from "./types.js";
import { checkStealthAddress } from "./stealth.js";

// ─── On-chain Event Types ─────────────────────────────────────────────────────

/** Shield event (deposit into privacy pool) */
export interface ShieldEvent {
  commitment: bigint;
  ephemeralPubKey: GrumpkinPoint;
  viewTag: bigint;
  encryptedAmount: bigint; // XOR encrypted with shared secret
  blockNumber: number;
  timestamp: number;
  txHash: string;
}

/** PrivateTransfer event */
export interface TransferEvent {
  nullifier: bigint;
  commitment: bigint;
  ephemeralPubKey: GrumpkinPoint;
  viewTag: bigint;
  encryptedAmount: bigint;
  blockNumber: number;
  timestamp: number;
  txHash: string;
}

// ─── Decryption ───────────────────────────────────────────────────────────────

/**
 * Attempt to decrypt an event using the viewing key.
 * Returns the decrypted transaction details if the event belongs to this viewer.
 */
function tryDecryptEvent(
  event: ShieldEvent | TransferEvent,
  viewingSecretKey: bigint
): AuditTransaction | null {
  // Check if this event is addressed to us
  const stealthScalar = checkStealthAddress(
    event.ephemeralPubKey,
    event.viewTag,
    viewingSecretKey
  );

  if (stealthScalar === null) return null;

  // Decrypt amount using XOR with stealth scalar
  const amount = event.encryptedAmount ^ (stealthScalar & ((1n << 128n) - 1n));

  return {
    nullifier: "nullifier" in event ? event.nullifier : 0n,
    commitment: event.commitment,
    amount,
    recipient: "", // Would be derived from stealth address in full impl
    timestamp: event.timestamp,
    blockNumber: event.blockNumber,
  };
}

// ─── Audit Report Generation ──────────────────────────────────────────────────

/**
 * Generate an audit report for a block range.
 *
 * Scans events and attempts decryption with the viewing key.
 * Only events that match the viewing key are included.
 *
 * @param viewingSecretKey - The viewing secret key (scoped by block range)
 * @param events - On-chain events to scan
 * @param fromBlock - Start block (inclusive)
 * @param toBlock - End block (inclusive)
 * @returns Structured audit report
 */
export function generateAuditReport(
  viewingSecretKey: bigint,
  events: (ShieldEvent | TransferEvent)[],
  fromBlock: number,
  toBlock: number
): AuditReport {
  const transactions: AuditTransaction[] = [];
  let totalInflow = 0n;
  let totalOutflow = 0n;

  for (const event of events) {
    // Filter by block range
    if (event.blockNumber < fromBlock || event.blockNumber > toBlock) continue;

    const tx = tryDecryptEvent(event, viewingSecretKey);
    if (tx === null) continue;

    transactions.push(tx);

    // Classify as inflow or outflow based on event type
    if ("nullifier" in event && event.nullifier !== 0n) {
      totalOutflow += tx.amount;
    } else {
      totalInflow += tx.amount;
    }
  }

  return {
    period: { fromBlock, toBlock },
    transactions,
    totalInflow,
    totalOutflow,
    generatedAt: Date.now(),
  };
}

/**
 * Export audit report as JSON string.
 */
export function exportAuditJSON(report: AuditReport): string {
  return JSON.stringify(
    report,
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
    2
  );
}
