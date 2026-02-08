import { JsonRpcProvider, formatEther } from "ethers";

const RPC_URL = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545";
const CONTRACT_ADDRESS = import.meta.env.VITE_BLSGUN_ADDRESS || "";

let provider: JsonRpcProvider | null = null;

export function getProvider(): JsonRpcProvider {
  if (!provider) {
    provider = new JsonRpcProvider(RPC_URL);
  }
  return provider;
}

export function formatBalance(wei: bigint): string {
  const eth = formatEther(wei);
  const num = parseFloat(eth);
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export async function getContractBalance(): Promise<string | null> {
  if (!CONTRACT_ADDRESS) return null;
  try {
    const p = getProvider();
    const balance = await p.getBalance(CONTRACT_ADDRESS);
    return formatBalance(balance);
  } catch {
    return null;
  }
}

export function getContractAddress(): string {
  return CONTRACT_ADDRESS;
}
