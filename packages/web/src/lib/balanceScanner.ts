/**
 * On-chain balance scanner with EIP-5564 stealth scanning.
 *
 * Scans Shield and PrivateTransfer events, uses the viewing key to
 * identify notes belonging to this wallet via 1-byte viewTag fast-reject,
 * decrypts amounts via XOR, and checks nullifier spent status.
 *
 * Also builds a local Merkle tree from ALL on-chain commitments (in block order)
 * so that spending proofs can be generated client-side.
 */

import { publicClient } from "./wagmiConfig";
import { blsGunAbi } from "./abi";
import { formatBalance, getContractAddress } from "./chain";
import { checkStealthAddress } from "@blsgun/sdk/stealth";
import { initHash, poseidon2Hash2 } from "@blsgun/sdk/hash";
import { MerkleTree } from "@blsgun/sdk/transaction";
import { scalarMul, pointAdd, toAffine, fromAffine, G } from "@blsgun/sdk/grumpkin";
import type { GrumpkinPoint } from "@blsgun/sdk/types";

const BLINDING_DOMAIN = 0x426c696e64696e67n; // "Blinding" in hex

export interface ScannedNote {
  commitment: string;
  amount: bigint;
  blockNumber: number;
  txHash: string;
  type: "shield" | "transfer";
  isSpent: boolean;
  stealthScalar: bigint;
  spendingKeyHash: bigint;
  blinding: bigint;
  leafIndex: number;
}

export interface ScanResult {
  notes: ScannedNote[];
  totalBalance: bigint;
  formattedBalance: string;
  scannedToBlock: number;
}

/** 128-bit mask for XOR amount decryption */
const MASK_128 = (1n << 128n) - 1n;

let hashInitialized = false;

async function ensureHashInit(): Promise<void> {
  if (hashInitialized) return;
  await initHash();
  hashInitialized = true;
}

/** Module-level Merkle tree rebuilt on each scan */
let _localTree: MerkleTree | null = null;

/** Get the locally reconstructed Merkle tree (available after scanBalance) */
export function getLocalMerkleTree(): MerkleTree | null {
  return _localTree;
}

interface OnChainEvent {
  commitment: bigint;
  ephPubKeyX: bigint;
  ephPubKeyY: bigint;
  viewTag: bigint;
  encryptedAmount: bigint;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  type: "shield" | "transfer";
}

/**
 * Scan on-chain events for notes belonging to this wallet.
 *
 * @param viewingSecretKey - Hex-encoded viewing secret key
 * @param groupPublicKey - Optional group public key for spendingKeyHash derivation
 * @returns Scan result with matched notes, total balance, and block height
 */
export async function scanBalance(
  viewingSecretKey: string,
  groupPublicKey?: GrumpkinPoint
): Promise<ScanResult> {
  const contractAddress = getContractAddress();
  if (!contractAddress) {
    return { notes: [], totalBalance: 0n, formattedBalance: "0", scannedToBlock: 0 };
  }

  await ensureHashInit();

  const address = contractAddress as `0x${string}`;
  const currentBlock = await publicClient.getBlockNumber();
  const vsk = BigInt(viewingSecretKey);

  // Use a reasonable scan window — public RPCs reject huge ranges.
  // For local (Hardhat) scan from 0; for testnet scan last 50k blocks.
  const MAX_SCAN_RANGE = 50_000n;
  const fromBlock = currentBlock > MAX_SCAN_RANGE ? currentBlock - MAX_SCAN_RANGE : 0n;

  // Collect ALL events in block order for Merkle tree reconstruction
  const allEvents: OnChainEvent[] = [];

  // 1. Scan Shield events
  const shieldLogs = await publicClient.getLogs({
    address,
    event: blsGunAbi[0], // Shield event
    fromBlock,
    toBlock: currentBlock,
  });

  for (const log of shieldLogs) {
    const { commitment, ephPubKeyX, ephPubKeyY, viewTag, encryptedAmount } = log.args;
    if (!commitment) continue;
    allEvents.push({
      commitment: BigInt(commitment),
      ephPubKeyX: ephPubKeyX ? BigInt(ephPubKeyX) : 0n,
      ephPubKeyY: ephPubKeyY ? BigInt(ephPubKeyY) : 0n,
      viewTag: BigInt(viewTag ?? 0),
      encryptedAmount: BigInt(encryptedAmount ?? 0),
      blockNumber: Number(log.blockNumber),
      txHash: log.transactionHash,
      logIndex: log.logIndex ?? 0,
      type: "shield",
    });
  }

  // 2. Scan PrivateTransfer events
  const transferLogs = await publicClient.getLogs({
    address,
    event: blsGunAbi[1], // PrivateTransfer event
    fromBlock,
    toBlock: currentBlock,
  });

  for (const log of transferLogs) {
    const { outputCommitment, ephPubKeyX, ephPubKeyY, viewTag, encryptedAmount } = log.args;
    if (!outputCommitment) continue;
    allEvents.push({
      commitment: BigInt(outputCommitment),
      ephPubKeyX: ephPubKeyX ? BigInt(ephPubKeyX) : 0n,
      ephPubKeyY: ephPubKeyY ? BigInt(ephPubKeyY) : 0n,
      viewTag: BigInt(viewTag ?? 0),
      encryptedAmount: BigInt(encryptedAmount ?? 0),
      blockNumber: Number(log.blockNumber),
      txHash: log.transactionHash,
      logIndex: log.logIndex ?? 0,
      type: "transfer",
    });
  }

  // Sort by block number then log index to get insertion order
  allEvents.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);

  // 3. Build Merkle tree from all events and identify our notes
  const tree = new MerkleTree();
  const notes: ScannedNote[] = [];

  for (const evt of allEvents) {
    const leafIndex = tree.insert(evt.commitment);

    // Skip events with zero ephemeral key (can't scan)
    if (evt.ephPubKeyX === 0n) continue;

    const ephPK = { x: evt.ephPubKeyX, y: evt.ephPubKeyY };
    const stealthScalar = checkStealthAddress(ephPK, evt.viewTag, vsk);
    if (stealthScalar === null) continue;

    const amount = evt.encryptedAmount ^ (stealthScalar & MASK_128);
    const blinding = poseidon2Hash2(stealthScalar, BLINDING_DOMAIN);

    // Compute stealth public key for spendingKeyHash
    let spendingKeyHash = 0n;
    if (groupPublicKey) {
      const stealthPubKey = toAffine(
        pointAdd(scalarMul(G, stealthScalar), fromAffine(groupPublicKey))
      );
      spendingKeyHash = poseidon2Hash2(stealthPubKey.x, stealthPubKey.y);
    }

    notes.push({
      commitment: `0x${evt.commitment.toString(16).padStart(64, "0")}`,
      amount,
      blockNumber: evt.blockNumber,
      txHash: evt.txHash,
      type: evt.type,
      isSpent: false,
      stealthScalar,
      spendingKeyHash,
      blinding,
      leafIndex,
    });
  }

  _localTree = tree;

  // 4. Check nullifier spent status for each note
  for (const note of notes) {
    try {
      const spent = await publicClient.readContract({
        address,
        abi: blsGunAbi,
        functionName: "isNullifierSpent",
        args: [note.commitment as `0x${string}`],
      });
      note.isSpent = spent;
    } catch {
      // If call fails, leave as unspent
    }
  }

  // 5. Compute total balance from unspent notes
  const totalBalance = notes
    .filter((n) => !n.isSpent && n.amount > 0n)
    .reduce((sum, n) => sum + n.amount, 0n);

  return {
    notes,
    totalBalance,
    formattedBalance: formatBalance(totalBalance),
    scannedToBlock: Number(currentBlock),
  };
}
