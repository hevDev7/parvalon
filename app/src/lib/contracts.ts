import { registryAbi, distributorAbi, actionSourceAbi, erc20Abi } from "@/generated/abi";
import { deployments } from "@/generated/deployments";
import { ACTIVE_CHAIN_ID } from "@/lib/chain";
import { ROBINHOOD, USING_REAL_TOKENS, PAYOUT_USDG } from "@/lib/tokens";

export { registryAbi, distributorAbi, actionSourceAbi, erc20Abi };

type Addr = `0x${string}`;
const asAddr = (v: string | undefined): Addr | undefined =>
  v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Addr) : undefined;

const local = deployments[String(ACTIVE_CHAIN_ID)];
const stock = (sym: string) => ROBINHOOD.stocks.find((s) => s.symbol === sym)?.address;

/**
 * Protocol contract addresses (Parvalon's own registry/distributor) — resolved
 * env-first with a fallback to the bundled deployment.
 */
export const addresses = {
  registry: asAddr(process.env.NEXT_PUBLIC_REGISTRY_ADDRESS) ?? (local?.registry as Addr | undefined),
  distributor: asAddr(process.env.NEXT_PUBLIC_DISTRIBUTOR_ADDRESS) ?? (local?.distributor as Addr | undefined),
  actionSource: local?.actionSource as Addr | undefined,
} as const;

/**
 * Token addresses. On Robinhood Chain (46630) these are the REAL token
 * contracts from the Robinhood docs; on local/anvil they are the mock tokens
 * from the bundled deployment.
 */
export const tokens = USING_REAL_TOKENS
  ? { usdg: PAYOUT_USDG as Addr, tsla: stock("TSLA"), amzn: stock("AMZN") }
  : {
      usdg: asAddr(process.env.NEXT_PUBLIC_USDG_ADDRESS) ?? (local?.usdg as Addr | undefined),
      tsla: asAddr(process.env.NEXT_PUBLIC_TSLA_ADDRESS) ?? (local?.tsla as Addr | undefined),
      amzn: asAddr(process.env.NEXT_PUBLIC_AMZN_ADDRESS) ?? (local?.amzn as Addr | undefined),
    };

/** Assets the issuer can announce a corporate action on. */
export const selectableAssets: { symbol: string; address: Addr }[] = (
  USING_REAL_TOKENS
    ? ROBINHOOD.stocks.map((s) => ({ symbol: s.symbol, address: s.address as Addr }))
    : ([
        { symbol: "TSLA", address: tokens.tsla },
        { symbol: "AMZN", address: tokens.amzn },
      ] as { symbol: string; address: Addr | undefined }[])
).filter((a): a is { symbol: string; address: Addr } => Boolean(a.address));

/** Token metadata for symbol/label resolution in the UI + feed. */
export const knownTokens: Record<string, { symbol: string; name: string }> = {};
if (USING_REAL_TOKENS) {
  knownTokens[ROBINHOOD.usdg.toLowerCase()] = { symbol: "USDG", name: "USD for Global" };
  knownTokens[ROBINHOOD.usdgMock.toLowerCase()] = { symbol: "USDG", name: "USD for Global (testnet)" };
  if (tokens.usdg) knownTokens[tokens.usdg.toLowerCase()] = { symbol: "USDG", name: "USD for Global (testnet)" };
  knownTokens[ROBINHOOD.weth.toLowerCase()] = { symbol: "WETH", name: "Wrapped Ether" };
  for (const s of ROBINHOOD.stocks) knownTokens[s.address.toLowerCase()] = { symbol: s.symbol, name: s.name };
} else if (local) {
  knownTokens[local.usdg.toLowerCase()] = { symbol: "USDG", name: "USD for Global" };
  knownTokens[local.tsla.toLowerCase()] = { symbol: "TSLA", name: "Tesla" };
  knownTokens[local.amzn.toLowerCase()] = { symbol: "AMZN", name: "Amazon" };
}

export function tokenSymbol(addr?: string): string {
  if (!addr) return "—";
  return knownTokens[addr.toLowerCase()]?.symbol ?? `${addr.slice(0, 6)}…`;
}

export const isConfigured = Boolean(addresses.registry && addresses.distributor);
