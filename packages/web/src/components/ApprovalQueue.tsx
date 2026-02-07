import { useState } from "react";
import type { PendingPayment, SignerRole } from "../store/treasury";

interface ApprovalQueueProps {
  payments: PendingPayment[];
  currentSigner: SignerRole;
  onSign: (paymentId: string) => void;
}

export function ApprovalQueue({ payments, currentSigner, onSign }: ApprovalQueueProps) {
  const pendingPayments = payments.filter(
    (p) => p.status === "pending" || p.status === "signing"
  );

  if (pendingPayments.length === 0) {
    return (
      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6 text-center">
        <p className="text-gray-500">No pending approvals</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Approval Queue</h2>

      {pendingPayments.map((payment) => {
        const alreadySigned = payment.signatures.includes(currentSigner);
        const sigCount = payment.signatures.length;
        const isComplete = sigCount >= payment.requiredSignatures;

        return (
          <div
            key={payment.id}
            className="bg-gray-900 rounded-xl border border-gray-800 p-5"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="font-semibold">{payment.amount} CFX</p>
                <p className="text-sm text-gray-400 mt-0.5">
                  To: {payment.recipient.slice(0, 10)}...
                  {payment.recipient.slice(-8)}
                </p>
                {payment.memo && (
                  <p className="text-sm text-gray-500 mt-1">{payment.memo}</p>
                )}
              </div>
              <StatusBadge status={payment.status} />
            </div>

            {/* Signature Progress */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-gray-400">Signatures</span>
                <span className={isComplete ? "text-green-400" : "text-yellow-400"}>
                  {sigCount}/{payment.requiredSignatures}
                </span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${
                    isComplete ? "bg-green-500" : "bg-gun-500"
                  }`}
                  style={{
                    width: `${(sigCount / payment.requiredSignatures) * 100}%`,
                  }}
                />
              </div>
              <div className="flex gap-2 mt-2">
                {payment.signatures.map((signer) => (
                  <span
                    key={signer}
                    className="text-xs bg-green-900/50 text-green-400 px-2 py-0.5 rounded"
                  >
                    {signer}
                  </span>
                ))}
              </div>
            </div>

            {/* Actions */}
            {!isComplete && !alreadySigned && (
              <button
                onClick={() => onSign(payment.id)}
                className="w-full py-2.5 bg-gun-600 hover:bg-gun-500 rounded-lg font-medium text-sm transition-colors"
              >
                Approve & Sign as {currentSigner}
              </button>
            )}

            {alreadySigned && !isComplete && (
              <p className="text-sm text-gray-500 text-center py-2">
                You have signed. Waiting for another signer...
              </p>
            )}

            {isComplete && payment.status === "pending" && (
              <div className="text-center py-2">
                <span className="text-sm text-gun-400 animate-pulse">
                  Generating ZK proof...
                </span>
              </div>
            )}

            {payment.status === "submitted" && (
              <div className="text-center py-2">
                <span className="text-sm text-green-400">
                  Submitted to Conflux eSpace
                </span>
              </div>
            )}

            <p className="text-xs text-gray-600 mt-3">
              Created by {payment.createdBy} at{" "}
              {new Date(payment.createdAt).toLocaleString()}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: PendingPayment["status"] }) {
  const colors = {
    pending: "bg-yellow-900/50 text-yellow-400",
    signing: "bg-blue-900/50 text-blue-400",
    proving: "bg-purple-900/50 text-purple-400",
    submitted: "bg-green-900/50 text-green-400",
    confirmed: "bg-green-900/50 text-green-400",
  };

  return (
    <span className={`text-xs px-2 py-1 rounded ${colors[status]}`}>
      {status}
    </span>
  );
}
