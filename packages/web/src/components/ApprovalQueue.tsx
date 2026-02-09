import { useState } from "react";
import type { PendingPayment, SignerRole, GroupConfig } from "../store/treasury";
import { PROVING_STEPS, type ProvingStep } from "../store/treasury";

interface ApprovalQueueProps {
  payments: PendingPayment[];
  currentSigner: SignerRole;
  onSign: (paymentId: string) => void;
  groupConfig?: GroupConfig | null;
}

const RANK_LABELS = ["Admin", "Mgr", "Emp", "R3", "R4", "R5"];

export function ApprovalQueue({ payments, currentSigner, onSign, groupConfig }: ApprovalQueueProps) {
  const [signingPayment, setSigningPayment] = useState<string | null>(null);

  const pendingPayments = payments.filter(
    (p) => p.status === "pending" || p.status === "signing" || p.status === "proving"
  );

  if (pendingPayments.length === 0) {
    return (
      <div className="bg-dark-card rounded-xl border border-dark-border shadow-card p-8 text-center">
        <svg className="w-12 h-12 text-slate-500 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-slate-400 text-base">No pending transactions</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-white">Transactions</h2>

      {pendingPayments.map((payment) => {
        const signingData = payment.signingData;
        const nonceCount = signingData ? Object.keys(signingData.nonceCommitments).length : 0;
        const partialSigCount = signingData ? Object.keys(signingData.partialSignatures).length : 0;
        const threshold = payment.requiredSignatures;

        // Find current signer's index
        const roleIdx = groupConfig?.roles?.indexOf(currentSigner) ?? -1;
        const mySignerIndex = String(roleIdx >= 0 ? roleIdx + 1 : 1);

        const hasMyNonce = !!signingData?.nonceCommitments[mySignerIndex];
        const hasMyPartialSig = !!signingData?.partialSignatures[mySignerIndex];
        const noncesLocked = nonceCount >= threshold;
        const allSigsReady = partialSigCount >= threshold;
        const isSigning = signingPayment === payment.id;

        // Once threshold nonces are collected, only those signers can sign
        const isParticipant = hasMyNonce || !noncesLocked;
        const lockedOut = noncesLocked && !hasMyNonce;

        // Derive who actually signed from partialSignatures keys → role names
        const signedRoles: string[] = signingData
          ? Object.keys(signingData.partialSignatures).map((idx) => {
              const roleIndex = parseInt(idx) - 1;
              return groupConfig?.roles?.[roleIndex] ?? `Signer ${idx}`;
            })
          : [];

        // Derive nonce contributors for display
        const nonceRoles: string[] = signingData
          ? Object.keys(signingData.nonceCommitments).map((idx) => {
              const roleIndex = parseInt(idx) - 1;
              return groupConfig?.roles?.[roleIndex] ?? `Signer ${idx}`;
            })
          : [];

        let statusLabel: string;
        let statusStyle: string;
        if (payment.status === "proving") {
          const activeStep = PROVING_STEPS.find(s => s.key === payment.provingStep);
          statusLabel = activeStep ? `${activeStep.label}...` : "Processing...";
          statusStyle = "bg-purple-500/15 text-purple-400";
        } else if (payment.status === "submitted") {
          statusLabel = "Submitted";
          statusStyle = "bg-pavv-500/15 text-pavv-400";
        } else if (allSigsReady) {
          statusLabel = "Ready to submit";
          statusStyle = "bg-pavv-500/15 text-pavv-400";
        } else if (hasMyPartialSig) {
          statusLabel = `${partialSigCount}/${threshold} signed`;
          statusStyle = "bg-blue-500/15 text-blue-400";
        } else if (lockedOut) {
          statusLabel = "Not in signing group";
          statusStyle = "bg-slate-500/15 text-slate-400";
        } else {
          statusLabel = "Awaiting approval";
          statusStyle = "bg-yellow-500/15 text-yellow-400";
        }

        return (
          <div
            key={payment.id}
            className="bg-dark-card rounded-xl border border-dark-border shadow-card p-6"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-semibold text-white">{payment.amount} CFX</p>
                  {payment.txType && (
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      payment.txType === "withdraw"
                        ? "bg-amber-500/15 text-amber-400"
                        : "bg-blue-500/15 text-blue-400"
                    }`}>
                      {payment.txType === "withdraw" ? "Withdraw" : "Send"}
                    </span>
                  )}
                </div>
                <p className="text-base text-slate-400 mt-0.5">
                  {payment.txType === "withdraw" && signingData?.withdrawRecipient
                    ? `To: ${signingData.withdrawRecipient.slice(0, 10)}...${signingData.withdrawRecipient.slice(-8)}`
                    : `To: ${payment.recipient}`}
                </p>
                {payment.memo && (
                  <p className="text-base text-slate-400 mt-1">{payment.memo}</p>
                )}
              </div>
              <span className={`text-sm font-medium px-3 py-1 rounded-full ${statusStyle}`}>
                {statusLabel}
              </span>
            </div>

            {/* Signature Progress */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-base mb-2">
                <span className="text-slate-400">Signatures</span>
                <span className={allSigsReady ? "text-pavv-400 font-medium" : "text-yellow-400 font-medium"}>
                  {partialSigCount}/{threshold}
                </span>
              </div>
              <div className="w-full bg-dark-surface rounded-full h-2.5">
                <div
                  className="h-2.5 rounded-full transition-all duration-500 bg-pavv-500"
                  style={{
                    width: `${(partialSigCount / threshold) * 100}%`,
                  }}
                />
              </div>

              <div className="flex gap-2 mt-2 flex-wrap">
                {signedRoles.map((signer) => {
                  const isHTSS = groupConfig?.mode === "HTSS";
                  const signerIdx = groupConfig?.roles?.indexOf(signer) ?? -1;
                  const rank = isHTSS && signerIdx >= 0 && groupConfig?.signerRanks
                    ? groupConfig.signerRanks[signerIdx]
                    : undefined;
                  return (
                    <span
                      key={signer}
                      className="text-sm bg-pavv-500/15 text-pavv-400 px-2.5 py-0.5 rounded font-medium inline-flex items-center gap-1"
                    >
                      {signer}
                      {rank !== undefined && (
                        <span className="text-[10px] opacity-70">[{RANK_LABELS[rank] ?? `R${rank}`}]</span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            {payment.status === "pending" && !hasMyPartialSig && !allSigsReady && isParticipant && (
              <button
                onClick={() => {
                  setSigningPayment(payment.id);
                  onSign(payment.id);
                  setTimeout(() => setSigningPayment(null), 1000);
                }}
                disabled={isSigning}
                className="w-full py-3 bg-pavv-500 hover:bg-pavv-600 text-white rounded-lg font-medium text-base transition-colors duration-200 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSigning ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Signing...
                  </>
                ) : (
                  `Approve & Sign as ${currentSigner}`
                )}
              </button>
            )}

            {payment.status === "pending" && allSigsReady && (
              <button
                onClick={() => {
                  setSigningPayment(payment.id);
                  onSign(payment.id);
                }}
                disabled={isSigning}
                className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium text-base transition-colors duration-200 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSigning ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Preparing...
                  </>
                ) : (
                  "Generate Proof & Submit"
                )}
              </button>
            )}

            {payment.status === "pending" && lockedOut && (
              <p className="text-base text-slate-500 text-center py-2">
                Signing group is locked: {nonceRoles.join(", ")}
              </p>
            )}

            {payment.status === "pending" && hasMyPartialSig && !allSigsReady && (
              <p className="text-base text-slate-400 text-center py-2">
                Signed. Waiting for {threshold - partialSigCount} more signer{threshold - partialSigCount > 1 ? "s" : ""}...
              </p>
            )}

            {payment.status === "proving" && (
              <div className="py-3 space-y-2">
                {PROVING_STEPS.map((step, idx) => {
                  const currentIdx = PROVING_STEPS.findIndex(s => s.key === payment.provingStep);
                  const isDone = idx < currentIdx;
                  const isActive = idx === currentIdx;
                  const isPending = idx > currentIdx;

                  return (
                    <div key={step.key} className="flex items-center gap-3">
                      {isDone && (
                        <svg className="w-5 h-5 text-pavv-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      )}
                      {isActive && (
                        <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin shrink-0" />
                      )}
                      {isPending && (
                        <div className="w-5 h-5 rounded-full border-2 border-slate-600 shrink-0" />
                      )}
                      <span className={`text-sm ${isDone ? "text-pavv-400" : isActive ? "text-purple-300" : "text-slate-500"}`}>
                        {step.label}{isActive ? "..." : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {payment.status === "submitted" && (
              <div className="text-center py-2">
                <span className="text-base text-pavv-400 font-medium">
                  Submitted to Conflux eSpace
                </span>
              </div>
            )}

            <p className="text-sm text-slate-400 mt-3">
              Created by {payment.createdBy} at{" "}
              {new Date(payment.createdAt).toLocaleString()}
            </p>
          </div>
        );
      })}
    </div>
  );
}

