"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAccount, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { addresses, distributorAbi } from "@/lib/contracts";
import { explorerTxUrl } from "@/lib/chain";
import { fmtAmount } from "@/lib/format";
import { tokenDecimals } from "@/lib/tokens";
import { getEligibleClaims } from "@/lib/proofs";
import { gaslessEnabled, relayClaim } from "@/lib/relay";
import type { ActionLike, EligibleClaim } from "@/lib/types";
import { Button, Card, EmptyState, Kicker, Spinner } from "@/components/ui";
import { StockLogo } from "@/components/StockLogo";
import { WalletButton } from "@/components/WalletButton";

interface FeedAction {
  id: number;
  actionType: ActionLike["actionType"];
  status: ActionLike["status"];
  payoutToken: `0x${string}`;
  payoutSymbol: string;
  asset: `0x${string}`;
  assetSymbol: string;
  ratePerShareWei: string;
  metadataURI: string;
}

async function fetchFeed(): Promise<ActionLike[]> {
  const res = await fetch("/api/actions", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load corporate actions");
  const data = (await res.json()) as { actions: FeedAction[] };
  return data.actions.map((a) => ({
    id: a.id,
    actionType: a.actionType,
    status: a.status,
    payoutToken: a.payoutToken,
    payoutSymbol: a.payoutSymbol,
    asset: a.asset,
    assetSymbol: a.assetSymbol,
    ratePerShareWei: a.ratePerShareWei,
    metadataURI: a.metadataURI,
  }));
}

/* ------------------------------------------------------------ cell helpers */
const held = (c: EligibleClaim) => `${fmtAmount(c.snapshotBalanceWei, tokenDecimals(c.asset))} ${c.assetSymbol}`;
const rate = (c: EligibleClaim) => `${fmtAmount(c.ratePerShareWei, tokenDecimals(c.payoutToken))} ${c.payoutSymbol}/sh`;
const dividend = (c: EligibleClaim) => `${fmtAmount(c.amountWei, tokenDecimals(c.payoutToken))} ${c.payoutSymbol}`;

export function ClaimPanel() {
  const { address, isConnected } = useAccount();

  const feed = useQuery({ queryKey: ["feed"], queryFn: fetchFeed, refetchInterval: 15_000 });

  const eligible = useQuery({
    queryKey: ["eligible", address, feed.dataUpdatedAt],
    queryFn: () => getEligibleClaims(address!, feed.data ?? []),
    enabled: Boolean(address) && Boolean(feed.data),
  });

  const claims = useMemo(() => eligible.data ?? [], [eligible.data]);

  const claimedReads = useReadContracts({
    contracts: claims.map((c) => ({
      address: addresses.distributor,
      abi: distributorAbi,
      functionName: "isClaimed" as const,
      args: [BigInt(c.actionId), BigInt(c.index)] as const,
    })),
    query: { enabled: claims.length > 0 && Boolean(addresses.distributor) },
  });

  const { claimable, history } = useMemo(() => {
    const claimable: EligibleClaim[] = [];
    const history: EligibleClaim[] = [];
    claims.forEach((c, i) => {
      const done = claimedReads.data?.[i]?.result === true;
      (done ? history : claimable).push(c);
    });
    return { claimable, history };
  }, [claims, claimedReads.data]);

  const refetchAll = () => {
    eligible.refetch();
    claimedReads.refetch();
    feed.refetch();
  };

  // ---- Not connected -------------------------------------------------------
  if (!isConnected) {
    return (
      <Card className="relative overflow-hidden p-10 text-center">
        <Kicker>Step one</Kicker>
        <h2 className="display mt-3 text-3xl text-ink">See what you’re owed.</h2>
        <p className="mx-auto mt-2 max-w-md text-ink-soft">
          Connect to check the dividends waiting for the tokenized stocks you hold. No seed phrase needed to look.
        </p>
        <div className="mt-7 flex justify-center">
          <WalletButton />
        </div>
        {/* Greeked ledger preview — the columns connecting reveals. */}
        <div className="mx-auto mt-10 max-w-xl select-none text-left blur-[1.5px]" aria-hidden>
          <TableShell head={["Asset", "Held at record block", "Rate / share", "Dividend", ""]}>
            {[
              ["MSFT", "25 MSFT", "0.75 USDG/sh", "18.75 USDG"],
              ["AAPL", "37 AAPL", "0.26 USDG/sh", "9.62 USDG"],
              ["NVDA", "40 NVDA", "0.01 USDG/sh", "0.40 USDG"],
            ].map(([sym, h, r, d]) => (
              <tr key={sym} className="opacity-60">
                <Td><span className="font-medium text-ink">{sym}</span></Td>
                <Td className="tabular text-ink-soft">{h}</Td>
                <Td className="tabular text-ink-faint">{r}</Td>
                <Td className="tabular text-right font-medium text-money">{d}</Td>
                <Td />
              </tr>
            ))}
          </TableShell>
        </div>
        <p className="fine mt-3">Illustrative — connect to check your position.</p>
      </Card>
    );
  }

  const loading = feed.isLoading || eligible.isLoading;
  const errored = feed.isError || eligible.isError;

  return (
    <div className="space-y-10">
      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <Kicker>Ready to claim</Kicker>
            <h2 className="display mt-2 text-3xl text-ink">Your dividends</h2>
          </div>
          <button onClick={refetchAll} className="text-sm text-ink-soft transition hover:text-ink">
            Refresh
          </button>
        </div>

        {loading && <div className="skeleton h-40 rounded-lg" />}

        {errored && !loading && (
          <Card className="border-danger/30 p-6">
            <p className="text-sm text-danger">We couldn&apos;t reach the network. Please try again.</p>
            <Button variant="outline" className="mt-3" onClick={refetchAll}>
              Retry
            </Button>
          </Card>
        )}

        {!loading && !errored && claimable.length === 0 && (
          <EmptyState
            title="Nothing to claim right now"
            body="When a dividend is declared for a token you held at its record block, it appears here — your snapshot balance and the amount you can claim, side by side."
            action={{ href: "/feed", label: "Browse all corporate actions" }}
          />
        )}

        {!loading && claimable.length > 0 && (
          <TableShell head={["Asset", "Held at record block", "Rate / share", "Dividend", ""]}>
            {claimable.map((c) => (
              <ClaimRow key={`${c.actionId}-${c.index}`} claim={c} onClaimed={refetchAll} />
            ))}
          </TableShell>
        )}
      </section>

      {history.length > 0 && (
        <section>
          <Kicker>History</Kicker>
          <h2 className="display mt-2 mb-4 text-2xl text-ink">Claimed</h2>
          <TableShell head={["Asset", "Held at record block", "Claimed", ""]}>
            {history.map((c) => (
              <HistoryRow key={`${c.actionId}-${c.index}`} claim={c} />
            ))}
          </TableShell>
        </section>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- table bits */
function TableShell({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface-raised">
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[0.68rem] uppercase tracking-wider text-ink-faint">
            {head.map((h, i) => (
              <th
                key={i}
                className={`px-4 py-3 font-medium ${i === 3 || (head.length === 4 && i === 2) ? "text-right" : ""}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={`px-4 py-3.5 align-middle ${className}`}>{children}</td>;
}

function AssetCell({ symbol, sub }: { symbol: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <StockLogo symbol={symbol} size={28} />
      <div className="min-w-0">
        <p className="font-medium text-ink">{symbol}</p>
        {sub && <p className="text-[0.7rem] text-ink-faint">{sub}</p>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- HistoryRow */
function HistoryRow({ claim }: { claim: EligibleClaim }) {
  // Recover the on-chain Claimed tx so "Paid" links to its explorer receipt.
  const tx = useQuery({
    queryKey: ["claim-tx", claim.actionId, claim.account],
    queryFn: async (): Promise<`0x${string}` | null> => {
      const res = await fetch(`/api/claim-tx?actionId=${claim.actionId}&account=${claim.account}`, { cache: "no-store" });
      if (!res.ok) return null;
      const d = (await res.json()) as { found?: boolean; txHash?: `0x${string}` };
      return d.found && d.txHash ? d.txHash : null;
    },
    staleTime: 5 * 60_000,
  });

  const badge = (
    <span className="inline-flex items-center gap-1 rounded-full bg-money-wash px-2.5 py-1 text-xs font-medium text-money">
      ✓ Paid{tx.data ? " ↗" : ""}
    </span>
  );

  return (
    <tr className="text-sm">
      <Td>
        <AssetCell symbol={claim.assetSymbol} sub={`Action #${claim.actionId}`} />
      </Td>
      <Td className="tabular text-ink-soft">{held(claim)}</Td>
      <Td className="tabular text-right font-medium text-ink">{dividend(claim)}</Td>
      <Td className="text-right">
        {tx.data ? (
          <a href={explorerTxUrl(tx.data)} target="_blank" rel="noreferrer" title="View claim receipt" className="transition hover:opacity-80">
            {badge}
          </a>
        ) : (
          badge
        )}
      </Td>
    </tr>
  );
}

/* ---------------------------------------------------------------- ClaimRow */
type Phase = "idle" | "submitting" | "confirming" | "done" | "error";

function ClaimRow({ claim, onClaimed }: { claim: EligibleClaim; onClaimed: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<string>();
  const { writeContractAsync } = useWriteContract();

  // Only show success once the claim tx is actually mined and did NOT revert.
  const receipt = useWaitForTransactionReceipt({ hash, query: { enabled: Boolean(hash) } });
  useEffect(() => {
    if (!hash) return;
    if (receipt.isSuccess && receipt.data?.status === "success") {
      setPhase("done");
      const t = setTimeout(onClaimed, 1200);
      return () => clearTimeout(t);
    }
    if (receipt.isError || receipt.data?.status === "reverted") {
      setError("Reverted on-chain");
      setPhase("error");
    }
  }, [hash, receipt.isSuccess, receipt.isError, receipt.data?.status, onClaimed]);

  async function onClaim() {
    setError(undefined);
    try {
      setPhase("submitting");
      let tx: `0x${string}`;
      if (gaslessEnabled) {
        tx = (await relayClaim(claim)).txHash;
      } else {
        tx = await writeContractAsync({
          address: addresses.distributor!,
          abi: distributorAbi,
          functionName: "claim",
          args: [BigInt(claim.actionId), BigInt(claim.index), claim.account, BigInt(claim.amountWei), claim.proof],
        });
      }
      setHash(tx);
      setPhase("confirming");
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "Claim failed");
      setPhase("error");
    }
  }

  const busy = phase === "submitting" || phase === "confirming";

  return (
    <tr className="text-sm transition hover:bg-surface-inset">
      <Td>
        <AssetCell symbol={claim.assetSymbol} sub={`Action #${claim.actionId}`} />
      </Td>
      <Td className="tabular font-medium text-ink">{held(claim)}</Td>
      <Td className="tabular text-ink-soft">{rate(claim)}</Td>
      <Td className="tabular text-right text-base font-semibold text-money">{dividend(claim)}</Td>
      <Td className="text-right">
        {phase === "done" ? (
          <div className="flex items-center justify-end gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-money-wash px-2.5 py-1 text-xs font-medium text-money">
              ✓ Paid
            </span>
            {hash && (
              <a href={explorerTxUrl(hash)} target="_blank" rel="noreferrer" className="text-ink-faint hover:text-ink" title="View receipt">
                ↗
              </a>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={onClaim}
              disabled={busy}
              className="inline-flex min-h-0 items-center justify-center gap-1.5 rounded-md bg-ink px-4 py-2 text-xs font-semibold text-on-ink transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-55"
            >
              {busy && <Spinner className="h-3 w-3" />}
              {busy ? "Claiming…" : gaslessEnabled ? "Claim · no gas" : "Claim"}
            </button>
            {phase === "error" && error && <span className="text-[0.7rem] text-danger">{error}</span>}
          </div>
        )}
      </Td>
    </tr>
  );
}
