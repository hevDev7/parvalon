import { registryAbi, distributorAbi, actionSourceAbi, erc20Abi } from "@/generated/abi";
import { deployments } from "@/generated/deployments";
import { ACTIVE_CHAIN_ID } from "@/lib/chain";

export { registryAbi, distributorAbi, actionSourceAbi, erc20Abi };

type Addr = `0x${string}`;
const asAddr = (v: string | undefined): Addr | undefined =>
  v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Addr) : undefined;

const local = deployments[String(ACTIVE_CHAIN_ID)];

/**
 * Contract addresses, resolved env-first (production) with a fallback to the
 * bundled local deployment so the app runs against a seeded anvil with no config.
 */
export const addresses = {
  registry: asAddr(process.env.NEXT_PUBLIC_REGISTRY_ADDRESS) ?? (local?.registry as Addr | undefined),
  distributor: asAddr(process.env.NEXT_PUBLIC_DISTRIBUTOR_ADDRESS) ?? (local?.distributor as Addr | undefined),
  actionSource: local?.actionSource as Addr | undefined,
} as const;

/** Token addresses (env-first, then bundled local deployment) for the issuer console. */
export const tokens = {
  usdg: asAddr(process.env.NEXT_PUBLIC_USDG_ADDRESS) ?? (local?.usdg as Addr | undefined),
  tsla: asAddr(process.env.NEXT_PUBLIC_TSLA_ADDRESS) ?? (local?.tsla as Addr | undefined),
  amzn: asAddr(process.env.NEXT_PUBLIC_AMZN_ADDRESS) ?? (local?.amzn as Addr | undefined),
} as const;

/** Assets selectable in the issuer console (those with a known address). */
export const selectableAssets: { symbol: string; address: Addr }[] = (
  [
    { symbol: "TSLA", address: tokens.tsla },
    { symbol: "AMZN", address: tokens.amzn },
  ] as { symbol: string; address: Addr | undefined }[]
).filter((a): a is { symbol: string; address: Addr } => Boolean(a.address));

/** Known token metadata for symbol/label resolution in the UI + feed. */
export const knownTokens: Record<string, { symbol: string; name: string }> = {};
if (local) {
  knownTokens[local.usdg.toLowerCase()] = { symbol: "USDG", name: "USD for Global" };
  knownTokens[local.tsla.toLowerCase()] = { symbol: "TSLA", name: "Tesla" };
  knownTokens[local.amzn.toLowerCase()] = { symbol: "AMZN", name: "Amazon" };
}

export function tokenSymbol(addr?: string): string {
  if (!addr) return "—";
  return knownTokens[addr.toLowerCase()]?.symbol ?? `${addr.slice(0, 6)}…`;
}

export const isConfigured = Boolean(addresses.registry && addresses.distributor);
