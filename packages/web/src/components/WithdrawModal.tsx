import { useState } from "react";
import type { PendingPayment, GroupConfig, CurvePoint } from "../store/treasury";
import type { ScannedNote } from "../lib/balanceScanner";
import { initHash, poseidon2Hash2 } from "@blsgun/sdk/hash";
import { computeNullifier } from "@blsgun/sdk/transaction";
import { scalarMul, pointAdd, toAffine, fromAffine, G } from "@blsgun/sdk/grumpkin";
import { parseEther, formatEther } from "viem";
import { deriveNonces } from "../lib/frostSigning";
import { getSession } from "../lib/session";

interface WithdrawModalProps {
  open: boolean;
  onClose: () => void;
  notes?: ScannedNote[];
  groupPublicKey?: CurvePoint | null;
  groupConfig?: GroupConfig | null;
  onCreateWithdraw: (payment: PendingPayment) => void;
}

export function WithdrawModal({
  open,
  onClose,
  notes,
  groupPublicKey,
  groupConfig,
  onCreateWithdraw,
}: WithdrawModalProps) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedNoteIdx, setSelectedNoteIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  if (!open) return null;

  const unspentNotes = (notes ?? []).filter((n) => !n.isSpent && n.amount > 0n);
  const threshold = groupConfig?.threshold ?? 2;

  const handleCreateWithdraw = async () => {
    setError(null);

    if (!recipient || !recipient.startsWith("0x") || recipient.length !== 42) {
      setError("Please enter a valid address (0x...)");
      return;
    }

    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      setError("Please enter a valid amount.");
      return;
    }

    setIsCreating(true);

    try {
      await initHash();

      const amountWei = parseEther(amount);

      // Select note to spend
      let noteToSpend: ScannedNote;
      if (selectedNoteIdx !== null) {
        noteToSpend = unspentNotes[selectedNoteIdx];
        if (noteToSpend.amount < amountWei) {
          throw new Error("Selected note has insufficient balance");
        }
      } else {
        const suitable = unspentNotes
          .filter((n) => n.amount >= amountWei)
          .sort((a, b) => (a.amount < b.amount ? -1 : 1));
        if (suitable.length === 0) {
          throw new Error("No note with sufficient balance for this withdrawal");
        }
        noteToSpend = suitable[0];
      }

      // Compute stealth public key for spendingKeyHash
      const stealthPubKey = toAffine(
        pointAdd(
          scalarMul(G, noteToSpend.stealthScalar),
          fromAffine({ x: BigInt(groupPublicKey!.x), y: BigInt(groupPublicKey!.y) })
        )
      );
      const spendingKeyHash = poseidon2Hash2(stealthPubKey.x, stealthPubKey.y);

      // Compute nullifier and message (must match circuit: message = hash_2(nullifier, commitment))
      const nullifier = computeNullifier(spendingKeyHash, BigInt(noteToSpend.leafIndex));
      const inputCommitmentBigint = BigInt(noteToSpend.commitment);
      const message = poseidon2Hash2(nullifier, inputCommitmentBigint);

      const paymentId = crypto.randomUUID();

      // Derive nonces for current signer
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
        recipient: `${recipient.slice(0, 10)}...${recipient.slice(-8)}`,
        amount,
        memo: "Withdraw to public address",
        createdBy: session.share.role,
        createdAt: Date.now(),
        signatures: [],
        requiredSignatures: threshold,
        status: "pending",
        txType: "withdraw",
        signingData: {
          inputCommitment: noteToSpend.commitment,
          inputAmount: noteToSpend.amount.toString(),
          inputBlinding: noteToSpend.blinding.toString(),
          inputLeafIndex: noteToSpend.leafIndex,
          inputStealthScalar: noteToSpend.stealthScalar.toString(),
          inputStealthPubKeyX: stealthPubKey.x.toString(),
          inputStealthPubKeyY: stealthPubKey.y.toString(),
          inputSpendingKeyHash: spendingKeyHash.toString(),
          withdrawRecipient: recipient,
          withdrawAmountWei: amountWei.toString(),
          message: message.toString(),
          nullifier: nullifier.toString(),
          nonceCommitments,
          partialSignatures: {},
        },
      };

      onCreateWithdraw(payment);
      setRecipient("");
      setAmount("");
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to create withdraw request");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-[#242A2E] rounded-2xl p-6 max-w-md w-full mx-4 border border-dark-border shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-xl font-semibold text-white">Withdraw (Unshield)</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-sm text-slate-400 mb-4">
          Withdraw shielded CFX to a public Conflux eSpace address. This requires threshold signatures and a ZK proof.
        </p>

        {/* Note selection */}
        {unspentNotes.length > 0 && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-200 mb-2">Select Note to Spend</label>
            <div className="space-y-2 max-h-32 overflow-y-auto">
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
                </button>
              ))}
            </div>
            {selectedNoteIdx === null && (
              <p className="text-xs text-slate-500 mt-1">
                Auto-selects smallest sufficient note if none chosen
              </p>
            )}
          </div>
        )}

        {/* Recipient */}
        <div className="mb-3">
          <label className="block text-sm font-medium text-slate-200 mb-1">Recipient Address</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x..."
            className="w-full bg-dark-surface border border-dark-border rounded-lg px-3 py-2.5 text-base text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-pavv-500 focus:border-transparent transition-colors duration-200"
          />
        </div>

        {/* Amount */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-200 mb-1">Amount</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              min="0"
              step="0.01"
              className="flex-1 bg-dark-surface border border-dark-border rounded-lg px-3 py-2.5 text-base text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-pavv-500 focus:border-transparent transition-colors duration-200"
            />
            <span className="text-sm font-medium text-slate-400">CFX</span>
          </div>
        </div>

        {/* Info */}
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-2 mb-4">
          <svg className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <p className="text-xs text-amber-400">
            Unshielding requires {threshold} signers and a ZK proof. This will be submitted as a pending transaction for co-signers to approve.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg mb-4">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        <button
          disabled={!recipient || !amount || isCreating || unspentNotes.length === 0}
          className="w-full py-3 bg-pavv-500 hover:bg-pavv-600 text-white rounded-lg text-base font-semibold transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          onClick={handleCreateWithdraw}
        >
          {isCreating ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Creating...
            </>
          ) : (
            "Create Withdraw Request"
          )}
        </button>
      </div>
    </div>
  );
}
