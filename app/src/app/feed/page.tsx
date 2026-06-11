import { explorerAddressUrl } from "@/lib/chain";
import { isConfigured } from "@/lib/contracts";
import { readActions } from "@/lib/actions";
import { fmtAmount, fmtDate } from "@/lib/format";
import type { ActionView } from "@/lib/types";
import { Card, EmptyState, Kicker, Money, StatusBadge } from "@/components/ui";

export const metadata = { title: "Feed · CorporaX" };
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
    <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
      <header className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Kicker>For integrators · CAE-1</Kicker>
          <h1 className="display mt-3 text-[clamp(2.4rem,5vw,3.6rem)] text-ink">The corporate-action feed.</h1>
          <p className="mt-3 max-w-xl text-ink-soft">
            Every announcement, snapshot, funding and claim — as a standard event stream and a JSON endpoint. So
            lending markets, AMMs and AI agents can finally react to corporate actions.
          </p>
        </div>
        <a
          href="/api/actions"
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-2 rounded-full border border-line-strong bg-surface-raised px-4 py-2 text-sm font-medium text-ink transition hover:border-lime hover:text-lime"
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
        <Card className="border-danger/30 p-6">
          <p className="text-sm text-danger">Couldn&apos;t read the chain: {error}</p>
        </Card>
      ) : actions.length === 0 ? (
        <EmptyState
          title="No corporate actions yet"
          body="Once an issuer announces a dividend or split, it shows up here in real time."
          action={{ href: "/issuer", label: "Open the issuer console" }}
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[0.72rem] uppercase tracking-wider text-ink-faint">
                  <th className="px-5 py-3 font-medium">#</th>
                  <th className="px-5 py-3 font-medium">Asset</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Rate / share</th>
                  <th className="px-5 py-3 text-right font-medium">Total · claimed</th>
                  <th className="px-5 py-3 font-medium">Payable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {actions.map((a) => (
                  <tr key={a.id} className="transition hover:bg-surface-inset/40">
                    <td className="px-5 py-4 tabular text-ink-faint">{a.id}</td>
                    <td className="px-5 py-4">
                      <a
                        href={explorerAddressUrl(a.asset)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-ink underline-offset-2 hover:text-lime hover:underline"
                      >
                        {a.assetSymbol}
                      </a>
                    </td>
                    <td className="px-5 py-4 text-ink-soft">{a.actionType.replace("_", " ").toLowerCase()}</td>
                    <td className="px-5 py-4">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="px-5 py-4 text-right">
                      {a.actionType === "CASH_DIVIDEND" ? (
                        <Money wei={a.ratePerShareWei} symbol={a.payoutSymbol} />
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-right tabular">
                      {a.actionType === "CASH_DIVIDEND" ? (
                        <span>
                          {fmtAmount(a.totalPayoutWei)} <span className="text-ink-faint">·</span>{" "}
                          <span className="text-lime">{fmtAmount(a.totalClaimedWei)}</span>
                        </span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-ink-soft">{a.payableAt ? fmtDate(a.payableAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Developer block */}
      <section className="mt-12 grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <Kicker>Subscribe to events</Kicker>
          <pre className="mt-3 overflow-x-auto rounded-xl border border-line bg-black/40 p-4 text-[0.78rem] leading-relaxed text-lime">
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
        <Card className="p-6">
          <Kicker>Read the feed</Kicker>
          <pre className="mt-3 overflow-x-auto rounded-xl border border-line bg-black/40 p-4 text-[0.78rem] leading-relaxed text-lime">
            <code>{`$ curl https://corporax.xyz/api/actions

{
  "schema": "CAE-1",
  "chainId": ${process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337},
  "actions": [ { "id": 1, "assetSymbol": "TSLA",
    "status": "CLAIMABLE", "totalPayout": "12.0" } ]
}`}</code>
          </pre>
          <p className="mt-4 text-sm text-ink-soft">
            See <span className="font-medium text-ink">docs/CAE-1.md</span> for the full draft standard.
          </p>
        </Card>
      </section>
    </div>
  );
}
