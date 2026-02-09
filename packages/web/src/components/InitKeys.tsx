import { useState, useRef, useMemo } from "react";
import type {
  KeyCeremonyData,
  SignerRole,
  CeremonyTranscriptEntry,
  GroupConfig,
} from "../store/treasury";
import {
  isWebAuthnAvailable,
  registerPasskeyForShare,
} from "../lib/passkey";
import {
  distributedCeremony,
  hierarchicalCeremony,
  type CeremonyShare,
  type HierarchicalCeremonyShare,
  type CeremonyResult,
} from "@blsgun/sdk/ceremony";

interface InitKeysProps {
  onInit: (
    data: KeyCeremonyData,
    transcript: CeremonyTranscriptEntry[],
    groupConfig: GroupConfig,
    viewingSecretKey?: string
  ) => void;
}

const PERSON_ICON = "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z";

function bigintToHex(n: bigint): string {
  return "0x" + n.toString(16).padStart(64, "0");
}

function pointToHex(p: { x: bigint; y: bigint }) {
  return { x: bigintToHex(p.x), y: bigintToHex(p.y) };
}

function truncateHex(hex: string, chars = 8): string {
  if (hex.length <= chars * 2 + 4) return hex;
  return hex.slice(0, chars + 2) + "..." + hex.slice(-chars);
}

function downloadShareJSON(
  share: { index: number; role: SignerRole; secretShare: string; publicShare: { x: string; y: string }; rank?: number },
  groupPk: { x: string; y: string },
  groupConfig: GroupConfig
) {
  const mode = groupConfig.mode ?? "TSS";
  const data = {
    pavv_share: {
      version: "0.1.0",
      signerRole: share.role,
      shareIndex: share.index,
      secretShare: share.secretShare,
      publicShare: share.publicShare,
      groupPublicKey: groupPk,
      curve: "Grumpkin",
      threshold: `${groupConfig.threshold}-of-${groupConfig.totalSigners}`,
      protocol: mode === "HTSS" ? "FROST+Birkhoff" : "FROST",
      mode,
      ...(share.rank !== undefined ? { rank: share.rank } : {}),
      groupName: groupConfig.name,
    },
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pavv-share-${share.index}-${share.role.toLowerCase().replace(/\s+/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function KeyIdenticon({ hexBytes }: { hexBytes: string }) {
  const colors = useMemo(() => {
    const clean = hexBytes.startsWith("0x") ? hexBytes.slice(2) : hexBytes;
    const r1 = parseInt(clean.slice(0, 2), 16);
    const g1 = parseInt(clean.slice(2, 4), 16);
    const b1 = parseInt(clean.slice(4, 6), 16);
    const r2 = parseInt(clean.slice(6, 8), 16);
    const g2 = parseInt(clean.slice(8, 10), 16);
    const b2 = parseInt(clean.slice(10, 12), 16);
    return {
      from: `rgb(${r1}, ${g1}, ${b1})`,
      to: `rgb(${r2}, ${g2}, ${b2})`,
    };
  }, [hexBytes]);

  return (
    <div
      className="w-14 h-14 rounded-xl shrink-0"
      style={{
        background: `linear-gradient(135deg, ${colors.from}, ${colors.to})`,
      }}
    />
  );
}

type Phase = "idle" | "configure" | "generating" | "distribute" | "complete";

interface DistributionEntry {
  role: SignerRole;
  publicShare: { x: string; y: string };
  savedVia: "passkey" | "download";
  timestamp: number;
}

const DEFAULT_ROLES = ["Accountant", "Manager", "CFO"];

export function InitKeys({ onInit }: InitKeysProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [genStep, setGenStep] = useState(0);

  // Configure phase state
  const [groupName, setGroupName] = useState("Corporate Treasury");
  const [totalSigners, setTotalSigners] = useState(3);
  const [threshold, setThreshold] = useState(2);
  const [roleNames, setRoleNames] = useState<string[]>(DEFAULT_ROLES);
  const [ceremonyMode, setCeremonyMode] = useState<"TSS" | "HTSS">("TSS");
  const [signerRanks, setSignerRanks] = useState<number[]>([0, 0, 0]);

  // Distribute phase state
  const [currentShareIndex, setCurrentShareIndex] = useState(0);
  const [currentShare, setCurrentShare] = useState<{
    index: number;
    role: SignerRole;
    secretShare: string;
    publicShare: { x: string; y: string };
    rank?: number;
  } | null>(null);
  const [shareIsSaved, setShareIsSaved] = useState(false);
  const [distributionLog, setDistributionLog] = useState<DistributionEntry[]>(
    []
  );

  // Complete phase
  const [ceremonyResult, setCeremonyResult] = useState<{
    groupPublicKey: { x: string; y: string };
    viewingPublicKey: { x: string; y: string };
    viewingSecretKey: string;
  } | null>(null);

  // Passkey modal
  const [showPasskeyModal, setShowPasskeyModal] = useState(false);
  const [passkeyName, setPasskeyName] = useState("");
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const webAuthnSupported = isWebAuthnAvailable();

  const groupConfigRef = useRef<GroupConfig | null>(null);
  const viewingSkRef = useRef<string | null>(null);

  const generationSteps = [
    "Generating master spending key on Grumpkin curve...",
    ceremonyMode === "HTSS"
      ? `Splitting into ${threshold}-of-${totalSigners} Birkhoff hierarchical shares...`
      : `Splitting into ${threshold}-of-${totalSigners} Shamir shares with Feldman VSS...`,
    "Computing polynomial commitments for verification...",
    "Deriving viewing key for audit...",
    "Zeroing master secret from memory...",
  ];

  const configValid = useMemo(() => {
    if (!groupName.trim()) return false;
    if (threshold < 1 || threshold > totalSigners) return false;
    const names = roleNames.slice(0, totalSigners);
    if (names.some((n) => !n.trim())) return false;
    const unique = new Set(names.map((n) => n.trim().toLowerCase()));
    if (unique.size !== names.length) return false;
    return true;
  }, [groupName, threshold, totalSigners, roleNames]);

  const handleTotalSignersChange = (n: number) => {
    setTotalSigners(n);
    if (threshold > n) setThreshold(n);
    setRoleNames((prev) => {
      if (prev.length >= n) return prev;
      const extra = Array.from({ length: n - prev.length }, (_, i) => `Signer ${prev.length + i + 1}`);
      return [...prev, ...extra];
    });
    setSignerRanks((prev) => {
      if (prev.length >= n) return prev;
      return [...prev, ...Array.from({ length: n - prev.length }, () => 0)];
    });
  };

  const handleRoleNameChange = (index: number, value: string) => {
    setRoleNames((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleShareSaved = (method: "passkey" | "download") => {
    if (!currentShare) return;
    setShareIsSaved(true);
    setDistributionLog((prev) => [
      ...prev,
      {
        role: currentShare.role,
        publicShare: currentShare.publicShare,
        savedVia: method,
        timestamp: Date.now(),
      },
    ]);
  };

  const handleSavePasskey = async () => {
    if (!currentShare || !passkeyName.trim()) return;

    setSaveStatus("saving");
    setSaveError(null);

    const gpk = groupPkRef.current;
    const vpk = viewingPkRef.current;
    if (!gpk || !vpk) {
      setSaveStatus("error");
      setSaveError("Group public key not available yet");
      return;
    }

    const result = await registerPasskeyForShare(
      passkeyName.trim(),
      {
        index: currentShare.index,
        role: currentShare.role,
        secretShare: currentShare.secretShare,
        publicShare: currentShare.publicShare,
        rank: currentShare.rank,
      },
      gpk,
      vpk,
      groupConfigRef.current ?? undefined,
      viewingSkRef.current ?? undefined
    );

    if (result.ok) {
      setSaveStatus("saved");
      setShowPasskeyModal(false);
      setPasskeyName("");
      handleShareSaved("passkey");
    } else {
      setSaveStatus("error");
      setSaveError(result.error || "Failed to save passkey");
    }
  };

  const handleDownloadShare = () => {
    if (!currentShare) return;
    const gpk = groupPkRef.current;
    const gc = groupConfigRef.current;
    if (!gpk || !gc) return;
    downloadShareJSON(currentShare, gpk, gc);
    handleShareSaved("download");
  };

  const groupPkRef = useRef<{ x: string; y: string } | null>(null);
  const viewingPkRef = useRef<{ x: string; y: string } | null>(null);
  const allSharesRef = useRef<
    { index: number; role: SignerRole; secretShare: string; publicShare: { x: string; y: string }; rank?: number }[]
  >([]);

  const handleStartConfigure = () => {
    setPhase("configure");
  };

  const handleGenerateActual = async () => {
    const roles = roleNames.slice(0, totalSigners).map((n) => n.trim());
    const ranks = signerRanks.slice(0, totalSigners);
    const gc: GroupConfig = {
      name: groupName.trim(),
      threshold,
      totalSigners,
      roles,
      mode: ceremonyMode,
      signerRanks: ceremonyMode === "HTSS" ? ranks : undefined,
    };
    groupConfigRef.current = gc;

    setPhase("generating");

    for (let i = 0; i < generationSteps.length; i++) {
      setGenStep(i);
      await new Promise((r) => setTimeout(r, 500));
    }

    // Mark all steps as done and yield to let React render checkmarks
    setGenStep(generationSteps.length);
    await new Promise((r) => setTimeout(r, 100));

    try {
      const collectedShares: { index: number; role: SignerRole; secretShare: string; publicShare: { x: string; y: string }; rank?: number }[] = [];

      if (ceremonyMode === "HTSS") {
        const signerConfigs = ranks.map((rank, i) => ({ index: i + 1, rank }));
        const gen = hierarchicalCeremony({ threshold, signers: signerConfigs });

        for (let i = 0; i < totalSigners; i++) {
          const { value } = gen.next();
          const s = value as HierarchicalCeremonyShare;
          collectedShares.push({
            index: Number(s.index),
            role: roles[i],
            secretShare: bigintToHex(s.secretShare),
            publicShare: pointToHex(s.publicShare),
            rank: s.rank,
          });
        }

        const { value: result } = gen.next();
        const cr = result as CeremonyResult;
        groupPkRef.current = pointToHex(cr.groupPublicKey);
        viewingPkRef.current = pointToHex(cr.viewingPublicKey);
        viewingSkRef.current = bigintToHex(cr.viewingSecretKey);
      } else {
        const gen = distributedCeremony({ threshold, totalSigners });

        for (let i = 0; i < totalSigners; i++) {
          const { value } = gen.next();
          const s = value as CeremonyShare;
          collectedShares.push({
            index: Number(s.index),
            role: roles[i],
            secretShare: bigintToHex(s.secretShare),
            publicShare: pointToHex(s.publicShare),
          });
        }

        const { value: result } = gen.next();
        const cr = result as CeremonyResult;
        groupPkRef.current = pointToHex(cr.groupPublicKey);
        viewingPkRef.current = pointToHex(cr.viewingPublicKey);
        viewingSkRef.current = bigintToHex(cr.viewingSecretKey);
      }

      allSharesRef.current = collectedShares;
      setCurrentShare(collectedShares[0]);
      setCurrentShareIndex(0);
      setShareIsSaved(false);
      setPhase("distribute");
    } catch (err) {
      console.error("Key generation failed:", err);
      setPhase("idle");
    }
  };

  const handleNextSignerActual = () => {
    const gc = groupConfigRef.current;
    if (!gc) return;

    if (currentShareIndex < allSharesRef.current.length) {
      allSharesRef.current[currentShareIndex].secretShare = "";
    }

    const nextIndex = currentShareIndex + 1;
    if (nextIndex >= gc.totalSigners) {
      allSharesRef.current[currentShareIndex].secretShare = "";

      setCeremonyResult({
        groupPublicKey: groupPkRef.current!,
        viewingPublicKey: viewingPkRef.current!,
        viewingSecretKey: "",
      });
      setCurrentShare(null);
      setPhase("complete");
    } else {
      setCurrentShare(allSharesRef.current[nextIndex]);
      setCurrentShareIndex(nextIndex);
      setShareIsSaved(false);
      setSaveStatus("idle");
      setSaveError(null);
    }
  };

  const handleContinue = () => {
    if (!groupPkRef.current || !viewingPkRef.current || !groupConfigRef.current) return;

    const keyCeremony: KeyCeremonyData = {
      groupPublicKey: groupPkRef.current,
      viewingPublicKey: viewingPkRef.current,
      shares: allSharesRef.current.map((s) => ({
        index: s.index,
        role: s.role,
        secretShare: "",
        publicShare: s.publicShare,
        rank: s.rank,
      })),
    };

    const transcript: CeremonyTranscriptEntry[] = distributionLog.map((e) => ({
      role: e.role,
      publicShare: e.publicShare,
      savedVia: e.savedVia,
      timestamp: e.timestamp,
    }));

    const vsk = viewingSkRef.current ?? undefined;
    viewingSkRef.current = "";

    onInit(keyCeremony, transcript, groupConfigRef.current, vsk);
  };

  // -- Render: idle --

  if (phase === "idle") {
    return (
      <div className="flex items-center justify-center min-h-[70vh]">
        <div className="max-w-md w-full">
          <div className="bg-dark-card rounded-2xl p-8 border border-dark-border text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-pavv-400 to-pavv-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <svg
                className="w-8 h-8 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <h2 className="text-3xl font-bold text-white mb-2">
              Setup Treasury
            </h2>
            <p className="text-slate-400 text-base mb-6">
              Configure your FROST threshold group and generate keys for your
              corporate treasury.
            </p>
            <button
              onClick={handleStartConfigure}
              className="w-full py-3 bg-pavv-500 hover:bg-pavv-600 text-white rounded-xl font-semibold text-base transition-colors duration-200 cursor-pointer"
            >
              Configure Group
            </button>
            <div className="mt-6 p-3 bg-dark-surface rounded-lg text-sm text-slate-400">
              Curve: Grumpkin (BN254 cycle) | Protocol: FROST RFC 9591
            </div>
          </div>
        </div>
      </div>
    );
  }

  // -- Render: configure --

  if (phase === "configure") {
    const activeRoles = roleNames.slice(0, totalSigners);
    return (
      <div className="flex items-center justify-center min-h-[70vh]">
        <div className="max-w-lg w-full">
          <div className="bg-dark-card rounded-2xl p-8 border border-dark-border">
            <h2 className="text-3xl font-bold text-white mb-1 text-center">
              Configure Group
            </h2>
            <p className="text-slate-400 mb-6 text-center text-base">
              Set your MPC threshold group parameters before key generation.
            </p>

            <div className="space-y-5">
              <div>
                <label className="block text-base font-medium text-slate-200 mb-1">
                  Group Name
                </label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="e.g. Engineering Treasury"
                  className="w-full bg-dark-surface border border-dark-border rounded-lg px-4 py-3 text-base text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-pavv-500 focus:border-transparent transition-colors duration-200"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-base font-medium text-slate-200 mb-1">
                    Total Signers
                  </label>
                  <select
                    value={totalSigners}
                    onChange={(e) => handleTotalSignersChange(Number(e.target.value))}
                    className="w-full bg-dark-surface border border-dark-border rounded-lg px-4 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-pavv-500 focus:border-transparent transition-colors duration-200"
                  >
                    {Array.from({ length: 9 }, (_, i) => i + 2).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-base font-medium text-slate-200 mb-1">
                    Threshold
                  </label>
                  <select
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    className="w-full bg-dark-surface border border-dark-border rounded-lg px-4 py-3 text-base text-white focus:outline-none focus:ring-2 focus:ring-pavv-500 focus:border-transparent transition-colors duration-200"
                  >
                    {Array.from({ length: totalSigners }, (_, i) => i + 1).map(
                      (n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      )
                    )}
                  </select>
                </div>
              </div>

              <div className="p-3 bg-pavv-500/10 rounded-lg text-base text-pavv-400 text-center">
                <span className="font-semibold">{threshold}-of-{totalSigners}</span>{" "}
                signers required to authorize transactions
              </div>

              {/* TSS/HTSS Mode Toggle */}
              <div>
                <label className="block text-base font-medium text-slate-200 mb-2">
                  Protocol Mode
                </label>
                <div className="flex rounded-lg overflow-hidden border border-dark-border">
                  <button
                    type="button"
                    onClick={() => setCeremonyMode("TSS")}
                    className={`flex-1 py-2.5 text-base font-medium transition-colors duration-200 cursor-pointer ${
                      ceremonyMode === "TSS"
                        ? "bg-pavv-500 text-white"
                        : "bg-dark-surface text-slate-400 hover:text-white"
                    }`}
                  >
                    TSS (Shamir)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCeremonyMode("HTSS")}
                    className={`flex-1 py-2.5 text-base font-medium transition-colors duration-200 cursor-pointer ${
                      ceremonyMode === "HTSS"
                        ? "bg-pavv-500 text-white"
                        : "bg-dark-surface text-slate-400 hover:text-white"
                    }`}
                  >
                    HTSS (Birkhoff)
                  </button>
                </div>
                <p className="text-sm text-slate-400 mt-1.5">
                  {ceremonyMode === "TSS"
                    ? "Standard FROST RFC 9591 — all signers are equal"
                    : "FROST + Birkhoff HTSS — signers have hierarchical ranks"}
                </p>
              </div>

              <div>
                <label className="block text-base font-medium text-slate-200 mb-2">
                  Signer Roles
                </label>
                <div className="space-y-2">
                  {activeRoles.map((name, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-sm text-slate-400 w-6 text-right shrink-0">
                        {i + 1}.
                      </span>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => handleRoleNameChange(i, e.target.value)}
                        placeholder={`Signer ${i + 1}`}
                        className="flex-1 bg-dark-surface border border-dark-border rounded-lg px-3 py-2.5 text-base text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-pavv-500 focus:border-transparent transition-colors duration-200"
                      />
                      {ceremonyMode === "HTSS" && (
                        <select
                          value={signerRanks[i] ?? 0}
                          onChange={(e) => {
                            setSignerRanks((prev) => {
                              const next = [...prev];
                              next[i] = Number(e.target.value);
                              return next;
                            });
                          }}
                          className="w-32 bg-dark-surface border border-dark-border rounded-lg px-2 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-pavv-500 focus:border-transparent transition-colors duration-200"
                        >
                          {Array.from({ length: threshold }, (_, r) => (
                            <option key={r} value={r}>
                              Rank {r}{r === 0 ? " (Admin)" : r === 1 ? " (Mgr)" : ""}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={handleGenerateActual}
                disabled={!configValid}
                className="w-full py-3 bg-pavv-500 hover:bg-pavv-600 disabled:bg-dark-surface disabled:text-slate-500 text-white rounded-xl font-semibold text-base transition-colors duration-200 cursor-pointer"
              >
                Generate Keys
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // -- Render: generating --

  if (phase === "generating") {
    return (
      <div className="flex items-center justify-center min-h-[70vh]">
        <div className="max-w-md w-full">
          <div className="bg-dark-card rounded-2xl p-8 border border-dark-border text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-pavv-400 to-pavv-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <svg
                className="w-8 h-8 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <h2 className="text-3xl font-bold text-white mb-4">
              Generating Keys...
            </h2>
            <div className="space-y-3">
              {generationSteps.map((s, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-3 text-base text-left transition-opacity ${
                    i <= genStep ? "opacity-100" : "opacity-30"
                  }`}
                >
                  {i < genStep ? (
                    <svg
                      className="w-5 h-5 text-pavv-500 shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  ) : i === genStep ? (
                    <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                      <div className="w-4 h-4 border-2 border-pavv-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : (
                    <div className="w-5 h-5 shrink-0 rounded-full border-2 border-gray-700" />
                  )}
                  <span className="text-slate-200">{s}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 p-3 bg-dark-surface rounded-lg text-sm text-slate-400">
              Curve: Grumpkin (BN254 cycle) | Threshold: {threshold}-of-{totalSigners} | Protocol:{" "}
              {ceremonyMode === "HTSS" ? "FROST + Birkhoff HTSS" : "FROST RFC 9591"}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // -- Render: distribute --

  if (phase === "distribute" && currentShare) {
    const gc = groupConfigRef.current!;
    const roles = gc.roles;
    return (
      <div className="max-w-lg mx-auto space-y-6">
        {/* Progress indicator */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-pavv-500/10 text-pavv-400 rounded-full text-base font-medium mb-3">
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
              />
            </svg>
            Distributing Share {currentShareIndex + 1} of {gc.totalSigners}
          </div>
          <h2 className="text-3xl font-bold text-white">
            Save {currentShare.role}'s Share
          </h2>
          <p className="text-slate-400 mt-1 text-base">
            Hand this device to the {currentShare.role}, or save the share
            securely now.
          </p>
        </div>

        {/* Step dots */}
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {roles.map((role, i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold ${
                  i < currentShareIndex
                    ? "bg-pavv-500/20 text-pavv-400"
                    : i === currentShareIndex
                    ? "bg-pavv-500 text-white"
                    : "bg-dark-surface text-slate-400"
                }`}
              >
                {i < currentShareIndex ? (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.5 12.75l6 6 9-13.5"
                    />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              {i < roles.length - 1 && (
                <div
                  className={`w-8 h-0.5 ${
                    i < currentShareIndex ? "bg-pavv-500/40" : "bg-dark-border"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Share card */}
        <div className="bg-dark-card rounded-2xl p-6 border border-dark-border">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-14 h-14 bg-dark-surface rounded-xl flex items-center justify-center">
              <svg
                className="w-7 h-7 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d={PERSON_ICON}
                />
              </svg>
            </div>
            <div>
              <h4 className="text-lg font-semibold text-white">
                Share {currentShare.index}
              </h4>
              <p className="text-base text-slate-400">
                {currentShare.role}
                {currentShare.rank !== undefined && ceremonyMode === "HTSS" && (
                  <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-pavv-500/20 text-pavv-400">
                    Rank {currentShare.rank}{currentShare.rank === 0 ? " — Admin" : currentShare.rank === 1 ? " — Mgr" : ""}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="space-y-3 mb-5">
            <div>
              <span className="text-sm text-slate-400 block mb-1">
                Secret Share
              </span>
              <code className="text-sm text-slate-200 font-mono bg-dark-surface rounded px-2 py-2 block truncate">
                {truncateHex(currentShare.secretShare)}
              </code>
            </div>
            <div>
              <span className="text-sm text-slate-400 block mb-1">
                Public Share (x)
              </span>
              <code className="text-sm text-slate-200 font-mono bg-dark-surface rounded px-2 py-2 block truncate">
                {truncateHex(currentShare.publicShare.x)}
              </code>
            </div>
          </div>

          {/* Save actions */}
          {!shareIsSaved ? (
            <div className="space-y-2">
              {webAuthnSupported && (
                <button
                  onClick={() => {
                    setShowPasskeyModal(true);
                    setPasskeyName("");
                    setSaveError(null);
                    setSaveStatus("idle");
                  }}
                  className="w-full py-3 px-4 bg-pavv-500 hover:bg-pavv-600 text-white rounded-lg text-base font-medium transition-colors duration-200 cursor-pointer flex items-center justify-center gap-2"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33"
                    />
                  </svg>
                  Save with Passkey
                </button>
              )}
              <button
                onClick={handleDownloadShare}
                className="w-full py-3 px-4 bg-dark-surface hover:bg-dark-hover text-slate-200 border border-dark-border rounded-lg text-base font-medium transition-colors duration-200 cursor-pointer flex items-center justify-center gap-2"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                  />
                </svg>
                Download JSON
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-3 bg-pavv-500/10 rounded-lg text-pavv-400 text-base font-medium">
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Share saved successfully
            </div>
          )}
        </div>

        {/* Security notice */}
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-2">
          <svg
            className="w-5 h-5 text-amber-400 mt-0.5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          <p className="text-sm text-amber-400">
            The previous share has been cleared from memory. Only this share is
            visible. Save it before proceeding to the next signer.
          </p>
        </div>

        {/* Next button */}
        <div className="flex justify-center">
          <button
            onClick={handleNextSignerActual}
            disabled={!shareIsSaved}
            className="px-8 py-3 bg-pavv-500 hover:bg-pavv-600 text-white rounded-xl font-semibold text-base transition-colors duration-200 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {currentShareIndex < gc.totalSigners - 1 ? "Next Signer" : "Complete Ceremony"}
          </button>
        </div>

        {/* Passkey Name Modal */}
        {showPasskeyModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-[#242A2E] rounded-2xl p-6 max-w-sm w-full mx-4 border border-dark-border shadow-xl">
              <h3 className="text-xl font-semibold text-white mb-1">
                Save Share with Passkey
              </h3>
              <p className="text-base text-slate-400 mb-4">
                Give this passkey a name so you can recognize it later.
              </p>

              <input
                type="text"
                placeholder="e.g. Alice's MacBook"
                value={passkeyName}
                onChange={(e) => setPasskeyName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && passkeyName.trim()) {
                    handleSavePasskey();
                  }
                }}
                autoFocus
                className="w-full px-3 py-2.5 bg-dark-surface border border-dark-border rounded-lg text-base text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-pavv-500 focus:border-transparent mb-3 transition-colors duration-200"
              />

              {saveError && (
                <p className="text-base text-red-400 mb-3">{saveError}</p>
              )}

              <p className="text-sm text-slate-400 mb-4">
                Your device will prompt you to create a passkey. The share will
                be encrypted and stored locally on this device.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowPasskeyModal(false);
                    setPasskeyName("");
                    setSaveError(null);
                  }}
                  className="flex-1 py-2.5 px-3 bg-dark-surface hover:bg-dark-hover text-slate-200 rounded-lg text-base font-medium transition-colors duration-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSavePasskey}
                  disabled={
                    !passkeyName.trim() || saveStatus === "saving"
                  }
                  className="flex-1 py-2.5 px-3 bg-pavv-500 hover:bg-pavv-600 text-white rounded-lg text-base font-medium transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {saveStatus === "saving" ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Saving
                    </>
                  ) : (
                    "Save"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // -- Render: complete --

  if (phase === "complete" && ceremonyResult) {
    const gc = groupConfigRef.current!;
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-pavv-500/10 text-pavv-400 rounded-full text-base font-medium mb-3">
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Key Ceremony Complete
          </div>
          <h2 className="text-3xl font-bold text-white">
            Treasury Keys Generated
          </h2>
          <p className="text-slate-400 mt-1 text-base">
            All {gc.totalSigners} shares have been distributed securely. Master secret has been
            destroyed.
          </p>
          <div className="mt-2 inline-flex items-center gap-2">
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-dark-surface text-slate-300">
              {gc.mode === "HTSS" ? "FROST + Birkhoff HTSS" : "FROST RFC 9591"}
            </span>
          </div>
        </div>

        {/* Group Public Key */}
        <div className="bg-dark-card rounded-2xl p-6 border border-dark-border">
          <div className="flex items-center gap-4 mb-4">
            <KeyIdenticon hexBytes={ceremonyResult.groupPublicKey.x} />
            <div>
              <h3 className="text-lg font-semibold text-white">Group Public Key</h3>
              <p className="text-sm text-slate-400">
                Grumpkin curve point (x, y)
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <div className="bg-dark-surface rounded-lg p-3">
              <span className="text-sm text-slate-400 block mb-1">x</span>
              <code className="text-sm text-slate-200 break-all font-mono">
                {ceremonyResult.groupPublicKey.x}
              </code>
            </div>
            <div className="bg-dark-surface rounded-lg p-3">
              <span className="text-sm text-slate-400 block mb-1">y</span>
              <code className="text-sm text-slate-200 break-all font-mono">
                {ceremonyResult.groupPublicKey.y}
              </code>
            </div>
          </div>
        </div>

        {/* Distribution Transcript */}
        <div className="bg-dark-card rounded-2xl p-6 border border-dark-border">
          <h3 className="text-lg font-semibold text-white mb-4">
            Distribution Transcript
          </h3>
          <div className="space-y-3">
            {distributionLog.map((entry, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 bg-dark-surface rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-pavv-500/15 rounded-full flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-pavv-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4.5 12.75l6 6 9-13.5"
                      />
                    </svg>
                  </div>
                  <div>
                    <p className="text-base font-medium text-white">
                      Share {i + 1} - {entry.role}
                    </p>
                    <p className="text-sm text-slate-400">
                      Saved via{" "}
                      {entry.savedVia === "passkey" ? "Passkey" : "Download"}
                    </p>
                  </div>
                </div>
                <span className="text-sm text-slate-400">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Viewing Key */}
        <div className="bg-dark-card rounded-2xl p-6 border border-dark-border">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 bg-pavv-500/10 rounded-xl flex items-center justify-center shrink-0">
              <svg
                className="w-7 h-7 text-pavv-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Viewing Key</h3>
              <p className="text-sm text-slate-400">
                Read-only audit access (cannot sign transactions)
              </p>
            </div>
          </div>
          <div className="bg-dark-surface rounded-lg p-3">
            <code className="text-sm text-slate-200 break-all font-mono">
              {truncateHex(ceremonyResult.viewingPublicKey.x, 16)}
            </code>
          </div>
        </div>

        {/* Continue Button */}
        <div className="flex justify-center pt-2 pb-8">
          <button
            onClick={handleContinue}
            className="px-8 py-3 bg-pavv-500 hover:bg-pavv-600 text-white rounded-xl font-semibold text-base transition-colors duration-200 cursor-pointer"
          >
            Continue to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return null;
}
