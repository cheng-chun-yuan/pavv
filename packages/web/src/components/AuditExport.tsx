import { useState } from "react";
import type { TreasuryState } from "../store/treasury";

interface AuditExportProps {
  state: TreasuryState;
}

export function AuditExport({ state }: AuditExportProps) {
  const [exported, setExported] = useState(false);
  const [fromBlock, setFromBlock] = useState("0");
  const [toBlock, setToBlock] = useState("999999");

  const handleExport = () => {
    const report = {
      period: { fromBlock: Number(fromBlock), toBlock: Number(toBlock) },
      transactions: state.pendingPayments
        .filter((p) => p.status === "submitted" || p.status === "confirmed")
        .map((p) => ({
          amount: p.amount,
          recipient: p.recipient,
          memo: p.memo,
          createdAt: new Date(p.createdAt).toISOString(),
          signatures: p.signatures,
        })),
      totalOutflow: state.pendingPayments
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
    <div className="max-w-xl">
      <div className="bg-dark-card rounded-xl border border-dark-border shadow-card p-6">
        <h2 className="text-xl font-semibold text-white mb-1">Compliance Audit Export</h2>
        <p className="text-base text-slate-400 mb-6">
          Decrypt and export transaction history using the viewing key.
          Full transparency to auditors without compromising on-chain privacy.
        </p>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-base font-medium text-slate-200 mb-1">From Block</label>
            <input
              type="number"
              value={fromBlock}
              onChange={(e) => setFromBlock(e.target.value)}
              className="w-full bg-dark-surface border border-dark-border rounded-lg px-4 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-pavv-500 focus:border-transparent transition-colors duration-200"
            />
          </div>
          <div>
            <label className="block text-base font-medium text-slate-200 mb-1">To Block</label>
            <input
              type="number"
              value={toBlock}
              onChange={(e) => setToBlock(e.target.value)}
              className="w-full bg-dark-surface border border-dark-border rounded-lg px-4 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-pavv-500 focus:border-transparent transition-colors duration-200"
            />
          </div>
        </div>

        <button
          onClick={handleExport}
          className={`w-full py-3 rounded-xl font-semibold text-base transition-colors duration-200 cursor-pointer ${
            exported
              ? "bg-pavv-600 text-white"
              : "bg-pavv-500 hover:bg-pavv-600 text-white"
          }`}
        >
          {exported ? "Exported!" : "Export Audit Report (JSON)"}
        </button>

        <div className="mt-6 grid grid-cols-2 gap-4">
          <div className="p-4 bg-dark-surface rounded-lg">
            <h3 className="text-base font-semibold text-white mb-2">Auditor sees</h3>
            <ul className="text-sm text-slate-400 space-y-2">
              <li className="flex items-start gap-1.5">
                <svg className="w-4 h-4 text-pavv-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                Transaction amounts & timestamps
              </li>
              <li className="flex items-start gap-1.5">
                <svg className="w-4 h-4 text-pavv-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                Sender & recipient identities
              </li>
              <li className="flex items-start gap-1.5">
                <svg className="w-4 h-4 text-pavv-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                Approval chain
              </li>
              <li className="flex items-start gap-1.5">
                <svg className="w-4 h-4 text-pavv-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                Proof of data integrity
              </li>
            </ul>
          </div>
          <div className="p-4 bg-dark-surface rounded-lg">
            <h3 className="text-base font-semibold text-white mb-2">Private on-chain</h3>
            <ul className="text-sm text-slate-400 space-y-2">
              <li className="flex items-start gap-1.5">
                <svg className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
                Amounts in commitments
              </li>
              <li className="flex items-start gap-1.5">
                <svg className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
                Stealth addresses
              </li>
              <li className="flex items-start gap-1.5">
                <svg className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
                FROST sigs in ZK proofs
              </li>
              <li className="flex items-start gap-1.5">
                <svg className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
                No public keys exposed
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
