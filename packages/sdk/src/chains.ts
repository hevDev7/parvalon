/**
 * Chain definitions (INTEGRATION.md §8).
 *
 * Robinhood Chain testnet is the primary target (chainId 46630); Arbitrum
 * Sepolia (421614) is the fallback and local anvil (31337) is for dev. These are
 * viem `Chain` objects ready to pass to `createPublicClient`/`createWalletClient`.
 * RPC URLs are placeholders — override `rpcUrls.default.http` for your endpoint.
 */
import { defineChain } from "viem";
import { arbitrumSepolia, foundry } from "viem/chains";

/** Robinhood Chain testnet (Arbitrum Orbit L2) — primary network. */
export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    // Override with ROBINHOOD_TESTNET_RPC_URL in your app.
    default: { http: ["https://rpc.testnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://explorer.testnet.chain.robinhood.com",
    },
  },
  testnet: true,
});

/** Arbitrum Sepolia — fallback network (re-exported from viem). */
export const arbitrumSepoliaChain = arbitrumSepolia;

/** Local anvil — dev network (re-exported from viem as `foundry`, chainId 31337). */
export const localAnvil = foundry;

/** All chains the SDK knows about, indexed by chainId. */
export const CHAINS = {
  46630: robinhoodTestnet,
  421614: arbitrumSepoliaChain,
  31337: localAnvil,
} as const;

export type KnownChainId = keyof typeof CHAINS;

/** Look up a known chain by id, or `undefined` if not one of the three. */
export function chainById(chainId: number) {
  return (CHAINS as Record<number, (typeof CHAINS)[KnownChainId]>)[chainId];
}
