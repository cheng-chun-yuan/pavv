import { useState } from "react";
import type { PendingPayment, SignerRole, GroupConfig } from "../store/treasury";

interface CreatePaymentProps {
  currentSigner: SignerRole;
  onCreatePayment: (payment: PendingPayment) => void;
  groupConfig: GroupConfig | null;
}

export function CreatePayment({ currentSigner, onCreatePayment, groupConfig }: CreatePaymentProps) {
  const thresholdValue = groupConfig?.threshold ?? 2;
  const totalSigners = groupConfig?.totalSigners ?? 3;
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipient || !amount) return;

    const payment: PendingPayment = {
      id: crypto.randomUUID(),
      recipient,
      amount,
      memo,
      createdBy: currentSigner,
      createdAt: Date.now(),
      signatures: [currentSigner],
      requiredSignatures: thresholdValue,
      status: "pending",
    };

    onCreatePayment(payment);
    setRecipient("");
    setAmount("");
    setMemo("");
  };

  return (
    <div className="max-w-xl">
      <div className="bg-dark-card rounded-xl border border-dark-border shadow-card p-6">
        <h2 className="text-xl font-semibold text-white mb-1">New Transaction</h2>
        <p className="text-base text-slate-400 mb-6">
          Create a private payment request. Requires {thresholdValue}-of-{totalSigners} MPC threshold signatures.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-base font-medium text-slate-200 mb-1">
              Recipient Stealth Address
            </label>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="0x..."
              className="w-full bg-dark-surface border border-dark-border rounded-lg px-4 py-3 text-base text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-pavv-500 focus:border-transparent transition-colors duration-200"
            />
          </div>

          <div>
            <label className="block text-base font-medium text-slate-200 mb-1">
              Amount (CFX)
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="50000"
              className="w-full bg-dark-surface border border-dark-border rounded-lg px-4 py-3 text-base text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-pavv-500 focus:border-transparent transition-colors duration-200"
            />
          </div>

          <div>
            <label className="block text-base font-medium text-slate-200 mb-1">Memo</label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Q4 supplier payment"
              className="w-full bg-dark-surface border border-dark-border rounded-lg px-4 py-3 text-base text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-pavv-500 focus:border-transparent transition-colors duration-200"
            />
          </div>

          <button
            type="submit"
            disabled={!recipient || !amount}
            className="w-full py-3 bg-pavv-500 hover:bg-pavv-600 disabled:bg-dark-surface disabled:text-slate-500 text-white font-semibold rounded-xl text-base transition-colors duration-200 cursor-pointer"
          >
            Send (1/{thresholdValue})
          </button>
        </form>
      </div>
    </div>
  );
}
