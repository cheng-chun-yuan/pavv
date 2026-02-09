import { useState } from "react";
import { formatEther } from "viem";
import type { TreasuryState } from "../store/treasury";
import type { ScannedNote } from "../lib/balanceScanner";

interface AuditExportProps {
  state: TreasuryState;
  notes: ScannedNote[];
}

export function AuditExport({ state, notes }: AuditExportProps) {
  const [exported, setExported] = useState(false);
  const [tab, setTab] = useState<"notes" | "history">("notes");

  const totalBalance = notes
    .filter((n) => !n.isSpent && n.amount > 0n)
    .reduce((sum, n) => sum + n.amount, 0n);
  const totalDeposited = notes
    .filter((n) => n.type === "shield")
    .reduce((sum, n) => sum + n.amount, 0n);
  const spentCount = notes.filter((n) => n.isSpent).length;
  const unspentCount = notes.filter((n) => !n.isSpent).length;

  const completedPayments = state.pendingPayments.filter(
    (p) => p.status === "submitted" || p.status === "confirmed"
  );

  const handleExport = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalNotes: notes.length,
        unspentNotes: unspentCount,
        spentNotes: spentCount,
        currentBalance: formatEther(totalBalance) + " CFX",
        totalDeposited: formatEther(totalDeposited) + " CFX",
      },
      notes: notes.map((n) => ({
        commitment: n.commitment,
        amount: formatEther(n.amount) + " CFX",
        type: n.type,
        isSpent: n.isSpent,
        leafIndex: n.leafIndex,
        blockNumber: n.blockNumber,
        txHash: n.txHash,
      })),
      transactions: completedPayments.map((p) => ({
        amount: p.amount + " CFX",
        type: p.txType,
        recipient: p.recipient,
        memo: p.memo,
        createdAt: new Date(p.createdAt).toISOString(),
        signatures: p.signatures,
      })),
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pavv-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
    setTimeout(() => setExported(false), 3000);
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
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
            <p className="text-base font-medium text-white">Treasury Audit</p>
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

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="bg-dark-card rounded-xl border border-dark-border p-4">
          <p className="text-xs text-slate-400 mb-1">Current Balance</p>
          <p className="text-lg font-bold text-white">{formatEther(totalBalance)} <span className="text-sm text-slate-400">CFX</span></p>
        </div>
        <div className="bg-dark-card rounded-xl border border-dark-border p-4">
          <p className="text-xs text-slate-400 mb-1">Total Deposited</p>
          <p className="text-lg font-bold text-white">{formatEther(totalDeposited)} <span className="text-sm text-slate-400">CFX</span></p>
        </div>
        <div className="bg-dark-card rounded-xl border border-dark-border p-4">
          <p className="text-xs text-slate-400 mb-1">Unspent Notes</p>
          <p className="text-lg font-bold text-pavv-400">{unspentCount}</p>
        </div>
        <div className="bg-dark-card rounded-xl border border-dark-border p-4">
          <p className="text-xs text-slate-400 mb-1">Spent Notes</p>
          <p className="text-lg font-bold text-red-400">{spentCount}</p>
        </div>
      </div>

      {/* Tab toggle */}
      <div className="flex gap-1 bg-dark-card rounded-lg p-1 border border-dark-border mb-4">
        <button
          onClick={() => setTab("notes")}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors cursor-pointer ${
            tab === "notes" ? "bg-pavv-500/20 text-pavv-400" : "text-slate-400 hover:text-white"
          }`}
        >
          On-chain Notes ({notes.length})
        </button>
        <button
          onClick={() => setTab("history")}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors cursor-pointer ${
            tab === "history" ? "bg-pavv-500/20 text-pavv-400" : "text-slate-400 hover:text-white"
          }`}
        >
          Transaction History ({completedPayments.length})
        </button>
      </div>

      {/* Notes tab */}
      {tab === "notes" && (
        <>
          {notes.length === 0 ? (
            <div className="bg-dark-card rounded-xl border border-dark-border p-8 text-center">
              <svg className="w-10 h-10 text-slate-500 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <p className="text-slate-400">No notes found. Deposit to see notes here.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {notes.map((note, i) => (
                <div
                  key={note.commitment + i}
                  className="bg-dark-card rounded-xl border border-dark-border p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        note.isSpent ? "bg-red-500/15" : "bg-pavv-500/15"
                      }`}>
                        {note.type === "shield" ? (
                          <svg className={`w-4 h-4 ${note.isSpent ? "text-red-400" : "text-pavv-400"}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m0 0l-6.75-6.75M12 19.5l6.75-6.75" />
                          </svg>
                        ) : (
                          <svg className={`w-4 h-4 ${note.isSpent ? "text-red-400" : "text-pavv-400"}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                          </svg>
                        )}
                      </div>
                      <div>
                        <p className="text-base font-semibold text-white">
                          {formatEther(note.amount)} CFX
                        </p>
                        <p className="text-xs text-slate-500">
                          {note.type === "shield" ? "Deposit" : "Transfer"} at block {note.blockNumber}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">Leaf #{note.leafIndex}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        note.isSpent
                          ? "bg-red-500/15 text-red-400"
                          : "bg-pavv-500/15 text-pavv-400"
                      }`}>
                        {note.isSpent ? "Spent" : "Unspent"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span className="font-mono truncate max-w-[200px]" title={note.commitment}>
                      {note.commitment.slice(0, 14)}...{note.commitment.slice(-8)}
                    </span>
                    <a
                      href={`https://evmtestnet.confluxscan.org/tx/${note.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-pavv-400 hover:underline flex items-center gap-1"
                    >
                      View tx
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* History tab */}
      {tab === "history" && (
        <>
          {completedPayments.length === 0 ? (
            <div className="bg-dark-card rounded-xl border border-dark-border p-8 text-center">
              <svg className="w-10 h-10 text-slate-500 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <p className="text-slate-400">No completed transactions yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {completedPayments.map((tx) => (
                <div
                  key={tx.id}
                  className="bg-dark-card rounded-xl border border-dark-border p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        tx.txType === "withdraw" ? "bg-amber-500/15" : "bg-pavv-500/15"
                      }`}>
                        <svg className={`w-4 h-4 ${tx.txType === "withdraw" ? "text-amber-400" : "text-pavv-400"}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-base font-semibold text-white">{tx.amount} CFX</p>
                        <p className="text-xs text-slate-500">
                          {tx.txType === "withdraw" ? "Withdraw" : "Send"} to {tx.recipient}
                        </p>
                      </div>
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      tx.txType === "withdraw" ? "bg-amber-500/15 text-amber-400" : "bg-pavv-500/15 text-pavv-400"
                    }`}>
                      {tx.txType === "withdraw" ? "Withdraw" : "Send"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <div className="flex items-center gap-2">
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
                  <div className="mt-2 flex items-center gap-1">
                    <span className="text-xs text-slate-500">Signers:</span>
                    {tx.signatures.map((signer) => (
                      <span key={signer} className="text-xs bg-pavv-500/15 text-pavv-400 px-1.5 py-0.5 rounded font-medium">
                        {signer}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
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
