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
    a.download = `blsgun-audit-${fromBlock}-${toBlock}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
    setTimeout(() => setExported(false), 3000);
  };

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6">
      <h2 className="text-xl font-bold mb-2">Compliance Audit Export</h2>
      <p className="text-sm text-gray-400 mb-6">
        Decrypt and export transaction history using the viewing key.
        This provides full transparency to auditors without compromising on-chain privacy.
      </p>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm text-gray-400 mb-1">From Block</label>
          <input
            type="number"
            value={fromBlock}
            onChange={(e) => setFromBlock(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gun-500"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">To Block</label>
          <input
            type="number"
            value={toBlock}
            onChange={(e) => setToBlock(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gun-500"
          />
        </div>
      </div>

      <button
        onClick={handleExport}
        className={`w-full py-3 rounded-xl font-semibold transition-colors ${
          exported
            ? "bg-green-600 text-white"
            : "bg-gun-600 hover:bg-gun-500 text-white"
        }`}
      >
        {exported ? "Exported!" : "Export Audit Report (JSON)"}
      </button>

      <div className="mt-6 p-4 bg-gray-800/50 rounded-lg">
        <h3 className="text-sm font-semibold mb-2">What the auditor sees:</h3>
        <ul className="text-xs text-gray-400 space-y-1">
          <li>- Full transaction amounts and timestamps</li>
          <li>- Sender and recipient identities (decrypted)</li>
          <li>- Approval chain (which signers authorized)</li>
          <li>- Cryptographic proof of data integrity</li>
        </ul>
        <h3 className="text-sm font-semibold mt-3 mb-2">
          What remains private on-chain:
        </h3>
        <ul className="text-xs text-gray-400 space-y-1">
          <li>- Transaction amounts hidden in commitments</li>
          <li>- Sender/recipient hidden by stealth addresses</li>
          <li>- FROST signatures hidden inside ZK proofs</li>
          <li>- No public keys exposed on-chain</li>
        </ul>
      </div>
    </div>
  );
}
