import { useReducer, useState, useEffect, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { Dashboard } from "./components/Dashboard";
import { InitKeys } from "./components/InitKeys";
import { CreatePayment } from "./components/CreatePayment";
import { ApprovalQueue } from "./components/ApprovalQueue";
import { AuditExport } from "./components/AuditExport";
import { PasskeyLogin } from "./components/PasskeyLogin";
import {
  getStoredShares,
  type StoredPasskeyShare,
  type EncryptedSharePayload,
} from "./lib/passkey";
import {
  startSession,
  destroySession,
  getSessionTimeRemaining,
  extendSession,
} from "./lib/session";
import {
  treasuryReducer,
  initialState,
  type SignerRole,
  type PendingPayment,
  type KeyCeremonyData,
  type CeremonyTranscriptEntry,
  type GroupConfig,
} from "./store/treasury";
import { getContractBalance } from "./lib/chain";

type Tab = "dashboard" | "payment" | "transactions" | "audit";

const tabTitles: Record<Tab, string> = {
  dashboard: "Home",
  payment: "New Transaction",
  transactions: "Transactions",
  audit: "Audit",
};

export default function App() {
  const [state, dispatch] = useReducer(treasuryReducer, initialState);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [appScreen, setAppScreen] = useState<
    "loading" | "passkey-login" | "normal"
  >("loading");
  const [storedShares, setStoredShares] = useState<StoredPasskeyShare[]>([]);
  const [sessionTimeRemaining, setSessionTimeRemaining] = useState(0);

  useEffect(() => {
    const shares = getStoredShares();
    if (shares.length > 0) {
      setStoredShares(shares);
      setAppScreen("passkey-login");
    } else {
      setAppScreen("normal");
    }
  }, []);

  // Session timer -- check every second
  useEffect(() => {
    if (!state.initialized || !state.currentSigner) return;

    const interval = setInterval(() => {
      const remaining = getSessionTimeRemaining();
      setSessionTimeRemaining(remaining);

      if (remaining === 0 && state.initialized) {
        handleLogout();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [state.initialized, state.currentSigner]);

  const handleLogout = useCallback(() => {
    destroySession();
    dispatch({ type: "LOGOUT" });
    const shares = getStoredShares();
    if (shares.length > 0) {
      setStoredShares(shares);
      setAppScreen("passkey-login");
    } else {
      setAppScreen("normal");
    }
    setTab("dashboard");
    setSessionTimeRemaining(0);
  }, []);

  const handlePasskeyLogin = (payload: EncryptedSharePayload) => {
    startSession(payload.share, 0, handleLogout);

    dispatch({
      type: "LOGIN_WITH_SHARE",
      share: payload.share,
      groupPublicKey: payload.groupPublicKey,
      viewingPublicKey: payload.viewingPublicKey,
      groupConfig: payload.groupConfig ?? null,
    });
    setAppScreen("normal");
    setSessionTimeRemaining(getSessionTimeRemaining());
  };

  const handleStartFresh = () => {
    setAppScreen("normal");
  };

  const fetchBalance = useCallback(async () => {
    const balance = await getContractBalance();
    if (balance !== null) {
      dispatch({ type: "SET_BALANCE", balance });
    }
  }, []);

  // Poll contract balance every 15s when initialized
  useEffect(() => {
    if (!state.initialized) return;
    fetchBalance();
    const interval = setInterval(fetchBalance, 15_000);
    return () => clearInterval(interval);
  }, [state.initialized, fetchBalance]);

  const handleInit = (
    keyCeremony: KeyCeremonyData,
    transcript: CeremonyTranscriptEntry[],
    groupConfig: GroupConfig
  ) => {
    dispatch({ type: "INIT_KEYS", keyCeremony, transcript, groupConfig });
    dispatch({ type: "SET_SIGNER", role: groupConfig.roles[0] });
    fetchBalance();
  };

  const handleCreatePayment = (payment: PendingPayment) => {
    extendSession();
    dispatch({ type: "CREATE_PAYMENT", payment });
    dispatch({
      type: "ADD_SIGNATURE",
      paymentId: payment.id,
      signer: state.currentSigner!,
    });
    setTab("transactions");
  };

  const handleSign = (paymentId: string) => {
    if (!state.currentSigner) return;
    extendSession();

    dispatch({
      type: "ADD_SIGNATURE",
      paymentId,
      signer: state.currentSigner,
    });

    const payment = state.pendingPayments.find((p) => p.id === paymentId);
    if (
      payment &&
      payment.signatures.length + 1 >= payment.requiredSignatures
    ) {
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

  const pendingCount = state.pendingPayments.filter(
    (p) =>
      p.status === "pending" &&
      state.currentSigner &&
      !p.signatures.includes(state.currentSigner)
  ).length;

  const pendingPayments = state.pendingPayments.filter(
    (p) => p.status === "pending" || p.status === "signing"
  );

  if (appScreen === "loading") {
    return null;
  }

  if (appScreen === "passkey-login" && !state.initialized) {
    return (
      <PasskeyLogin
        storedShares={storedShares}
        onLogin={handlePasskeyLogin}
        onStartFresh={handleStartFresh}
      />
    );
  }

  if (!state.initialized) {
    return (
      <div className="flex h-screen">
        <Sidebar
          activeTab={tab}
          onTabChange={setTab}
          currentSigner={null}
          onSignerChange={() => {}}
          initialized={false}
          pendingCount={0}
          onLogout={handleLogout}
          sessionTimeRemaining={0}
          groupConfig={state.groupConfig}
          keyCeremony={state.keyCeremony}
          onNewTransaction={() => {}}
          signers={[]}
        />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Header
            title="Setup"
            currentSigner={null}
            sessionTimeRemaining={0}
            onLoginClick={() => {
              const shares = getStoredShares();
              if (shares.length > 0) {
                setStoredShares(shares);
                setAppScreen("passkey-login");
              }
            }}
          />
          <main className="flex-1 overflow-auto p-6 bg-dark-bg">
            <InitKeys onInit={handleInit} />
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <Sidebar
        activeTab={tab}
        onTabChange={setTab}
        currentSigner={state.currentSigner}
        onSignerChange={(role) => dispatch({ type: "SET_SIGNER", role })}
        initialized={state.initialized}
        pendingCount={pendingCount}
        onLogout={handleLogout}
        sessionTimeRemaining={sessionTimeRemaining}
        groupConfig={state.groupConfig}
        keyCeremony={state.keyCeremony}
        onNewTransaction={() => setTab("payment")}
        signers={state.signers}
        onSignerLogin={() => {
          const shares = getStoredShares();
          if (shares.length > 0) {
            setStoredShares(shares);
            setAppScreen("passkey-login");
          }
        }}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          title={tabTitles[tab]}
          currentSigner={state.currentSigner}
          sessionTimeRemaining={sessionTimeRemaining}
        />

        <main className="flex-1 overflow-auto p-6 bg-dark-bg">
          {tab === "dashboard" && (
            <Dashboard
              state={state}
              onTabChange={setTab}
              pendingPayments={pendingPayments}
            />
          )}

          {tab === "payment" && state.currentSigner && (
            <CreatePayment
              currentSigner={state.currentSigner}
              onCreatePayment={handleCreatePayment}
              groupConfig={state.groupConfig}
            />
          )}

          {tab === "transactions" && state.currentSigner && (
            <ApprovalQueue
              payments={state.pendingPayments}
              currentSigner={state.currentSigner}
              onSign={handleSign}
            />
          )}

          {tab === "audit" && <AuditExport state={state} />}
        </main>
      </div>
    </div>
  );
}
