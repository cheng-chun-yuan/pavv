import { useReducer, useState } from "react";
import { Header } from "./components/Header";
import { Dashboard } from "./components/Dashboard";
import { InitKeys } from "./components/InitKeys";
import { CreatePayment } from "./components/CreatePayment";
import { ApprovalQueue } from "./components/ApprovalQueue";
import { AuditExport } from "./components/AuditExport";
import {
  treasuryReducer,
  initialState,
  type TreasuryAction,
  type SignerRole,
  type PendingPayment,
} from "./store/treasury";

type Tab = "dashboard" | "payment" | "approvals" | "audit";

export default function App() {
  const [state, dispatch] = useReducer(treasuryReducer, initialState);
  const [tab, setTab] = useState<Tab>("dashboard");

  const handleInit = () => {
    dispatch({ type: "INIT_KEYS" });
    dispatch({ type: "SET_SIGNER", role: "Accountant" });
    dispatch({ type: "SET_BALANCE", balance: "250,000" });
  };

  const handleCreatePayment = (payment: PendingPayment) => {
    dispatch({ type: "CREATE_PAYMENT", payment });
    dispatch({
      type: "ADD_SIGNATURE",
      paymentId: payment.id,
      signer: state.currentSigner!,
    });
    setTab("approvals");
  };

  const handleSign = (paymentId: string) => {
    if (!state.currentSigner) return;

    dispatch({
      type: "ADD_SIGNATURE",
      paymentId,
      signer: state.currentSigner,
    });

    // Check if we now have enough signatures
    const payment = state.pendingPayments.find((p) => p.id === paymentId);
    if (payment && payment.signatures.length + 1 >= payment.requiredSignatures) {
      // Simulate proof generation
      dispatch({ type: "UPDATE_STATUS", paymentId, status: "proving" });
      dispatch({
        type: "ADD_ACTIVITY",
        activity: {
          id: crypto.randomUUID(),
          type: "transfer",
          description: "Generating ZK proof (FROST sig + tx validity)...",
          timestamp: Date.now(),
          status: "pending",
        },
      });

      setTimeout(() => {
        dispatch({ type: "UPDATE_STATUS", paymentId, status: "submitted" });
        dispatch({
          type: "ADD_ACTIVITY",
          activity: {
            id: crypto.randomUUID(),
            type: "transfer",
            description: "ZK proof verified on Conflux eSpace!",
            timestamp: Date.now(),
            status: "success",
          },
        });
      }, 3000);
    }
  };

  if (!state.initialized) {
    return (
      <div className="min-h-screen">
        <Header
          currentSigner={null}
          onSignerChange={() => {}}
          initialized={false}
        />
        <main className="max-w-6xl mx-auto px-4 py-6">
          <InitKeys onInit={handleInit} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header
        currentSigner={state.currentSigner}
        onSignerChange={(role) => dispatch({ type: "SET_SIGNER", role })}
        initialized={state.initialized}
      />

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Tab Navigation */}
        <nav className="flex gap-1 mb-6 bg-gray-900 rounded-xl p-1 w-fit">
          {([
            ["dashboard", "Dashboard"],
            ["payment", "New Payment"],
            ["approvals", "Approvals"],
            ["audit", "Audit"],
          ] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === key
                  ? "bg-gun-600 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {label}
              {key === "approvals" &&
                state.pendingPayments.filter(
                  (p) => p.status === "pending" && !p.signatures.includes(state.currentSigner!)
                ).length > 0 && (
                  <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">
                    {
                      state.pendingPayments.filter(
                        (p) =>
                          p.status === "pending" &&
                          !p.signatures.includes(state.currentSigner!)
                      ).length
                    }
                  </span>
                )}
            </button>
          ))}
        </nav>

        {/* Tab Content */}
        {tab === "dashboard" && <Dashboard state={state} />}

        {tab === "payment" && state.currentSigner && (
          <CreatePayment
            currentSigner={state.currentSigner}
            onCreatePayment={handleCreatePayment}
          />
        )}

        {tab === "approvals" && state.currentSigner && (
          <ApprovalQueue
            payments={state.pendingPayments}
            currentSigner={state.currentSigner}
            onSign={handleSign}
          />
        )}

        {tab === "audit" && <AuditExport state={state} />}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-12">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between text-xs text-gray-600">
          <span>BLSGun - FROST 2-of-3 on Grumpkin | Noir ZK | Conflux eSpace</span>
          <span>Hackathon Demo</span>
        </div>
      </footer>
    </div>
  );
}
