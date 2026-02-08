import { useState } from "react";
import type { PendingPayment, SignerRole, GroupConfig } from "../store/treasury";

interface CreatePaymentProps {
  currentSigner: SignerRole;
  onCreatePayment: (payment: PendingPayment) => void;
  groupConfig: GroupConfig | null;
  balance?: string;
}

export function CreatePayment({ currentSigner, onCreatePayment, groupConfig, balance }: CreatePaymentProps) {
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

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Amount - big and prominent */}
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
            Recipient
          </label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Stealth address (0x...)"
            className="w-full bg-transparent text-base text-white placeholder-slate-500 focus:outline-none"
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
          <span>Requires {thresholdValue} of {totalSigners} signers to approve. Your signature is added automatically.</span>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={!recipient || !amount}
          className="w-full py-3.5 bg-pavv-500 hover:bg-pavv-600 disabled:bg-dark-surface disabled:text-slate-500 text-white font-semibold rounded-xl text-base transition-colors duration-200 cursor-pointer flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
          </svg>
          Send & Sign
        </button>
      </form>
    </div>
  );
}
