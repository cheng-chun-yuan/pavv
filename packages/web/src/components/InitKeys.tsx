import { useState } from "react";

interface InitKeysProps {
  onInit: () => void;
}

export function InitKeys({ onInit }: InitKeysProps) {
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);

  const steps = [
    "Generating master spending key on Grumpkin curve...",
    "Splitting into 2-of-3 Shamir shares...",
    "Pre-computing FROST nonce pairs...",
    "Deriving viewing key for audit...",
    "Distributing shares to signers...",
  ];

  const handleInit = async () => {
    setLoading(true);
    for (let i = 0; i < steps.length; i++) {
      setStep(i);
      await new Promise((r) => setTimeout(r, 600));
    }
    onInit();
  };

  return (
    <div className="flex items-center justify-center min-h-[70vh]">
      <div className="max-w-md w-full">
        <div className="bg-gray-900 rounded-2xl p-8 border border-gray-800 text-center">
          <div className="w-16 h-16 bg-gun-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>

          <h2 className="text-2xl font-bold mb-2">Setup Treasury</h2>
          <p className="text-gray-400 mb-6">
            Generate FROST 2-of-3 threshold keys for your corporate treasury.
            Any 2 of 3 signers can authorize transactions.
          </p>

          {!loading ? (
            <button
              onClick={handleInit}
              className="w-full py-3 bg-gun-600 hover:bg-gun-500 rounded-xl font-semibold transition-colors"
            >
              Generate Keys
            </button>
          ) : (
            <div className="space-y-3">
              {steps.map((s, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-3 text-sm text-left transition-opacity ${
                    i <= step ? "opacity-100" : "opacity-30"
                  }`}
                >
                  {i < step ? (
                    <span className="text-green-400 w-5 text-center">+</span>
                  ) : i === step ? (
                    <span className="text-gun-400 w-5 text-center animate-pulse">
                      ...
                    </span>
                  ) : (
                    <span className="text-gray-600 w-5 text-center">-</span>
                  )}
                  <span>{s}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 p-3 bg-gray-800/50 rounded-lg text-xs text-gray-500">
            Curve: Grumpkin (BN254 cycle) | Threshold: 2-of-3 | Protocol: FROST
            RFC 9591
          </div>
        </div>
      </div>
    </div>
  );
}
