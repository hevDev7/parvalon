import { ACTIVE_CHAIN_ID } from "@/lib/chain";

/**
 * Real Robinhood Chain testnet (chainId 46630) token contracts, from the official
 * Robinhood Chain docs. Parvalon targets these real tokens directly — the whole
 * thesis is a permissionless overlay on the tokens that already exist.
 *
 * Decimals matter: the payout stablecoin **USDG is 6 decimals**, while the
 * tokenized stocks are 18 decimals. All USDG amounts must be parsed/formatted
 * with the payout token's real decimals, never a hardcoded 18.
 *
 * Payout USDG on testnet: the *real* USDG faucet is rate-limited (~100/24h), which
 * is too little to fund a meaningful multi-holder dividend. So the payout/settlement
 * token defaults to `usdgMock` — a faucet-mintable 6-decimal mock USDG Parvalon
 * deployed on 46630 — while the *stock* tokens stay real. Override the payout token
 * with `NEXT_PUBLIC_USDG_ADDRESS` (e.g. point it back at `usdg` for the real one).
 */
export type Stock = { symbol: string; name: string; address: `0x${string}` };

export const ROBINHOOD = {
  // Real USDG (canonical; 6dp). Faucet is rate-limited, so not the default payout.
  usdg: "0x7E955252E15c84f5768B83c41a71F9eba181802F" as `0x${string}`,
  // Parvalon-deployed faucet-mintable mock USDG (6dp) — default testnet payout token.
  usdgMock: "0x6e61B4444f40FBc0a7725c29572cC014b76064f5" as `0x${string}`,
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

const envAddr = (v?: string): `0x${string}` | undefined =>
  v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v.toLowerCase() as `0x${string}`) : undefined;

/**
 * Active payout stablecoin on Robinhood Chain: the faucet-mintable mock USDG by
 * default (real USDG faucet is rate-limited), overridable via NEXT_PUBLIC_USDG_ADDRESS.
 * Undefined on non-real chains (the local deployment supplies the token there).
 */
export const PAYOUT_USDG: `0x${string}` | undefined = USING_REAL_TOKENS
  ? (envAddr(process.env.NEXT_PUBLIC_USDG_ADDRESS) ?? ROBINHOOD.usdgMock)
  : undefined;

/** True when the active payout USDG is the Parvalon faucet-mintable mock (self-serve mint). */
export const PAYOUT_USDG_IS_MOCK =
  USING_REAL_TOKENS && PAYOUT_USDG === ROBINHOOD.usdgMock;

/** Tokens that are NOT 18-decimals. The USDG variants are 6 dp. */
const NON_18: Record<string, number> = {
  [ROBINHOOD.usdg.toLowerCase()]: 6,
  [ROBINHOOD.usdgMock.toLowerCase()]: 6,
};
// Allow an env-supplied payout token to declare its decimals (defaults to 6 for USDG).
{
  const ov = envAddr(process.env.NEXT_PUBLIC_USDG_ADDRESS);
  const d = Number(process.env.NEXT_PUBLIC_USDG_DECIMALS);
  if (ov) NON_18[ov] = Number.isFinite(d) && d > 0 ? d : 6;
}

/** Decimals for a token address — USDG (real/mock) is 6, every other token here is 18. */
export function tokenDecimals(address?: string): number {
  return (address && NON_18[address.toLowerCase()]) || 18;
}

/** Decimals of the payout stablecoin USDG on the active chain (6 real/mock, 18 local). */
export const PAYOUT_DECIMALS = USING_REAL_TOKENS ? tokenDecimals(PAYOUT_USDG) : 18;
