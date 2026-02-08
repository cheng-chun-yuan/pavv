import type { SignerRole, GroupConfig, KeyCeremonyData, Signer } from "../store/treasury";

type Tab = "dashboard" | "payment" | "transactions" | "audit";

interface SidebarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  currentSigner: SignerRole | null;
  onSignerChange: (role: SignerRole) => void;
  initialized: boolean;
  pendingCount: number;
  onLogout: () => void;
  sessionTimeRemaining: number;
  groupConfig: GroupConfig | null;
  keyCeremony: KeyCeremonyData | null;
  onNewTransaction: () => void;
  signers: Signer[];
  onSignerLogin?: (role: SignerRole) => void;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function truncateAddress(hex: string): string {
  if (!hex) return "";
  const clean = hex.startsWith("0x") ? hex : "0x" + hex;
  if (clean.length <= 14) return clean;
  return `cfx:${clean.slice(0, 8)}...${clean.slice(-4)}`;
}

const navItems: { key: Tab; label: string; icon: JSX.Element }[] = [
  {
    key: "dashboard",
    label: "Home",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    ),
  },
  {
    key: "transactions",
    label: "Transactions",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
  },
  {
    key: "audit",
    label: "Audit",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
  },
];

export function Sidebar({
  activeTab,
  onTabChange,
  currentSigner,
  onSignerChange,
  initialized,
  pendingCount,
  onLogout,
  sessionTimeRemaining,
  groupConfig,
  keyCeremony,
  onNewTransaction,
  signers,
  onSignerLogin,
}: SidebarProps) {
  const roles = groupConfig?.roles ?? [];
  const showSessionWarning =
    initialized && sessionTimeRemaining > 0 && sessionTimeRemaining < 5 * 60 * 1000;

  const stealthAddress = keyCeremony?.groupPublicKey?.x ?? "";

  return (
    <aside className="w-72 bg-sidebar-bg flex flex-col h-screen sticky top-0">
      {/* Wallet Identity */}
      <div className="px-4 py-5 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-pavv-500/20 rounded-lg flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-pavv-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
          </div>
          <div className="min-w-0">
            <span className="text-white text-lg font-semibold block leading-tight">Pavv</span>
            {initialized && stealthAddress && (
              <span className="text-sidebar-text text-xs font-mono block truncate">
                {truncateAddress(stealthAddress)}
              </span>
            )}
          </div>
        </div>
        {initialized && groupConfig && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sidebar-text text-xs">{groupConfig.name}</span>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-pavv-500/20 text-pavv-400">
              {groupConfig.threshold}-of-{groupConfig.totalSigners} MPC
            </span>
          </div>
        )}
      </div>

      {/* New Transaction Button */}
      {initialized && (
        <div className="px-4 pt-4 pb-2">
          <button
            onClick={onNewTransaction}
            className="w-full py-3 bg-pavv-500 hover:bg-pavv-600 text-white font-semibold rounded-lg text-base transition-colors duration-200 cursor-pointer flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New transaction
          </button>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 space-y-0.5">
        {navItems.map((item) => (
          <button
            key={item.key}
            onClick={() => onTabChange(item.key)}
            className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-base font-medium transition-colors duration-200 cursor-pointer ${
              activeTab === item.key
                ? "text-white bg-sidebar-surface border-l-2 border-pavv-400"
                : "text-sidebar-text hover:text-white hover:bg-sidebar-hover border-l-2 border-transparent"
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.key === "transactions" && pendingCount > 0 && (
              <span className="ml-auto bg-red-500 text-white text-xs font-semibold rounded-full w-5 h-5 flex items-center justify-center">
                {pendingCount}
              </span>
            )}
          </button>
        ))}

        {/* Settings (disabled) */}
        <button
          disabled
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-text/30 border-l-2 border-transparent cursor-not-allowed"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span>Settings</span>
        </button>
      </nav>

      {/* Session warning */}
      {showSessionWarning && (
        <div className="mx-3 mb-2 p-2.5 bg-sidebar-surface border border-sidebar-border rounded-lg">
          <div className="flex items-center gap-2 text-amber-400">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs font-medium">
              Session expires in {formatTime(sessionTimeRemaining)}
            </span>
          </div>
        </div>
      )}

      {/* Signer List (compact) */}
      {initialized && (
        <div className="px-4 py-3 border-t border-sidebar-border">
          {/* Current identity badge */}
          {currentSigner && (
            <div className="mb-3 px-2.5 py-2 bg-pavv-500/10 border border-pavv-500/20 rounded-lg">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-pavv-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                </svg>
                <div className="min-w-0">
                  <p className="text-[10px] text-pavv-400/70 uppercase tracking-wider leading-tight">Signed in as</p>
                  <p className="text-sm font-semibold text-pavv-400 truncate">{currentSigner}</p>
                </div>
              </div>
            </div>
          )}

          <p className="text-xs font-medium text-sidebar-text/60 uppercase tracking-wider mb-2">
            Signers
          </p>
          <div className="space-y-1">
            {roles.map((role) => {
              const signer = signers.find((s) => s.role === role);
              const hasKey = signer?.hasKey ?? false;
              const isActive = currentSigner === role;
              return (
                <button
                  key={role}
                  type="button"
                  className={`w-full text-left px-2.5 py-2 rounded text-sm flex items-center gap-2 cursor-pointer transition-colors duration-200 ${
                    isActive
                      ? "text-pavv-400 bg-pavv-500/15 font-medium"
                      : hasKey
                        ? "text-sidebar-text hover:text-white"
                        : "text-sidebar-text/50 hover:text-sidebar-text/70 hover:bg-sidebar-hover"
                  }`}
                  onClick={() => hasKey ? onSignerChange(role) : onSignerLogin?.(role)}
                  title={!hasKey ? "Sign in with passkey to unlock" : isActive ? "Currently active" : "Switch to this signer"}
                >
                  {isActive ? (
                    <svg className="w-3.5 h-3.5 text-pavv-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                    </svg>
                  ) : (
                    <div className={`w-1.5 h-1.5 rounded-full ${
                      hasKey ? "bg-pavv-500/50" : "bg-sidebar-text/20"
                    }`} />
                  )}
                  <span className="flex-1">{role}</span>
                  {!hasKey && (
                    <span className="flex items-center gap-1 text-[10px] text-sidebar-text/40">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                      </svg>
                      passkey
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Logout */}
      {initialized && (
        <div className="px-4 pb-2">
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-sidebar-text hover:text-red-400 transition-colors duration-200 cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
            Logout
          </button>
        </div>
      )}

    </aside>
  );
}
