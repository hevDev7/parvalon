"use client";

import { useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useReadContracts, useWriteContract } from "wagmi";
import { erc20Abi, knownTokens, selectableAssets, tokens } from "@/lib/contracts";
import { tokenDecimals, USING_REAL_TOKENS, PAYOUT_USDG_IS_MOCK } from "@/lib/tokens";
import { shortAddr } from "@/lib/format";
import { Card, Kicker, Spinner } from "@/components/ui";
import { StockLogo } from "@/components/StockLogo";
import { WalletButton } from "@/components/WalletButton";

/**
 * Test-token helper. On Robinhood Chain the STOCK contracts are the REAL tokens —
 * not faucet-mintable by us — so this page surfaces balances, lets you add each
 * token to your wallet (EIP-747), and copy its address. The payout **USDG** is a
 * faucet-mintable mock (the real USDG faucet is rate-limited to ~100/24h), so when
 * it is active you can self-serve mint test USDG straight from here.
 */
type Tok = { symbol: string; name: string; address: `0x${string}`; decimals: number; mintable: boolean };

/** How much test USDG one "Mint" click grants. */
const MINT_USDG = 100_000;

/** Official Robinhood Chain testnet faucet for the real stock tokens. */
const STOCK_FAUCET_URL = "https://faucet.testnet.chain.robinhood.com";

const LIST: Tok[] = [
  ...(tokens.usdg ? [{ symbol: "USDG", address: tokens.usdg as `0x${string}` }] : []),
  ...selectableAssets,
].map((t) => ({
  symbol: t.symbol,
  address: t.address,
  decimals: tokenDecimals(t.address),
  name: knownTokens[t.address.toLowerCase()]?.name ?? t.symbol,
  // Only the mock payout USDG has an open mint; real stocks/USDG do not.
  mintable: PAYOUT_USDG_IS_MOCK && t.address.toLowerCase() === (tokens.usdg ?? "").toLowerCase(),
}));

export function FaucetPanel() {
  const { address, isConnected } = useAccount();
  const [copied, setCopied] = useState<string | null>(null);
  const [minting, setMinting] = useState<string | null>(null);
  const { writeContractAsync } = useWriteContract();

  const balances = useReadContracts({
    contracts: LIST.map((t) => ({
      address: t.address,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [address ?? "0x0000000000000000000000000000000000000000"] as const,
    })),
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });

  async function mint(t: Tok) {
    if (!address) return;
    setMinting(t.address);
    try {
      await writeContractAsync({
        address: t.address,
        abi: erc20Abi,
        functionName: "mint",
        args: [address, parseUnits(String(MINT_USDG), t.decimals)],
      });
      // Give the node a moment, then refresh balances.
      setTimeout(() => balances.refetch(), 2500);
    } catch {
      /* user rejected or tx failed */
    } finally {
      setMinting((m) => (m === t.address ? null : m));
    }
  }

  async function addToWallet(t: Tok) {
    const eth = (typeof window !== "undefined" ? (window as unknown as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum : undefined);
    if (!eth) return;
    try {
      await eth.request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: { address: t.address, symbol: t.symbol, decimals: t.decimals } },
      });
    } catch {
      /* user dismissed */
    }
  }

  async function copy(addr: string) {
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(addr);
      setTimeout(() => setCopied((c) => (c === addr ? null : c)), 1400);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {LIST.map((t, i) => {
          const raw = balances.data?.[i]?.result as bigint | undefined;
          const bal =
            raw !== undefined
              ? Number(formatUnits(raw, t.decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })
              : "—";
          return (
            <Card key={t.address} className="flex flex-col p-5">
              <div className="flex items-center gap-3">
                <StockLogo symbol={t.symbol} size={40} />
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{t.symbol}</p>
                  <p className="truncate text-[0.72rem] text-ink-faint">{t.name}</p>
                </div>
              </div>

              <div className="mt-4 flex items-baseline justify-between">
                <span className="text-[0.72rem] uppercase tracking-wide text-ink-faint">Balance</span>
                <span className="tabular text-sm font-medium text-ink">
                  {isConnected ? (balances.isLoading ? <Spinner className="h-3.5 w-3.5" /> : bal) : "—"}
                </span>
              </div>

              <button
                onClick={() => copy(t.address)}
                className="mt-3 flex items-center justify-between rounded-md border border-line bg-surface-inset px-2.5 py-1.5 text-left text-[0.72rem] text-ink-soft transition hover:border-line-strong"
                title="Copy address"
              >
                <span className="tabular">{shortAddr(t.address)}</span>
                <span className="text-ink-faint">{copied === t.address ? "Copied ✓" : "Copy"}</span>
              </button>

              {t.mintable ? (
                isConnected && (
                  <button
                    onClick={() => mint(t)}
                    disabled={minting === t.address}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-brand py-2 text-sm font-semibold text-on-ink transition hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {minting === t.address ? <Spinner className="h-3.5 w-3.5" /> : null}
                    {minting === t.address ? "Minting…" : `Mint ${MINT_USDG.toLocaleString()} USDG`}
                  </button>
                )
              ) : (
                <a
                  href={STOCK_FAUCET_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-line-strong bg-surface-raised py-2 text-sm font-semibold text-ink transition hover:border-ink"
                >
                  Get from faucet <span aria-hidden>↗</span>
                </a>
              )}

              <button
                onClick={() => addToWallet(t)}
                className="mt-3 w-full rounded-md border border-line-strong bg-surface-raised py-2 text-sm font-semibold text-ink transition hover:border-ink"
              >
                Add to wallet
              </button>
            </Card>
          );
        })}
      </div>

      {!isConnected && (
        <Card className="flex items-center justify-between gap-4 p-5">
          <p className="text-sm text-ink-soft">Connect to see your balances and add tokens to your wallet.</p>
          <WalletButton />
        </Card>
      )}

      <Card className="p-5">
        <Kicker>How to get test tokens</Kicker>
        <p className="mt-2 text-sm text-ink-soft">
          {USING_REAL_TOKENS ? (
            <>
              The <strong>stocks</strong> (TSLA, AMZN, PLTR, NFLX, AMD) are the <strong>real Robinhood Chain
              testnet</strong> contracts (chainId 46630, 18 decimals) — not mintable here; get them from the{" "}
              <a
                href={STOCK_FAUCET_URL}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
              >
                official Robinhood Chain testnet faucet ↗
              </a>
              .{" "}
              {PAYOUT_USDG_IS_MOCK ? (
                <>
                  The payout <strong>USDG</strong> is a faucet-mintable 6-decimal test token (the real USDG faucet is
                  rate-limited to ~100/24h), so use <strong>Mint {MINT_USDG.toLocaleString()} USDG</strong> above to
                  fund and claim dividends at scale.
                </>
              ) : (
                <>USDG is 6 decimals.</>
              )}
            </>
          ) : (
            <>Local mock tokens — mint them with the Foundry CLI (see the repo README) for a fully self-served demo.</>
          )}
        </p>
      </Card>
    </div>
  );
}
