import { ACTIVE_CHAIN_ID } from "@/lib/chain";

/**
 * Real Robinhood Chain testnet (chainId 46630) token contracts, from the official
 * Robinhood Chain docs. Parvalon targets these real tokens directly — the whole
 * thesis is a permissionless overlay on the tokens that already exist.
 *
 * Decimals matter: the payout stablecoin **USDG is 6 decimals**, while the
 * tokenized stocks are 18 decimals. All USDG amounts must be parsed/formatted
 * with the payout token's real decimals, never a hardcoded 18.
 */
export type Stock = { symbol: string; name: string; address: `0x${string}` };

export const ROBINHOOD = {
  usdg: "0x7E955252E15c84f5768B83c41a71F9eba181802F" as `0x${string}`,
  weth: "0x7943e237c7F95DA44E0301572D358911207852Fa" as `0x${string}`,
  stocks: [
    { symbol: "TSLA", name: "Tesla", address: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E" },
    { symbol: "AMZN", name: "Amazon", address: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02" },
    { symbol: "PLTR", name: "Palantir", address: "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0" },
    { symbol: "NFLX", name: "Netflix", address: "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93" },
    { symbol: "AMD", name: "AMD", address: "0x71178BAc73cBeb415514eB542a8995b82669778d" },
  ] as Stock[],
} as const;

/** True when the app targets the real Robinhood Chain tokens (vs local mocks). */
export const USING_REAL_TOKENS = ACTIVE_CHAIN_ID === 46630;

/** Tokens that are NOT 18-decimals. Real USDG is the only one (6 dp). */
const NON_18: Record<string, number> = { [ROBINHOOD.usdg.toLowerCase()]: 6 };

/** Decimals for a token address — real USDG is 6, every other token here is 18. */
export function tokenDecimals(address?: string): number {
  return (address && NON_18[address.toLowerCase()]) || 18;
}

/** Decimals of the payout stablecoin USDG on the active chain (6 real / 18 mock). */
export const PAYOUT_DECIMALS = USING_REAL_TOKENS ? 6 : 18;
