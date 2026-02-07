import type { SignerRole } from "../store/treasury";

interface HeaderProps {
  currentSigner: SignerRole | null;
  onSignerChange: (role: SignerRole) => void;
  initialized: boolean;
}

const roles: SignerRole[] = ["Accountant", "Manager", "CFO"];

export function Header({ currentSigner, onSignerChange, initialized }: HeaderProps) {
  return (
    <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gun-600 rounded-lg flex items-center justify-center font-bold text-sm">
            BG
          </div>
          <div>
            <h1 className="text-lg font-semibold">BLSGun</h1>
            <p className="text-xs text-gray-400">Privacy-Preserving Treasury</p>
          </div>
        </div>

        {initialized && (
          <div className="flex gap-2">
            {roles.map((role) => (
              <button
                key={role}
                onClick={() => onSignerChange(role)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  currentSigner === role
                    ? "bg-gun-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
                }`}
              >
                {role}
              </button>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
