import { explorerAddressUrl } from "@/lib/chain";
import { isConfigured } from "@/lib/contracts";
import { readActions } from "@/lib/actions";
import { fmtAmount, fmtDate } from "@/lib/format";
import { tokenDecimals } from "@/lib/tokens";
import type { ActionView } from "@/lib/types";
import { Card, EmptyState, Kicker, Money, StatusBadge } from "@/components/ui";
import { DappShell } from "@/components/DappShell";

export const metadata = { title: "Feed · Parvalon" };
export const dynamic = "force-dynamic";

export default async function FeedPage() {
  let actions: ActionView[] = [];
  let error: string | null = null;
  if (isConfigured) {
    try {
      actions = await readActions();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to read on-chain actions";
    }
  }

  return (
    <DappShell title="CAE-1 Event Feed">
      <header className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-black/40 flex items-center">
            <span className="w-5 h-px bg-current mr-3 opacity-60" />
            For integrators · CAE-1
          </p>
          <h2 className="display text-3xl mt-3 text-primary">The corporate-action feed.</h2>
          <p className="mt-2 max-w-xl text-black/60">
            Every announcement, snapshot, funding and claim — as a standard event stream and a JSON endpoint, so lending
            markets, AMMs and AI agents can react to corporate actions.
          </p>
        </div>
        <a
          href="/api/actions"
          target="_blank"
          rel="noreferrer"
          className="tabular inline-flex w-fit items-center gap-2 rounded-lg border border-border-subtle bg-surface-card px-4 py-2.5 text-sm font-semibold text-primary transition hover:border-black/20 hover:shadow-sm"
        >
          GET /api/actions ↗
        </a>
      </header>

      {!isConfigured ? (
        <EmptyState
          title="No deployment configured"
          body="Set NEXT_PUBLIC_REGISTRY_ADDRESS and NEXT_PUBLIC_DISTRIBUTOR_ADDRESS (or run a local anvil + deploy)."
        />
      ) : error ? (
        <div className="rounded-2xl border border-accent-red/30 bg-accent-red/5 p-6">
          <p className="text-sm text-accent-red">Couldn&apos;t read the chain: {error}</p>
        </div>
      ) : actions.length === 0 ? (
        <EmptyState
          title="No corporate actions yet"
          body="Once an issuer announces a dividend or split, it shows up here in real time."
          action={{ href: "/issuer", label: "Open the issuer console" }}
        />
      ) : (
        <div className="bg-surface-card border border-border-subtle rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-[0.72rem] uppercase tracking-wider text-black/40">
                  <th className="px-5 py-3 font-medium">#</th>
                  <th className="px-5 py-3 font-medium">Asset</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Rate / share</th>
                  <th className="px-5 py-3 text-right font-medium">Total · claimed</th>
                  <th className="px-5 py-3 font-medium">Payable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {actions.map((a) => (
                  <tr key={a.id} className="transition hover:bg-black/[0.02]">
                    <td className="px-5 py-4 tabular text-black/40">{a.id}</td>
                    <td className="px-5 py-4">
                      <a
                        href={explorerAddressUrl(a.asset)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-primary underline-offset-2 hover:text-accent-blue hover:underline"
                      >
                        {a.assetSymbol}
                      </a>
                    </td>
                    <td className="px-5 py-4 text-black/60">{a.actionType.replace("_", " ").toLowerCase()}</td>
                    <td className="px-5 py-4">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="px-5 py-4 text-right">
                      {a.actionType === "CASH_DIVIDEND" ? (
                        <Money wei={a.ratePerShareWei} symbol={a.payoutSymbol} />
                      ) : (
                        <span className="text-black/30">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right tabular">
                      {a.actionType === "CASH_DIVIDEND" ? (
                        <span>
                          {fmtAmount(a.totalPayoutWei, tokenDecimals(a.payoutToken))} <span className="text-black/30">·</span>{" "}
                          <span className="text-money">{fmtAmount(a.totalClaimedWei, tokenDecimals(a.payoutToken))}</span>
                        </span>
                      ) : (
                        <span className="text-black/30">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-black/60">{a.payableAt ? fmtDate(a.payableAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Developer block */}
      <section className="mt-12 grid gap-6 lg:grid-cols-2">
        <Card className="!rounded-2xl !border-border-subtle p-6">
          <Kicker>Subscribe to events</Kicker>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-inverse-surface p-4 text-[0.78rem] leading-relaxed text-white/80">
            <code>{`// CAE-1 — Corporate Action Events
ActionAnnounced(id, asset, actionType,
  ratePerShare, recordBlock, payableAt,
  claimDeadline, payoutToken, metadataURI)
MerkleRootPublished(id, root, totalPayout, holderCount)
ActionStatusChanged(id, prev, next)
Funded(id, from, amount, totalFunded)
Claimed(id, index, account, amount)`}</code>
          </pre>
        </Card>
        <Card className="!rounded-2xl !border-border-subtle p-6">
          <Kicker>Read the feed</Kicker>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-inverse-surface p-4 text-[0.78rem] leading-relaxed text-white/80">
            <code>{`$ curl https://parvalon.xyz/api/actions

{
  "schema": "CAE-1",
  "chainId": ${process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337},
  "actions": [ { "id": 1, "assetSymbol": "TSLA",
    "status": "CLAIMABLE", "totalPayout": "12.0" } ]
}`}</code>
          </pre>
          <p className="mt-4 text-sm text-black/60">
            See <span className="font-semibold text-primary">docs/CAE-1.md</span> for the full draft standard.
          </p>
        </Card>
      </section>
    </DappShell>
  );
}
