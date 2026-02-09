import { formatEther } from "viem";
import { publicClient } from "./wagmiConfig";

const CONTRACT_ADDRESS = import.meta.env.VITE_BLSGUN_ADDRESS || "";

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
    const balance = await publicClient.getBalance({
      address: CONTRACT_ADDRESS as `0x${string}`,
    });
    return formatBalance(balance);
  } catch {
    return null;
  }
}

export function getContractAddress(): string {
  return CONTRACT_ADDRESS;
}

export function toBytes32(n: bigint): `0x${string}` {
  return `0x${n.toString(16).padStart(64, "0")}`;
}
