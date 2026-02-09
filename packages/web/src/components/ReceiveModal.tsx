import { useState } from "react";
import { useConnect, useAccount, useSwitchChain, useWriteContract } from "wagmi";
import { parseEther } from "viem";
import { toBytes32, getContractAddress } from "../lib/chain";
import { blsGunAbi } from "../lib/abi";
import { confluxESpaceTestnet, publicClient } from "../lib/wagmiConfig";
import { initHash, poseidon2Hash2 } from "@blsgun/sdk/hash";
import { generateStealthAddress } from "@blsgun/sdk/stealth";
import { computeCommitment } from "@blsgun/sdk/transaction";

interface ReceiveModalProps {
  open: boolean;
  onClose: () => void;
  groupPublicKey: { x: string; y: string };
  viewingPublicKey: { x: string; y: string };
  onDeposited: () => void;
}

function truncateHex(hex: string, chars = 8): string {
  if (hex.length <= chars * 2 + 4) return hex;
  return hex.slice(0, chars + 2) + "..." + hex.slice(-chars);
}

type DepositState = "idle" | "connecting" | "depositing" | "success";

export function ReceiveModal({ open, onClose, groupPublicKey, viewingPublicKey, onDeposited }: ReceiveModalProps) {
  const [amount, setAmount] = useState("");
  const [depositState, setDepositState] = useState<DepositState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { connectAsync, connectors } = useConnect();
  const { isConnected, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  if (!open) return null;

  const handleCopy = async () => {
    // Compressed: 0x + flags(2 hex) + spendX(64) + viewX(64) = 132 chars
    // flags byte: bit 0 = spend y is odd, bit 1 = view y is odd
    const pad = (hex: string) => BigInt(hex).toString(16).padStart(64, "0");
    const spendYOdd = BigInt(groupPublicKey.y) % 2n === 1n ? 1 : 0;
    const viewYOdd = BigInt(viewingPublicKey.y) % 2n === 1n ? 1 : 0;
    const flags = (spendYOdd | (viewYOdd << 1)).toString(16).padStart(2, "0");
    const metaAddress = "0x" + flags + pad(groupPublicKey.x) + pad(viewingPublicKey.x);
    await navigator.clipboard.writeText(metaAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDeposit = async () => {
    setError(null);

    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      setError("Please enter a valid amount.");
      return;
    }

    const contractAddress = getContractAddress();
    if (!contractAddress) {
      setError("Contract address not configured");
      return;
    }

    try {
      setDepositState("connecting");

      // Connect wallet if not connected
      if (!isConnected) {
        const connector = connectors[0];
        if (!connector) {
          throw new Error("MetaMask is not installed. Please install MetaMask to deposit.");
        }
        await connectAsync({ connector });
      }

      // Switch chain if needed
      if (chainId !== confluxESpaceTestnet.id) {
        await switchChainAsync({ chainId: confluxESpaceTestnet.id });
      }

      setDepositState("depositing");
      await initHash();

      const spendingPK = { x: BigInt(groupPublicKey.x), y: BigInt(groupPublicKey.y) };
      const viewingPK = { x: BigInt(viewingPublicKey.x), y: BigInt(viewingPublicKey.y) };

      const stealth = generateStealthAddress({ spendingPublicKey: spendingPK, viewingPublicKey: viewingPK });

      const ownerHash = poseidon2Hash2(stealth.address.x, stealth.address.y);
      const amountWei = parseEther(amount);
      const BLINDING_DOMAIN = 0x426c696e64696e67n; // "Blinding" in hex
      const blinding = poseidon2Hash2(stealth.stealthScalar, BLINDING_DOMAIN);
      const commitment = computeCommitment(ownerHash, amountWei, blinding);

      const MASK_128 = (1n << 128n) - 1n;
      const encryptedAmount = (amountWei ^ (stealth.stealthScalar & MASK_128)) & MASK_128;
      const viewTag = Number(stealth.viewTag & 0xFFn);

      const hash = await writeContractAsync({
        address: contractAddress as `0x${string}`,
        abi: blsGunAbi,
        functionName: "shield",
        args: [
          toBytes32(commitment),
          toBytes32(stealth.ephemeralPublicKey.x),
          toBytes32(stealth.ephemeralPublicKey.y),
          viewTag,
          encryptedAmount,
        ],
        value: amountWei,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      setDepositState("success");
      onDeposited();
      setTimeout(() => {
        setDepositState("idle");
        setAmount("");
        onClose();
      }, 2000);
    } catch (err: any) {
      setDepositState("idle");
      if (err?.code === 4001 || err?.message?.includes("user rejected") || err?.message?.includes("User rejected")) {
        setError("Transaction rejected by user.");
      } else if (err?.message?.includes("insufficient funds")) {
        setError("Insufficient funds for this deposit.");
      } else {
        setError(err?.message || "Deposit failed. Please try again.");
      }
    }
  };

  const buttonLabel = {
    idle: "Connect Wallet & Deposit",
    connecting: "Connecting Wallet...",
    depositing: "Depositing...",
    success: "Deposit Successful!",
  }[depositState];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-[#242A2E] rounded-2xl p-6 max-w-md w-full mx-4 border border-dark-border shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-xl font-semibold text-white">Receive CFX</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Section A: Stealth Meta-Address */}
        <div className="mb-6">
          <p className="text-sm text-slate-400 mb-3">Share this address to receive shielded payments</p>
          <div className="bg-dark-surface rounded-lg p-3">
            <span className="text-xs text-slate-400">Stealth Meta-Address</span>
            <p className="text-sm text-slate-200 font-mono break-all mt-1 leading-relaxed">
              {"0x" + (BigInt(groupPublicKey.y) % 2n === 1n ? 1 : 0 | (BigInt(viewingPublicKey.y) % 2n === 1n ? 2 : 0)).toString(16).padStart(2, "0") + BigInt(groupPublicKey.x).toString(16).padStart(64, "0") + BigInt(viewingPublicKey.x).toString(16).padStart(64, "0")}
            </p>
          </div>
          <button
            onClick={handleCopy}
            className="mt-2 w-full py-2 px-3 bg-dark-surface hover:bg-dark-hover text-slate-200 border border-dark-border rounded-lg text-sm font-medium transition-colors duration-200 cursor-pointer flex items-center justify-center gap-2"
          >
            {copied ? (
              <>
                <svg className="w-4 h-4 text-pavv-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                </svg>
                Copy Address
              </>
            )}
          </button>
        </div>

        {/* Divider */}
        <div className="border-t border-dark-border mb-5" />

        {/* Section B: Self-Deposit */}
        <div>
          <p className="text-sm font-medium text-slate-200 mb-2">Self-Deposit</p>
          <div className="flex items-center gap-2 mb-3">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              min="0"
              step="0.01"
              className="flex-1 bg-dark-surface border border-dark-border rounded-lg px-3 py-2.5 text-base text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-pavv-500 focus:border-transparent transition-colors duration-200"
            />
            <span className="text-sm font-medium text-slate-400">CFX</span>
          </div>

          <button
            onClick={handleDeposit}
            disabled={depositState !== "idle" || !amount}
            className={`w-full py-3 rounded-lg text-base font-semibold transition-colors duration-200 cursor-pointer flex items-center justify-center gap-2 ${
              depositState === "success"
                ? "bg-pavv-500/20 text-pavv-400"
                : "bg-pavv-500 hover:bg-pavv-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            }`}
          >
            {(depositState === "connecting" || depositState === "depositing") && (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {depositState === "success" && (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            {buttonLabel}
          </button>

          {error && (
            <p className="mt-2 text-sm text-red-400">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
