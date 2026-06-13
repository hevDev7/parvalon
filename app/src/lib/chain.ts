import { defineChain } from "viem";

/**
 * Chains CorporaX targets. Robinhood Chain is primary; Arbitrum Sepolia is the
 * documented fallback; anvil is local dev. Chain definitions are intentionally
 * explicit so the app works against any of them by env alone.
 */
export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" },
  },
  testnet: true,
});

export const arbitrumSepolia = defineChain({
  id: 421614,
  name: "Arbitrum Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc"] } },
  blockExplorers: { default: { name: "Arbiscan", url: "https://sepolia.arbiscan.io" } },
  testnet: true,
});

export const anvil = defineChain({
  id: 31337,
  name: "Anvil (local)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545"] } },
  testnet: true,
});

const ALL = [robinhoodTestnet, arbitrumSepolia, anvil] as const;

/** Active chain id — env-driven, defaulting to the live Robinhood testnet (46630)
 *  so the deployed app works with zero config. For local anvil dev, set
 *  NEXT_PUBLIC_CHAIN_ID=31337. */
export const ACTIVE_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 46630);

export const activeChain = ALL.find((c) => c.id === ACTIVE_CHAIN_ID) ?? anvil;

export function explorerTxUrl(hash: string): string {
  const base = process.env.NEXT_PUBLIC_BLOCKSCOUT_URL || activeChain.blockExplorers?.default.url;
  return base ? `${base}/tx/${hash}` : `#${hash}`;
}

export function explorerAddressUrl(addr: string): string {
  const base = process.env.NEXT_PUBLIC_BLOCKSCOUT_URL || activeChain.blockExplorers?.default.url;
  return base ? `${base}/address/${addr}` : `#${addr}`;
}
