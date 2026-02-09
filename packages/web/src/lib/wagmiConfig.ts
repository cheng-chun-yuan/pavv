import { createConfig, http } from "wagmi";
import { defineChain } from "viem";
import { createPublicClient, http as viemHttp } from "viem";
import { injected } from "wagmi/connectors";

const RPC_URL = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545";

export const confluxESpaceTestnet = defineChain({
  id: 71,
  name: "Conflux eSpace Testnet",
  nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: { name: "ConfluxScan", url: "https://evmtestnet.confluxscan.org" },
  },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [confluxESpaceTestnet],
  connectors: [injected()],
  transports: {
    [confluxESpaceTestnet.id]: http(RPC_URL),
  },
});

export const publicClient = createPublicClient({
  chain: confluxESpaceTestnet,
  transport: viemHttp(RPC_URL),
});
