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
        const alreadySigned = payment.signatures.includes(currentSigner);
        const sigCount = payment.signatures.length;
        const isComplete = sigCount >= payment.requiredSignatures;

        return (
          <div
            key={payment.id}
            className="bg-dark-card rounded-xl border border-dark-border shadow-card p-6"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-lg font-semibold text-white">{payment.amount} CFX</p>
                <p className="text-base text-slate-400 mt-0.5">
                  To: {payment.recipient.slice(0, 10)}...
                  {payment.recipient.slice(-8)}
                </p>
                {payment.memo && (
                  <p className="text-base text-slate-400 mt-1">{payment.memo}</p>
                )}
              </div>
              <StatusBadge status={payment.status} />
            </div>

            {/* Signature Progress */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-base mb-2">
                <span className="text-slate-400">MPC Threshold Signatures</span>
                <span className={isComplete ? "text-pavv-400 font-medium" : "text-yellow-400 font-medium"}>
                  {sigCount}/{payment.requiredSignatures}
                </span>
              </div>
              <div className="w-full bg-dark-surface rounded-full h-2.5">
                <div
                  className="h-2.5 rounded-full transition-all duration-500 bg-pavv-500"
                  style={{
                    width: `${(sigCount / payment.requiredSignatures) * 100}%`,
                  }}
                />
              </div>
              <div className="flex gap-2 mt-2">
                {payment.signatures.map((signer) => (
                  <span
                    key={signer}
                    className="text-sm bg-pavv-500/15 text-pavv-400 px-2.5 py-0.5 rounded font-medium"
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
                className="w-full py-3 bg-pavv-500 hover:bg-pavv-600 text-white rounded-lg font-medium text-base transition-colors duration-200 cursor-pointer"
              >
                Approve & Sign as {currentSigner}
              </button>
            )}

            {alreadySigned && !isComplete && (
              <p className="text-base text-slate-400 text-center py-2">
                You have signed. Waiting for another signer...
              </p>
            )}

            {isComplete && payment.status === "pending" && (
              <div className="text-center py-2">
                <span className="text-base text-pavv-400 animate-pulse">
                  Generating ZK proof...
                </span>
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

function StatusBadge({ status }: { status: PendingPayment["status"] }) {
  const styles = {
    pending: "bg-yellow-500/15 text-yellow-400",
    signing: "bg-blue-500/15 text-blue-400",
    proving: "bg-purple-500/15 text-purple-400",
    submitted: "bg-pavv-500/15 text-pavv-400",
    confirmed: "bg-pavv-500/15 text-pavv-400",
  };

  return (
    <span className={`text-sm font-medium px-3 py-1 rounded-full ${styles[status]}`}>
      {status}
    </span>
  );
}
