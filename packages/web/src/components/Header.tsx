import type { SignerRole } from "../store/treasury";

interface HeaderProps {
  title: string;
  currentSigner: SignerRole | null;
  sessionTimeRemaining: number;
  onLoginClick?: () => void;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function Header({
  title,
  currentSigner,
  sessionTimeRemaining,
  onLoginClick,
}: HeaderProps) {
  const showTimer = sessionTimeRemaining > 0 && sessionTimeRemaining < 5 * 60 * 1000;

  return (
    <header className="glass-card border-b border-dark-border sticky top-0 z-30">
      <div className="px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">{title}</h1>

        <div className="flex items-center gap-3">
          {/* Network badge */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 border border-pavv-500/40 rounded-full text-sm font-medium text-pavv-400">
            <div className="w-2 h-2 rounded-full bg-pavv-500 animate-pulse" />
            Conflux eSpace
          </div>

          {/* Session timer warning */}
          {showTimer && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-900/30 border border-amber-700/40 rounded-full text-amber-400 text-sm font-medium">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formatTime(sessionTimeRemaining)}
            </div>
          )}

          {/* Notification bell */}
          <button className="w-9 h-9 rounded-full border border-dark-border flex items-center justify-center text-slate-400 hover:bg-dark-surface transition-colors duration-200 cursor-pointer">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
          </button>

          {/* Login button (only when not logged in) */}
          {!currentSigner && (
            <button
              onClick={onLoginClick}
              className="flex items-center gap-2 px-4 py-2 bg-pavv-500 hover:bg-pavv-600 text-white rounded-lg text-sm font-medium transition-colors duration-200 cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33" />
              </svg>
              Login with Passkey
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
