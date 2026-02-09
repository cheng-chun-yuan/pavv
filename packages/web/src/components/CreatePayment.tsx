import { useState } from "react";
import type { PendingPayment, SignerRole, GroupConfig, CurvePoint } from "../store/treasury";
import type { ScannedNote } from "../lib/balanceScanner";
import { initHash, poseidon2Hash2 } from "@blsgun/sdk/hash";
import { generateStealthAddress } from "@blsgun/sdk/stealth";
import { computeCommitment, computeNullifier } from "@blsgun/sdk/transaction";
import { scalarMul, pointAdd, toAffine, fromAffine, G, Fp, GRUMPKIN_BASE_FIELD_ORDER } from "@blsgun/sdk/grumpkin";
import { parseEther, formatEther } from "viem";
import { deriveNonces } from "../lib/frostSigning";
import { getSession } from "../lib/session";

const BLINDING_DOMAIN = 0x426c696e64696e67n;
const GRUMPKIN_B = GRUMPKIN_BASE_FIELD_ORDER - 17n;

/** Decompress a Grumpkin point from x + y-is-odd flag */
function decompressPoint(x: bigint, yOdd: boolean): { x: bigint; y: bigint } {
  // y² = x³ - 17 (mod p)
  const y2 = Fp.add(Fp.pow(x, 3n), GRUMPKIN_B);
  let y = Fp.sqrt(y2);
  if (y === undefined) throw new Error("Invalid point: not on curve");
  // Pick the y with matching parity
  if ((y % 2n === 1n) !== yOdd) y = Fp.neg(y);
  return { x, y };
}

interface CreatePaymentProps {
  currentSigner: SignerRole;
  onCreatePayment: (payment: PendingPayment) => void;
  groupConfig: GroupConfig | null;
  balance?: string;
  notes?: ScannedNote[];
  groupPublicKey?: CurvePoint | null;
}

export function CreatePayment({
  currentSigner,
  onCreatePayment,
  groupConfig,
  balance,
  notes,
  groupPublicKey,
}: CreatePaymentProps) {
  const thresholdValue = groupConfig?.threshold ?? 2;
  const totalSigners = groupConfig?.totalSigners ?? 3;
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [selectedNoteIdx, setSelectedNoteIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const unspentNotes = (notes ?? []).filter((n) => !n.isSpent && n.amount > 0n);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipient || !amount) return;
    setError(null);
    setIsCreating(true);

    try {
      await initHash();

      // 1. Select note to spend
      let noteToSpend: ScannedNote;
      if (selectedNoteIdx !== null) {
        noteToSpend = unspentNotes[selectedNoteIdx];
      } else {
        // Auto-select smallest note that covers the amount
        const amountWei = parseEther(amount);
        const suitable = unspentNotes
          .filter((n) => n.amount >= amountWei)
          .sort((a, b) => (a.amount < b.amount ? -1 : 1));
        if (suitable.length === 0) {
          throw new Error("No note with sufficient balance");
        }
        noteToSpend = suitable[0];
      }

      // 2. Parse recipient stealth meta-address
      let recipientMeta: { spendingPublicKey: { x: bigint; y: bigint }; viewingPublicKey: { x: bigint; y: bigint } };
      const trimmed = recipient.trim();
      if (trimmed.startsWith("0x") && trimmed.length === 132) {
        // Compressed: 0x + flags(2) + spendX(64) + viewX(64)
        const hex = trimmed.slice(2);
        const flags = parseInt(hex.slice(0, 2), 16);
        const spendX = BigInt("0x" + hex.slice(2, 66));
        const viewX = BigInt("0x" + hex.slice(66, 130));
        recipientMeta = {
          spendingPublicKey: decompressPoint(spendX, (flags & 1) === 1),
          viewingPublicKey: decompressPoint(viewX, (flags & 2) === 2),
        };
      } else if (trimmed.startsWith("0x") && trimmed.length === 258) {
        // Uncompressed: 0x + spendX(64) + spendY(64) + viewX(64) + viewY(64)
        const hex = trimmed.slice(2);
        recipientMeta = {
          spendingPublicKey: { x: BigInt("0x" + hex.slice(0, 64)), y: BigInt("0x" + hex.slice(64, 128)) },
          viewingPublicKey: { x: BigInt("0x" + hex.slice(128, 192)), y: BigInt("0x" + hex.slice(192, 256)) },
        };
      } else {
        try {
          const parsed = JSON.parse(trimmed);
          recipientMeta = {
            spendingPublicKey: { x: BigInt(parsed.spendingPublicKey.x), y: BigInt(parsed.spendingPublicKey.y) },
            viewingPublicKey: { x: BigInt(parsed.viewingPublicKey.x), y: BigInt(parsed.viewingPublicKey.y) },
          };
        } catch {
          throw new Error("Invalid address. Paste the 0x... stealth address from the recipient.");
        }
      }

      // 3. Generate stealth address for recipient
      const stealth = generateStealthAddress(recipientMeta);
      const outputOwnerHash = poseidon2Hash2(stealth.address.x, stealth.address.y);
      const amountWei = parseEther(amount);
      const outputBlinding = poseidon2Hash2(stealth.stealthScalar, BLINDING_DOMAIN);
      const outputCommitment = computeCommitment(outputOwnerHash, amountWei, outputBlinding);

      // 4. Compute encrypted amount for output
      const MASK_128 = (1n << 128n) - 1n;
      const encryptedAmount = (amountWei ^ (stealth.stealthScalar & MASK_128)) & MASK_128;
      const viewTag = Number(stealth.viewTag & 0xFFn);

      // 5. Compute input note's stealth public key for spendingKeyHash
      const stealthPubKey = toAffine(
        pointAdd(
          scalarMul(G, noteToSpend.stealthScalar),
          fromAffine({ x: BigInt(groupPublicKey!.x), y: BigInt(groupPublicKey!.y) })
        )
      );
      const spendingKeyHash = poseidon2Hash2(stealthPubKey.x, stealthPubKey.y);

      // 6. Compute nullifier and message (must match circuit: message = hash_2(nullifier, commitment))
      const nullifier = computeNullifier(spendingKeyHash, BigInt(noteToSpend.leafIndex));
      const inputCommitmentBigint = BigInt(noteToSpend.commitment);
      const message = poseidon2Hash2(nullifier, inputCommitmentBigint);

      // 7. Build signingData
      const paymentId = crypto.randomUUID();

      // 8. Derive nonces for current signer and add commitment
      const session = getSession();
      if (!session) throw new Error("No active session");
      const signerIndex = session.share.index;
      const nonce = deriveNonces(session.share.secretShare, paymentId);

      const nonceCommitments: Record<string, { Dx: string; Dy: string; Ex: string; Ey: string }> = {
        [signerIndex.toString()]: {
          Dx: nonce.D.x.toString(),
          Dy: nonce.D.y.toString(),
          Ex: nonce.E.x.toString(),
          Ey: nonce.E.y.toString(),
        },
      };

      const payment: PendingPayment = {
        id: paymentId,
        recipient: `${stealth.address.x.toString(16).slice(0, 8)}...`,
        amount,
        memo,
        createdBy: currentSigner,
        createdAt: Date.now(),
        signatures: [],
        requiredSignatures: thresholdValue,
        status: "pending",
        txType: "send",
        signingData: {
          inputCommitment: noteToSpend.commitment,
          inputAmount: noteToSpend.amount.toString(),
          inputBlinding: noteToSpend.blinding.toString(),
          inputLeafIndex: noteToSpend.leafIndex,
          inputStealthScalar: noteToSpend.stealthScalar.toString(),
          inputStealthPubKeyX: stealthPubKey.x.toString(),
          inputStealthPubKeyY: stealthPubKey.y.toString(),
          inputSpendingKeyHash: spendingKeyHash.toString(),
          outputCommitment: outputCommitment.toString(),
          outputEphPubKeyX: stealth.ephemeralPublicKey.x.toString(),
          outputEphPubKeyY: stealth.ephemeralPublicKey.y.toString(),
          outputViewTag: viewTag,
          outputEncryptedAmount: encryptedAmount.toString(),
          message: message.toString(),
          nullifier: nullifier.toString(),
          nonceCommitments,
          partialSignatures: {},
        },
      };

      onCreatePayment(payment);
      setRecipient("");
      setAmount("");
      setMemo("");
      setSelectedNoteIdx(null);
    } catch (err: any) {
      setError(err?.message || "Failed to create payment");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Sender context */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-pavv-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-pavv-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
            </svg>
          </div>
          <div>
            <p className="text-sm text-slate-400">Sending as</p>
            <p className="text-base font-medium text-white">{currentSigner}</p>
          </div>
        </div>
        {balance && balance !== "0" && (
          <div className="text-right">
            <p className="text-sm text-slate-400">Available</p>
            <p className="text-base font-medium text-white">{balance} CFX</p>
          </div>
        )}
      </div>

      {/* Note selection */}
      {unspentNotes.length > 0 && (
        <div className="bg-dark-card rounded-xl border border-dark-border p-5 mb-4">
          <label className="block text-sm font-medium text-slate-400 mb-2">
            Select Note to Spend
          </label>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {unspentNotes.map((note, idx) => (
              <button
                key={note.commitment}
                type="button"
                onClick={() => setSelectedNoteIdx(idx)}
                className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer ${
                  selectedNoteIdx === idx
                    ? "border-pavv-500 bg-pavv-500/10"
                    : "border-dark-border bg-dark-surface hover:border-slate-500"
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="text-sm text-white font-medium">
                    {formatEther(note.amount)} CFX
                  </span>
                  <span className="text-xs text-slate-400">
                    Leaf #{note.leafIndex}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 font-mono truncate">
                  {note.commitment}
                </p>
              </button>
            ))}
          </div>
          {selectedNoteIdx === null && (
            <p className="text-xs text-slate-500 mt-2">
              Auto-selects smallest sufficient note if none chosen
            </p>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Amount */}
        <div className="bg-dark-card rounded-xl border border-dark-border p-5">
          <label className="block text-sm font-medium text-slate-400 mb-2">
            Amount
          </label>
          <div className="flex items-baseline gap-2">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="flex-1 bg-transparent text-3xl font-bold text-white placeholder-slate-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-lg font-medium text-slate-400">CFX</span>
          </div>
        </div>

        {/* Recipient */}
        <div className="bg-dark-card rounded-xl border border-dark-border p-5">
          <label className="block text-sm font-medium text-slate-400 mb-2">
            Recipient Stealth Address
          </label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x..."
            className="w-full bg-transparent text-base text-white placeholder-slate-500 focus:outline-none font-mono truncate"
          />
        </div>

        {/* Memo */}
        <div className="bg-dark-card rounded-xl border border-dark-border p-5">
          <label className="block text-sm font-medium text-slate-400 mb-2">
            Memo (optional)
          </label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="What's this for?"
            className="w-full bg-transparent text-base text-white placeholder-slate-500 focus:outline-none"
          />
        </div>

        {/* Info bar */}
        <div className="flex items-center gap-2 px-1 text-sm text-slate-400">
          <svg className="w-4 h-4 text-pavv-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          <span>Requires {thresholdValue} of {totalSigners} signers to approve.</span>
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={!recipient || !amount || isCreating || unspentNotes.length === 0}
          className="w-full py-3.5 bg-pavv-500 hover:bg-pavv-600 disabled:bg-dark-surface disabled:text-slate-500 text-white font-semibold rounded-xl text-base transition-colors duration-200 cursor-pointer flex items-center justify-center gap-2"
        >
          {isCreating ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
              </svg>
              Create & Sign
            </>
          )}
        </button>
      </form>
    </div>
  );
}
