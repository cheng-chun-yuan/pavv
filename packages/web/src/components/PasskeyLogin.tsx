import { useState, useRef } from "react";
import type {
  StoredPasskeyShare,
  EncryptedSharePayload,
} from "../lib/passkey";
import {
  authenticateAndDecryptShare,
  authenticateAnyShare,
  registerPasskeyForShare,
  isWebAuthnAvailable,
} from "../lib/passkey";
import type { ShareData, CurvePoint, GroupConfig } from "../store/treasury";

interface PasskeyLoginProps {
  storedShares: StoredPasskeyShare[];
  onLogin: (payload: EncryptedSharePayload) => void;
  onStartFresh: () => void;
  onShareImported?: () => void;
}

const HASH_COLORS = [
  "bg-pavv-500/15 text-pavv-400",
  "bg-purple-500/15 text-purple-400",
  "bg-amber-500/15 text-amber-400",
  "bg-green-500/15 text-green-400",
  "bg-rose-500/15 text-rose-400",
  "bg-cyan-500/15 text-cyan-400",
  "bg-indigo-500/15 text-indigo-400",
  "bg-orange-500/15 text-orange-400",
];

function roleColor(role: string): string {
  let hash = 0;
  for (let i = 0; i < role.length; i++) {
    hash = ((hash << 5) - hash + role.charCodeAt(i)) | 0;
  }
  return HASH_COLORS[Math.abs(hash) % HASH_COLORS.length];
}

interface ParsedShareFile {
  share: ShareData;
  groupPublicKey: CurvePoint;
  viewingPublicKey?: CurvePoint;
  groupConfig?: GroupConfig;
  role: string;
}

function parseShareJSON(text: string): ParsedShareFile | null {
  try {
    const data = JSON.parse(text);
    const s = data.pavv_share;
    if (!s || !s.secretShare || !s.publicShare || !s.groupPublicKey) return null;

    const share: ShareData = {
      index: s.shareIndex ?? 1,
      role: s.signerRole ?? "Unknown",
      secretShare: s.secretShare,
      publicShare: s.publicShare,
    };

    let groupConfig: GroupConfig | undefined;
    if (s.threshold && s.groupName) {
      const parts = s.threshold.split("-of-");
      if (parts.length === 2) {
        groupConfig = {
          name: s.groupName,
          threshold: Number(parts[0]),
          totalSigners: Number(parts[1]),
          roles: [s.signerRole],
        };
      }
    }

    return {
      share,
      groupPublicKey: s.groupPublicKey,
      viewingPublicKey: s.viewingPublicKey ?? s.groupPublicKey,
      groupConfig,
      role: s.signerRole ?? "Unknown",
    };
  } catch {
    return null;
  }
}

export function PasskeyLogin({
  storedShares,
  onLogin,
  onStartFresh,
  onShareImported,
}: PasskeyLoginProps) {
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importedShare, setImportedShare] = useState<ParsedShareFile | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [passkeyName, setPasskeyName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLoginAny = async () => {
    setUnlocking("any");
    setError(null);

    const result = await authenticateAnyShare(storedShares);

    if (result.ok && result.payload) {
      onLogin(result.payload);
    } else {
      setError(result.error || "Failed to decrypt share");
      setUnlocking(null);
    }
  };

  const handleUnlock = async (entry: StoredPasskeyShare) => {
    setUnlocking(entry.credentialId);
    setError(null);

    const result = await authenticateAndDecryptShare(entry);

    if (result.ok && result.payload) {
      onLogin(result.payload);
    } else {
      setError(result.error || "Failed to decrypt share");
      setUnlocking(null);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportedShare(null);
    setSaveSuccess(false);

    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseShareJSON(reader.result as string);
      if (parsed) {
        setImportedShare(parsed);
        setPasskeyName("");
      } else {
        setImportError("Invalid share file. Expected a Pavv share JSON.");
      }
    };
    reader.readAsText(file);
  };

  const handleSaveAsPasskey = async () => {
    if (!importedShare || !passkeyName.trim() || !isWebAuthnAvailable()) return;
    setSaving(true);
    setImportError(null);

    const result = await registerPasskeyForShare(
      passkeyName.trim(),
      importedShare.share,
      importedShare.groupPublicKey,
      importedShare.viewingPublicKey ?? importedShare.groupPublicKey,
      importedShare.groupConfig
    );

    if (result.ok) {
      setSaving(false);
      setSaveSuccess(true);
      setImportedShare(null);
      onShareImported?.();
    } else {
      setSaving(false);
      setImportError(result.error || "Failed to save passkey");
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-dark-bg">
      <div className="max-w-md w-full mx-4">
        <div className="bg-dark-card rounded-2xl p-8 border border-dark-border">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-pavv-400 to-pavv-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-white"
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
            </div>
            <h2 className="text-3xl font-bold text-white">Welcome Back</h2>
            <p className="text-slate-400 mt-1 text-base">
              Choose your signer to unlock the treasury.
            </p>
          </div>

          {/* Saved shares list */}
          {storedShares.length > 0 && (
            <div className="space-y-3 mb-5">
              <p className="text-sm font-medium text-slate-400 uppercase tracking-wider">Your Passkeys</p>
              {storedShares.map((entry) => {
                const isUnlocking = unlocking === entry.credentialId;
                return (
                  <button
                    key={entry.credentialId}
                    onClick={() => handleUnlock(entry)}
                    disabled={unlocking !== null}
                    className={`w-full text-left border rounded-xl p-4 transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      isUnlocking
                        ? "border-pavv-500/50 bg-pavv-500/10"
                        : "border-dark-border hover:border-pavv-500/40 hover:bg-dark-surface"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-dark-surface flex items-center justify-center shrink-0">
                        <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-medium text-white text-base truncate">
                            {entry.name}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColor(entry.role)}`}
                          >
                            {entry.role}
                          </span>
                        </div>
                        {entry.groupName && (
                          <span className="text-sm text-slate-400">
                            {entry.groupName}
                            {entry.threshold != null && entry.totalSigners != null
                              ? ` (${entry.threshold}-of-${entry.totalSigners})`
                              : ""}
                          </span>
                        )}
                      </div>
                      <div className="shrink-0">
                        {isUnlocking ? (
                          <div className="w-5 h-5 border-2 border-pavv-400 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                          </svg>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-base text-red-400">
              {error}
            </div>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-dark-border" />
            <span className="text-sm text-slate-400">or</span>
            <div className="flex-1 h-px bg-dark-border" />
          </div>

          {/* Import JSON section */}
          {!showImport ? (
            <button
              onClick={() => setShowImport(true)}
              className="w-full py-3 px-4 bg-dark-surface hover:bg-dark-hover border border-dark-border text-slate-300 rounded-lg text-base font-medium transition-colors duration-200 cursor-pointer flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              Import JSON Share & Save as Passkey
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-400 uppercase tracking-wider">Import Downloaded Share</p>

              {/* File picker */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 px-4 border-2 border-dashed border-dark-border hover:border-pavv-500/40 text-slate-400 rounded-lg text-base transition-colors duration-200 cursor-pointer flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                Choose pavv-share-*.json file
              </button>

              {/* Parsed share info */}
              {importedShare && (
                <div className="bg-dark-surface rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-pavv-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-base text-white font-medium">
                      Share loaded: {importedShare.role}
                    </span>
                    {importedShare.groupConfig && (
                      <span className="text-sm px-2 py-0.5 rounded-full bg-pavv-500/15 text-pavv-400">
                        {importedShare.groupConfig.name}
                      </span>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Passkey name</label>
                    <input
                      type="text"
                      value={passkeyName}
                      onChange={(e) => setPasskeyName(e.target.value)}
                      placeholder={`e.g. ${importedShare.role}'s MacBook`}
                      className="w-full px-3 py-2.5 bg-dark-card border border-dark-border rounded-lg text-base text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-pavv-500 focus:border-transparent transition-colors duration-200"
                    />
                  </div>

                  <button
                    onClick={handleSaveAsPasskey}
                    disabled={!passkeyName.trim() || saving}
                    className="w-full py-3 bg-pavv-500 hover:bg-pavv-600 text-white rounded-lg text-base font-medium transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {saving ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33" />
                        </svg>
                        Save as Passkey
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Save success */}
              {saveSuccess && (
                <div className="flex items-center gap-2 p-3 bg-pavv-500/10 rounded-lg text-pavv-400 text-base font-medium">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Passkey saved! You can now unlock it above.
                </div>
              )}

              {/* Import error */}
              {importError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
                  {importError}
                </div>
              )}
            </div>
          )}

          {/* Start fresh link */}
          <div className="mt-6 text-center">
            <button
              onClick={onStartFresh}
              className="text-base text-slate-400 hover:text-slate-300 transition-colors duration-200 cursor-pointer"
            >
              Start new key ceremony instead
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
