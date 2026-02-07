import { useState } from "react";
import type { PendingPayment, SignerRole } from "../store/treasury";

interface CreatePaymentProps {
  currentSigner: SignerRole;
  onCreatePayment: (payment: PendingPayment) => void;
}

export function CreatePayment({ currentSigner, onCreatePayment }: CreatePaymentProps) {
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
      signatures: [currentSigner], // Creator auto-signs
      requiredSignatures: 2,
      status: "pending",
    };

    onCreatePayment(payment);
    setRecipient("");
    setAmount("");
    setMemo("");
  };

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6">
      <h2 className="text-xl font-bold mb-4">Initiate Payment</h2>
      <p className="text-sm text-gray-400 mb-6">
        Create a private payment request. Requires 2-of-3 FROST signatures.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Recipient Stealth Address
          </label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gun-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Amount (CFX)
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="50000"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gun-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Memo</label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Q4 supplier payment"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gun-500 focus:border-transparent"
          />
        </div>

        <button
          type="submit"
          disabled={!recipient || !amount}
          className="w-full py-3 bg-gun-600 hover:bg-gun-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-xl font-semibold transition-colors"
        >
          Create & Sign (1/2)
        </button>
      </form>
    </div>
  );
}
