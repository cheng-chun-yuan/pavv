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
  getViewingSecretKey,
  getSession,
} from "./lib/session";
import {
  treasuryReducer,
  initialState,
  savePendingPayments,
  loadPendingPayments,
  type SignerRole,
  type PendingPayment,
  type KeyCeremonyData,
  type CeremonyTranscriptEntry,
  type GroupConfig,
} from "./store/treasury";
import { getContractBalance, toBytes32 } from "./lib/chain";
import { scanBalance, getLocalMerkleTree, type ScannedNote } from "./lib/balanceScanner";
import { deriveNonces, computePartialSig, aggregateAndProve } from "./lib/frostSigning";
import { initHash } from "@blsgun/sdk/hash";
import { initProver } from "./lib/prover";
import { useWriteContract, useAccount, useConnect, useSwitchChain } from "wagmi";
import { blsGunAbi } from "./lib/abi";
import { getContractAddress } from "./lib/chain";
import { confluxESpaceTestnet, publicClient } from "./lib/wagmiConfig";

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
  const [isScanning, setIsScanning] = useState(false);
  const [noteCount, setNoteCount] = useState(0);
  const [balanceLoaded, setBalanceLoaded] = useState(false);
  const [scannedNotes, setScannedNotes] = useState<ScannedNote[]>([]);

  const { writeContractAsync } = useWriteContract();
  const { isConnected, chainId } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { switchChainAsync } = useSwitchChain();

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

  // Persist pending payments to localStorage whenever they change
  useEffect(() => {
    if (!state.initialized) return;
    savePendingPayments(state.pendingPayments);
  }, [state.initialized, state.pendingPayments]);

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
    startSession(payload.share, 0, handleLogout, payload.viewingSecretKey ?? "");

    dispatch({
      type: "LOGIN_WITH_SHARE",
      share: payload.share,
      groupPublicKey: payload.groupPublicKey,
      viewingPublicKey: payload.viewingPublicKey,
      groupConfig: payload.groupConfig ?? null,
    });

    // Restore pending payments from localStorage (signing state survives across logins)
    const saved = loadPendingPayments();
    if (saved.length > 0) {
      dispatch({ type: "RESTORE_PAYMENTS", payments: saved });
    }

    setAppScreen("normal");
    setSessionTimeRemaining(getSessionTimeRemaining());
  };

  const handleStartFresh = () => {
    setAppScreen("normal");
  };

  const fetchBalance = useCallback(async () => {
    const vsk = getViewingSecretKey();
    if (vsk) {
      setIsScanning(true);
      try {
        const gpk = state.keyCeremony?.groupPublicKey;
        const groupPK = gpk ? { x: BigInt(gpk.x), y: BigInt(gpk.y) } : undefined;
        const result = await scanBalance(vsk, groupPK);
        const unspent = result.notes.filter((n) => !n.isSpent);
        if (unspent.length > 0) {
          dispatch({ type: "SET_BALANCE", balance: result.formattedBalance });
        } else {
          dispatch({ type: "SET_BALANCE", balance: "0" });
        }
        setNoteCount(unspent.length);
        setScannedNotes(result.notes);
      } catch (err) {
        console.warn("[fetchBalance] scan failed:", err);
        dispatch({ type: "SET_BALANCE", balance: "0" });
      } finally {
        setIsScanning(false);
        setBalanceLoaded(true);
      }
    } else {
      dispatch({ type: "SET_BALANCE", balance: "0" });
      setBalanceLoaded(true);
    }
  }, [state.keyCeremony?.groupPublicKey]);

  // Poll balance every 30s when initialized
  useEffect(() => {
    if (!state.initialized) return;
    fetchBalance();
    const interval = setInterval(fetchBalance, 30_000);
    return () => clearInterval(interval);
  }, [state.initialized, fetchBalance]);

  // Eagerly initialize ZK prover in background after login
  useEffect(() => {
    if (!state.initialized) return;
    initProver().catch((err) => console.warn("[App] prover pre-init failed:", err));
  }, [state.initialized]);


  const handleInit = (
    keyCeremony: KeyCeremonyData,
    transcript: CeremonyTranscriptEntry[],
    groupConfig: GroupConfig,
    viewingSecretKey?: string
  ) => {
    if (viewingSecretKey) {
      startSession(
        { index: 1, role: groupConfig.roles[0], secretShare: "", publicShare: { x: "", y: "" } },
        0,
        handleLogout,
        viewingSecretKey
      );
    }
    dispatch({ type: "INIT_KEYS", keyCeremony, transcript, groupConfig });
    dispatch({ type: "SET_SIGNER", role: groupConfig.roles[0] });
    fetchBalance();
  };

  const handleCreatePayment = (payment: PendingPayment) => {
    extendSession();
    dispatch({ type: "CREATE_PAYMENT", payment });

    // Add nonce commitment from signingData (already computed in CreatePayment/WithdrawModal)
    if (payment.signingData) {
      const session = getSession();
      if (session) {
        const signerIndex = session.share.index.toString();
        const nc = payment.signingData.nonceCommitments[signerIndex];
        if (nc) {
          dispatch({
            type: "ADD_NONCE_COMMITMENT",
            paymentId: payment.id,
            signerIndex,
            ...nc,
          });
        }
      }
    }

    setTab("transactions");
  };

  const ensureWalletConnected = async () => {
    if (!isConnected) {
      const connector = connectors[0];
      if (!connector) throw new Error("No wallet connector available");
      await connectAsync({ connector });
    }
    if (chainId !== confluxESpaceTestnet.id) {
      await switchChainAsync({ chainId: confluxESpaceTestnet.id });
    }
  };

  const handleSign = async (paymentId: string) => {
    console.log("[handleSign] START paymentId=", paymentId);
    if (!state.currentSigner) { console.log("[handleSign] no currentSigner, abort"); return; }
    extendSession();
    await initHash();
    console.log("[handleSign] initHash done");

    const session = getSession();
    if (!session) { console.log("[handleSign] no session, abort"); return; }

    const payment = state.pendingPayments.find((p) => p.id === paymentId);
    if (!payment?.signingData) {
      console.log("[handleSign] no signingData, legacy path");
      dispatch({ type: "ADD_SIGNATURE", paymentId, signer: state.currentSigner });
      return;
    }

    const sd = payment.signingData;
    const signerIndex = session.share.index;
    const signerIndexStr = signerIndex.toString();
    const threshold = payment.requiredSignatures;
    console.log("[handleSign] signerIndex=", signerIndex, "threshold=", threshold);
    console.log("[handleSign] nonces=", Object.keys(sd.nonceCommitments).length, "partialSigs=", Object.keys(sd.partialSignatures).length);

    // 1. Derive nonces and add commitment if not yet done
    const existingNonceCount = Object.keys(sd.nonceCommitments).length;

    if (!sd.nonceCommitments[signerIndexStr]) {
      if (existingNonceCount >= threshold) {
        console.log("[handleSign] nonce slots full, can't join");
        return;
      }
      console.log("[handleSign] deriving nonces...");
      const nonce = deriveNonces(session.share.secretShare, payment.id);
      dispatch({
        type: "ADD_NONCE_COMMITMENT",
        paymentId,
        signerIndex: signerIndexStr,
        Dx: nonce.D.x.toString(),
        Dy: nonce.D.y.toString(),
        Ex: nonce.E.x.toString(),
        Ey: nonce.E.y.toString(),
      });
      sd.nonceCommitments[signerIndexStr] = {
        Dx: nonce.D.x.toString(),
        Dy: nonce.D.y.toString(),
        Ex: nonce.E.x.toString(),
        Ey: nonce.E.y.toString(),
      };
      console.log("[handleSign] nonce committed");
    } else {
      console.log("[handleSign] nonce already exists for signer", signerIndexStr);
    }

    // 2. Check if we have enough nonces to compute partial sig
    const nonceCount = Object.keys(sd.nonceCommitments).length;
    if (nonceCount < threshold) {
      console.log("[handleSign] not enough nonces:", nonceCount, "/", threshold, "— waiting");
      return;
    }

    // 3. Compute partial sig if not yet done
    if (!sd.partialSignatures[signerIndexStr]) {
      console.log("[handleSign] computing partial sig...");
      const participants = Object.keys(sd.nonceCommitments).map(BigInt);
      const groupPK = {
        x: BigInt(state.keyCeremony!.groupPublicKey.x),
        y: BigInt(state.keyCeremony!.groupPublicKey.y),
      };

      // Build participant ranks map for HTSS mode
      const groupMode = state.groupConfig?.mode ?? "TSS";
      const signerRanks = state.groupConfig?.signerRanks;
      const participantRanks: Record<string, number> = {};
      if (groupMode === "HTSS" && signerRanks) {
        for (const pIdx of participants) {
          const arrayIdx = Number(pIdx) - 1; // signer index is 1-based
          participantRanks[pIdx.toString()] = signerRanks[arrayIdx] ?? 0;
        }
      }

      const result = computePartialSig({
        signerIndex,
        secretShareHex: session.share.secretShare,
        stealthScalar: BigInt(sd.inputStealthScalar),
        paymentId: payment.id,
        message: BigInt(sd.message),
        allNonceCommitments: sd.nonceCommitments,
        participants,
        groupPubKey: groupPK,
        threshold,
        mode: groupMode,
        signerRank: session.share.rank ?? 0,
        participantRanks: groupMode === "HTSS" ? participantRanks : undefined,
      });

      dispatch({
        type: "ADD_PARTIAL_SIG",
        paymentId,
        signerIndex: signerIndexStr,
        z_i: result.z_i.toString(),
        Rx: result.R.x.toString(),
        Ry: result.R.y.toString(),
      });
      sd.partialSignatures[signerIndexStr] = {
        z_i: result.z_i.toString(),
        Rx: result.R.x.toString(),
        Ry: result.R.y.toString(),
      };
      console.log("[handleSign] partial sig computed");
    } else {
      console.log("[handleSign] partial sig already exists for signer", signerIndexStr);
    }

    // 4. Check if all partial sigs are collected
    const partialSigCount = Object.keys(sd.partialSignatures).length;
    if (partialSigCount < threshold) {
      console.log("[handleSign] not enough partial sigs:", partialSigCount, "/", threshold, "— waiting");
      return;
    }

    console.log("[handleSign] all sigs ready, starting aggregate + prove + submit");

    // 5. All sigs collected — aggregate + prove + submit
    // Helper: dispatch + yield to event loop so React can repaint before heavy WASM work
    const updateStep = async (step: "aggregating" | "proving" | "submitting" | "confirming") => {
      console.log(`[handleSign] step -> ${step}`);
      dispatch({ type: "UPDATE_STATUS", paymentId, status: "proving", provingStep: step });
      // Double yield: requestAnimationFrame ensures React commits to DOM,
      // then setTimeout ensures the browser actually paints before we continue.
      await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 16)));
    };

    await updateStep("aggregating");

    try {
      const merkleTree = getLocalMerkleTree();
      if (!merkleTree) throw new Error("Merkle tree not available — refresh balance first");

      const groupPK = {
        x: BigInt(state.keyCeremony!.groupPublicKey.x),
        y: BigInt(state.keyCeremony!.groupPublicKey.y),
      };

      console.log("[handleSign] calling aggregateAndProve...");
      const t0 = performance.now();
      const { proofHex, nullifier } = await aggregateAndProve({
        partialSigs: sd.partialSignatures,
        message: BigInt(sd.message),
        groupPubKey: groupPK,
        stealthScalar: BigInt(sd.inputStealthScalar),
        spendingKeyHash: BigInt(sd.inputSpendingKeyHash),
        noteAmount: BigInt(sd.inputAmount),
        noteBlinding: BigInt(sd.inputBlinding),
        leafIndex: sd.inputLeafIndex,
        inputCommitment: BigInt(sd.inputCommitment),
        merkleTree,
        threshold,
        onProgress: async (step) => {
          await updateStep(step);
        },
      });
      console.log(`[handleSign] proof generated in ${((performance.now() - t0) / 1000).toFixed(1)}s, proofHex length=${proofHex.length}`);

      // 6. Submit on-chain
      await updateStep("submitting");
      await ensureWalletConnected();
      const contractAddress = getContractAddress() as `0x${string}`;
      console.log("[handleSign] submitting tx to", contractAddress, "type=", payment.txType);

      let txHash: `0x${string}`;

      if (payment.txType === "withdraw") {
        txHash = await writeContractAsync({
          address: contractAddress,
          abi: blsGunAbi,
          functionName: "unshield",
          args: [
            toBytes32(nullifier),
            sd.inputCommitment as `0x${string}`,
            sd.withdrawRecipient as `0x${string}`,
            BigInt(sd.withdrawAmountWei!),
            proofHex as `0x${string}`,
          ],
        });
      } else {
        txHash = await writeContractAsync({
          address: contractAddress,
          abi: blsGunAbi,
          functionName: "privateTransfer",
          args: [
            toBytes32(nullifier),
            sd.inputCommitment as `0x${string}`,
            toBytes32(BigInt(sd.outputCommitment!)),
            proofHex as `0x${string}`,
            toBytes32(BigInt(sd.outputEphPubKeyX!)),
            toBytes32(BigInt(sd.outputEphPubKeyY!)),
            sd.outputViewTag!,
            BigInt(sd.outputEncryptedAmount!),
          ],
        });
      }

      console.log("[handleSign] tx sent, hash=", txHash);
      await updateStep("confirming");
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      console.log("[handleSign] tx confirmed!");

      dispatch({ type: "UPDATE_STATUS", paymentId, status: "submitted" });
      dispatch({
        type: "ADD_ACTIVITY",
        activity: {
          id: crypto.randomUUID(),
          type: payment.txType === "withdraw" ? "unshield" : "transfer",
          description: payment.txType === "withdraw"
            ? "Withdrawal confirmed on Conflux eSpace!"
            : "ZK proof verified on Conflux eSpace!",
          timestamp: Date.now(),
          status: "success",
        },
      });

      setTimeout(fetchBalance, 3000);
    } catch (err: any) {
      console.error("[handleSign] FAILED:", err);
      const msg = err?.message || "Unknown error";

      if (msg.includes("signature verification failed")) {
        // Signatures are invalid (likely computed with wrong challenge).
        // Reset all sigs so signers can re-sign with corrected code.
        console.log("[handleSign] resetting signatures for re-signing");
        dispatch({ type: "RESET_SIGNATURES", paymentId });
        dispatch({
          type: "ADD_ACTIVITY",
          activity: {
            id: crypto.randomUUID(),
            type: "transfer",
            description: "Signature verification failed — signatures reset. Please re-sign.",
            timestamp: Date.now(),
            status: "failed",
          },
        });
      } else {
        dispatch({ type: "UPDATE_STATUS", paymentId, status: "pending" });
        dispatch({
          type: "ADD_ACTIVITY",
          activity: {
            id: crypto.randomUUID(),
            type: "transfer",
            description: `Transaction failed: ${msg.slice(0, 80)}`,
            timestamp: Date.now(),
            status: "failed",
          },
        });
      }
    }
  };

  const pendingCount = state.pendingPayments.filter(
    (p) =>
      p.status === "pending" &&
      state.currentSigner &&
      !p.signatures.includes(state.currentSigner)
  ).length;

  const pendingPayments = state.pendingPayments.filter(
    (p) => p.status === "pending" || p.status === "signing" || p.status === "proving"
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
              isScanning={isScanning}
              noteCount={noteCount}
              balanceLoaded={balanceLoaded}
              onRefresh={fetchBalance}
              groupPublicKey={state.keyCeremony?.groupPublicKey ?? null}
              viewingPublicKey={state.keyCeremony?.viewingPublicKey ?? null}
              onDeposited={() => {
                fetchBalance();
                dispatch({
                  type: "ADD_ACTIVITY",
                  activity: {
                    id: crypto.randomUUID(),
                    type: "shield",
                    description: "CFX deposited into shielded account",
                    timestamp: Date.now(),
                    status: "success",
                  },
                });
              }}
              notes={scannedNotes}
              groupConfig={state.groupConfig}
              onCreateWithdraw={handleCreatePayment}
            />
          )}

          {tab === "payment" && state.currentSigner && (
            <CreatePayment
              currentSigner={state.currentSigner}
              onCreatePayment={handleCreatePayment}
              groupConfig={state.groupConfig}
              balance={state.balance}
              notes={scannedNotes}
              groupPublicKey={state.keyCeremony?.groupPublicKey}
            />
          )}

          {tab === "transactions" && state.currentSigner && (
            <ApprovalQueue
              payments={state.pendingPayments}
              currentSigner={state.currentSigner}
              onSign={handleSign}
              groupConfig={state.groupConfig}
            />
          )}

          {tab === "audit" && <AuditExport state={state} notes={scannedNotes} />}
        </main>
      </div>
    </div>
  );
}
