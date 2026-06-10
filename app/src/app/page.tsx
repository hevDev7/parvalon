import Link from "next/link";
import { Button, Card, Kicker } from "@/components/ui";

export default function Home() {
  return (
    <div>
      {/* ───────────────────────────── Hero ───────────────────────────── */}
      <section className="paper-grain guilloche relative overflow-hidden border-b border-line">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:py-28">
          <div className="relative">
            <Kicker className="animate-rise">Corporate-actions infrastructure · Robinhood Chain</Kicker>
            <h1
              className="display mt-5 text-[clamp(2.8rem,7vw,5.2rem)] text-ink animate-rise"
              style={{ animationDelay: "60ms" }}
            >
              Tokenized stocks
              <br />
              can finally pay
              <br />
              <span className="relative text-viridian">
                dividends
                <svg className="absolute -bottom-2 left-0 w-full" height="10" viewBox="0 0 300 10" preserveAspectRatio="none" aria-hidden>
                  <path d="M0 6 Q 75 0 150 5 T 300 4" stroke="var(--brass-soft)" strokeWidth="2" fill="none" />
                </svg>
              </span>
              .
            </h1>
            <p
              className="mt-7 max-w-xl text-lg leading-relaxed text-ink-soft animate-rise"
              style={{ animationDelay: "120ms" }}
            >
              Tokenization solved issuance and trading. The entire <em>post-issuance lifecycle</em> — dividends,
              splits, record dates — was still stuck off-chain. CorporaX is the operations layer that fixes it,
              working on the tokens that already exist. No token changes. No issuer integration required.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3 animate-rise" style={{ animationDelay: "180ms" }}>
              <Link href="/claim">
                <Button variant="primary">Claim a dividend →</Button>
              </Link>
              <Link href="/feed">
                <Button variant="outline">Explore the feed</Button>
              </Link>
            </div>
          </div>

          {/* Certificate motif */}
          <div className="relative hidden lg:block">
            <DividendCertificate />
          </div>
        </div>

        {/* Stat strip */}
        <div className="border-t border-line bg-paper-panel/50">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 divide-x divide-line px-5 sm:px-8 md:grid-cols-4">
            {[
              ["~1,997", "tokenized stocks on Arbitrum"],
              ["0 → 1", "on-chain dividend rails"],
              ["2", "immutable, audited-by-design contracts"],
              ["~82k gas", "per holder claim"],
            ].map(([stat, label], i) => (
              <div key={i} className="px-5 py-6 first:pl-0">
                <dt className="display text-3xl text-ink">{stat}</dt>
                <dd className="mt-1 text-[0.8rem] leading-snug text-ink-faint">{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ─────────────────────────── The gap ──────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <Kicker>Who this is broken for today</Kicker>
        <h2 className="display mt-3 max-w-2xl text-4xl text-ink">
          A dividend is declared. On-chain, nothing happens.
        </h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {[
            {
              who: "Holders",
              pain: "Hold a tokenized share, and there is no record date, no claim, no proof of distribution. Your dividend simply never arrives.",
            },
            {
              who: "DeFi protocols",
              pain: "Lending markets and AMMs using tokenized stock as collateral are blind to splits and ex-dividend dates — a real, systemic mispricing risk.",
            },
            {
              who: "AI agents",
              pain: "The on-chain agent economy has no machine-readable corporate-action data to react to. Dividend-aware strategies are impossible.",
            },
          ].map((c) => (
            <Card key={c.who} className="p-6">
              <h3 className="display text-2xl text-ink">{c.who}</h3>
              <p className="mt-3 text-sm leading-relaxed text-ink-soft">{c.pain}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* ───────────────────────── How it works ───────────────────────── */}
      <section className="border-y border-line bg-paper-deep/40">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <Kicker>One clean cycle, end to end</Kicker>
          <h2 className="display mt-3 text-4xl text-ink">From announcement to a holder&apos;s wallet.</h2>
          <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-4">
            {[
              ["01", "Announce", "The issuer records the action on-chain with correct record-date semantics."],
              ["02", "Snapshot", "Anyone re-runs the snapshot from Transfer logs and verifies the Merkle root."],
              ["03", "Fund", "The issuer funds the pool in USDG. The action turns claimable."],
              ["04", "Claim", "Holders claim pro-rata — gaslessly — straight to their wallet."],
            ].map(([n, title, body]) => (
              <li key={n} className="bg-paper-panel p-6">
                <span className="tabular text-sm text-brass">{n}</span>
                <h3 className="display mt-2 text-2xl text-ink">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ─────────────────────── Permissionless ───────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <Kicker>The unlock</Kicker>
            <h2 className="display mt-3 text-4xl text-ink">
              It works on tokens we don&apos;t control.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-ink-soft">
              Most approaches need the issuer to adopt a new token standard. CorporaX needs nothing. It reconstructs
              holder balances at a record block from public Transfer logs and distributes against a Merkle snapshot.
              Permissionless, deterministic, auditable — the transparency a traditional transfer agent could never offer.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-ink">
              {[
                "No transfer hooks, no rebasing, no token migration.",
                "Record-date semantics that map 1:1 to how dividends really work.",
                "Claim-on-behalf: gasless relays and AI agents, with zero custody risk.",
              ].map((p) => (
                <li key={p} className="flex gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-viridian" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <Card className="p-7">
            <Kicker>For developers</Kicker>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-ink p-4 text-[0.8rem] leading-relaxed text-paper-panel">
              <code>{`$ curl /api/actions

{
  "schema": "CAE-1",
  "actions": [{
    "id": 1,
    "assetSymbol": "TSLA",
    "actionType": "CASH_DIVIDEND",
    "status": "CLAIMABLE",
    "ratePerShare": "0.5",
    "totalPayout": "12.0"
  }]
}`}</code>
            </pre>
            <p className="mt-4 text-sm text-ink-soft">
              A standard event schema — <span className="font-semibold text-ink">CAE-1</span> — so protocols and agents
              can finally subscribe to corporate actions.
            </p>
          </Card>
        </div>
      </section>
    </div>
  );
}

/* Decorative dividend certificate used in the hero. */
function DividendCertificate() {
  return (
    <div className="relative mx-auto max-w-sm rotate-1">
      <div className="paper-grain relative overflow-hidden rounded-2xl border border-brass-soft bg-paper-panel p-7 shadow-certificate">
        <div className="flex items-center justify-between">
          <span className="kicker">Cash dividend</span>
          <span className="grid h-9 w-9 place-items-center rounded-full border border-brass text-brass">
            <span className="display text-lg">✓</span>
          </span>
        </div>
        <p className="mt-6 text-sm text-ink-faint">Payable to the holder of</p>
        <p className="display text-4xl text-ink">TSLA</p>
        <div className="rule-brass my-5" />
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[0.72rem] text-ink-faint">Amount</p>
            <p className="tabular text-2xl text-viridian">12.50 USDG</p>
          </div>
          <div className="text-right">
            <p className="text-[0.72rem] text-ink-faint">Record block</p>
            <p className="tabular text-sm text-ink">#8,041,233</p>
          </div>
        </div>
        <div className="mt-6 flex items-center gap-2">
          <div className="h-px flex-1 bg-line" />
          <span className="kicker">Verified on-chain</span>
          <div className="h-px flex-1 bg-line" />
        </div>
      </div>
      <div className="absolute -right-3 -top-3 -z-10 h-full w-full rounded-2xl border border-line bg-paper-deep" />
    </div>
  );
}
