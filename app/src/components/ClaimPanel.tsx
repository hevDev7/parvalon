"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useAccount, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { addresses, distributorAbi } from "@/lib/contracts";
import { explorerTxUrl } from "@/lib/chain";
import { fmtAmount } from "@/lib/format";
import { getEligibleClaims } from "@/lib/proofs";
import { gaslessEnabled, relayClaim } from "@/lib/relay";
import type { ActionLike, EligibleClaim } from "@/lib/types";
import { Button, Card, EmptyState, Kicker, Spinner } from "@/components/ui";
import { WalletButton } from "@/components/WalletButton";

interface FeedAction {
  id: number;
  actionType: ActionLike["actionType"];
  status: ActionLike["status"];
  payoutToken: `0x${string}`;
  payoutSymbol: string;
  assetSymbol: string;
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
    assetSymbol: a.assetSymbol,
    metadataURI: a.metadataURI,
  }));
}

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

  // ---- States --------------------------------------------------------------
  if (!isConnected) {
    return (
      <Card className="relative p-10 text-center">
        <Kicker>Step one</Kicker>
        <h2 className="display mt-3 text-3xl text-ink">See what you&apos;re owed.</h2>
        <p className="mx-auto mt-2 max-w-md text-ink-soft">
          Connect to check the dividends waiting for the tokenized stocks you hold. No seed phrase needed to look.
        </p>
        <div className="mt-7 flex justify-center">
          <WalletButton />
        </div>
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

        {loading && <ClaimSkeletons />}

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
            body="When a dividend is declared for a token you hold, it will appear here, ready in one tap."
            action={{ href: "/feed", label: "Browse all corporate actions" }}
          />
        )}

        {!loading && claimable.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2">
            {claimable.map((c) => (
              <ClaimCard key={`${c.actionId}-${c.index}`} claim={c} onClaimed={refetchAll} />
            ))}
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section>
          <Kicker>History</Kicker>
          <h2 className="display mt-2 mb-4 text-2xl text-ink">Claimed</h2>
          <Card className="divide-y divide-line">
            {history.map((c) => (
              <div key={`${c.actionId}-${c.index}`} className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-lime-wash text-lime">✓</span>
                  <div>
                    <p className="font-medium text-ink">{c.assetSymbol} dividend</p>
                    <p className="text-[0.78rem] text-ink-faint">Action #{c.actionId}</p>
                  </div>
                </div>
                <span className="tabular text-ink">
                  {fmtAmount(c.amountWei)} <span className="text-ink-faint">{c.payoutSymbol}</span>
                </span>
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- ClaimCard */
type Phase = "idle" | "submitting" | "confirming" | "done" | "error";

function ClaimCard({ claim, onClaimed }: { claim: EligibleClaim; onClaimed: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<string>();
  const { writeContractAsync } = useWriteContract();

  useWaitForTransactionReceipt({
    hash,
    query: { enabled: Boolean(hash) },
  });

  async function onClaim() {
    setError(undefined);
    try {
      setPhase("submitting");
      let tx: `0x${string}`;
      if (gaslessEnabled) {
        const res = await relayClaim(claim);
        tx = res.txHash;
      } else {
        tx = await writeContractAsync({
          address: addresses.distributor!,
          abi: distributorAbi,
          functionName: "claim",
          args: [BigInt(claim.actionId), BigInt(claim.index), claim.account, BigInt(claim.amountWei), claim.proof],
        });
      }
      setHash(tx);
      setPhase("done");
      setTimeout(onClaimed, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "Claim failed");
      setPhase("error");
    }
  }

  const busy = phase === "submitting" || phase === "confirming";

  return (
    <Card className="relative overflow-hidden border-lime/25 p-6 transition hover:border-lime/40">
      <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-lime/10 blur-2xl" aria-hidden />
      <div className="relative flex items-start justify-between">
        <div>
          <Kicker>{claim.assetSymbol} · cash_dividend</Kicker>
          <p className="display mt-3 text-2xl text-ink">Your dividend is ready</p>
        </div>
        {phase === "done" ? (
          <span className="grid h-11 w-11 animate-seal place-items-center rounded-full bg-lime text-surface shadow-glow">
            <span className="display text-xl">✓</span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 rounded-full border border-lime/30 bg-lime-wash px-2.5 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-lime-bright animate-pulse-glow" />
            <span className="kicker text-lime">claimable</span>
          </span>
        )}
      </div>

      <div className="relative mt-5 flex items-end gap-1.5">
        <span className="tabular text-[2.6rem] font-medium leading-none text-lime">{fmtAmount(claim.amountWei)}</span>
        <span className="mb-1 text-sm text-ink-faint">{claim.payoutSymbol}</span>
      </div>

      <div className="mt-6">
        {phase === "done" ? (
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-lime">Sent to your wallet</span>
            {hash && (
              <a
                href={explorerTxUrl(hash)}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-ink-soft underline-offset-2 hover:text-ink hover:underline"
              >
                View receipt ↗
              </a>
            )}
          </div>
        ) : (
          <Button variant="primary" className="w-full shadow-glow" onClick={onClaim} loading={busy} disabled={busy}>
            {busy ? "Claiming…" : gaslessEnabled ? "Claim — no gas needed" : "Claim"}
          </Button>
        )}
        {phase === "error" && error && <p className="mt-3 text-sm text-danger">{error}</p>}
        {gaslessEnabled && phase === "idle" && (
          <p className="mt-3 text-center text-[0.72rem] text-ink-faint">We cover the network fee for you.</p>
        )}
      </div>
    </Card>
  );
}

function ClaimSkeletons() {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {[0, 1].map((i) => (
        <div key={i} className="skeleton h-44 rounded-2xl" />
      ))}
    </div>
  );
}
