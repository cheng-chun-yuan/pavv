import { useState } from "react";
import type { TreasuryState } from "../store/treasury";

interface AuditExportProps {
  state: TreasuryState;
}

export function AuditExport({ state }: AuditExportProps) {
  const [exported, setExported] = useState(false);
  const [fromBlock, setFromBlock] = useState("0");
  const [toBlock, setToBlock] = useState("999999");

  const allTransactions = state.pendingPayments;

  const handleExport = () => {
    const report = {
      period: { fromBlock: Number(fromBlock), toBlock: Number(toBlock) },
      transactions: allTransactions
        .filter((p) => p.status === "submitted" || p.status === "confirmed")
        .map((p) => ({
          amount: p.amount,
          recipient: p.recipient,
          memo: p.memo,
          createdAt: new Date(p.createdAt).toISOString(),
          signatures: p.signatures,
        })),
      totalOutflow: allTransactions
        .filter((p) => p.status === "submitted" || p.status === "confirmed")
        .reduce((sum, p) => sum + Number(p.amount), 0),
      generatedAt: new Date().toISOString(),
      viewingKeyScope: `blocks ${fromBlock}-${toBlock}`,
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pavv-audit-${fromBlock}-${toBlock}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
    setTimeout(() => setExported(false), 3000);
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Block range filter */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-pavv-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-pavv-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <p className="text-sm text-slate-400">Viewing key audit</p>
            <p className="text-base font-medium text-white">All Transactions</p>
          </div>
        </div>
        <button
          onClick={handleExport}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200 cursor-pointer flex items-center gap-2 ${
            exported
              ? "bg-pavv-600 text-white"
              : "bg-dark-card border border-dark-border text-slate-300 hover:bg-dark-surface"
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          {exported ? "Exported!" : "Export JSON"}
        </button>
      </div>

      {/* Block range */}
      <div className="bg-dark-card rounded-xl border border-dark-border p-5 mb-4">
        <label className="block text-sm font-medium text-slate-400 mb-2">Block Range</label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            value={fromBlock}
            onChange={(e) => setFromBlock(e.target.value)}
            className="flex-1 bg-transparent text-base text-white placeholder-slate-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            placeholder="0"
          />
          <span className="text-slate-500">to</span>
          <input
            type="number"
            value={toBlock}
            onChange={(e) => setToBlock(e.target.value)}
            className="flex-1 bg-transparent text-base text-white placeholder-slate-500 focus:outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            placeholder="999999"
          />
        </div>
      </div>

      {/* Transaction list */}
      {allTransactions.length === 0 ? (
        <div className="bg-dark-card rounded-xl border border-dark-border p-8 text-center">
          <svg className="w-10 h-10 text-slate-500 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <p className="text-slate-400">No transactions yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {allTransactions.map((tx) => (
            <div
              key={tx.id}
              className="bg-dark-card rounded-xl border border-dark-border p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    tx.status === "submitted" || tx.status === "confirmed"
                      ? "bg-pavv-500/20"
                      : tx.status === "proving"
                        ? "bg-purple-500/20"
                        : "bg-amber-500/20"
                  }`}>
                    <svg className={`w-4 h-4 ${
                      tx.status === "submitted" || tx.status === "confirmed"
                        ? "text-pavv-400"
                        : tx.status === "proving"
                          ? "text-purple-400"
                          : "text-amber-400"
                    }`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-base font-semibold text-white">{tx.amount} CFX</p>
                    <p className="text-sm text-slate-400">
                      To: {tx.recipient.slice(0, 10)}...{tx.recipient.slice(-6)}
                    </p>
                  </div>
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                  tx.status === "submitted" || tx.status === "confirmed"
                    ? "bg-pavv-500/15 text-pavv-400"
                    : tx.status === "proving"
                      ? "bg-purple-500/15 text-purple-400"
                      : "bg-amber-500/15 text-amber-400"
                }`}>
                  {tx.status}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm text-slate-400">
                <div className="flex items-center gap-3">
                  <span>By {tx.createdBy}</span>
                  {tx.memo && (
                    <>
                      <span className="text-dark-border">|</span>
                      <span>{tx.memo}</span>
                    </>
                  )}
                </div>
                <span>{new Date(tx.createdAt).toLocaleString()}</span>
              </div>

              {/* Signatures */}
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs text-slate-400">Signatures:</span>
                {tx.signatures.map((signer) => (
                  <span
                    key={signer}
                    className="text-xs bg-pavv-500/15 text-pavv-400 px-2 py-0.5 rounded font-medium"
                  >
                    {signer}
                  </span>
                ))}
                <span className="text-xs text-slate-500">
                  ({tx.signatures.length}/{tx.requiredSignatures})
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Privacy info */}
      <div className="mt-4 flex items-center gap-2 px-1 text-sm text-slate-400">
        <svg className="w-4 h-4 text-pavv-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
        <span>Decrypted via viewing key. On-chain data remains private (stealth addresses + ZK proofs).</span>
      </div>
    </div>
  );
}
