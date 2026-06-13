import Link from "next/link";
import { Button, Card, Kicker } from "@/components/ui";
import { Guilloche, GuillocheSeal } from "@/components/Guilloche";

export default function Home() {
  return (
    <div>
      {/* ───────────────────────────── Hero ───────────────────────────── */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="mx-auto grid max-w-6xl gap-14 px-5 pb-16 pt-14 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:pb-14 lg:pt-16">
          <div className="relative max-w-xl">
            <Kicker className="animate-rise">Corporate-actions infrastructure · Robinhood Chain</Kicker>
            <h1
              className="display mt-6 text-[clamp(2.9rem,6.5vw,4.9rem)] text-ink animate-rise"
              style={{ animationDelay: "40ms" }}
            >
              Tokenized stocks now pay <em>dividends</em>.
            </h1>
            <p
              className="mt-7 max-w-[33rem] text-[1.05rem] leading-relaxed text-ink-soft animate-rise"
              style={{ animationDelay: "80ms" }}
            >
              Tokenization solved issuance and trading. Everything after — record dates, snapshots, distributions —
              still settles off-chain, when it settles at all. CorporaX operates that lifecycle on the tokens that
              already exist. Issuers deploy nothing.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3 animate-rise" style={{ animationDelay: "120ms" }}>
              <Link href="/claim">
                <Button variant="primary">Claim a dividend</Button>
              </Link>
              <Link
                href="/feed"
                className="px-2 py-2.5 text-sm font-semibold text-brand transition hover:text-brand-deep"
              >
                Explore the feed →
              </Link>
            </div>
          </div>

          {/* Distribution notice — the product's atomic unit, as a document. */}
          <div className="relative">
            <Guilloche className="pointer-events-none absolute -right-36 -top-24 hidden h-[620px] w-[620px] lg:block" />
            <DistributionNotice />
          </div>
        </div>

        {/* Fact band — dated, footnoted figures. */}
        <div className="border-t border-line bg-surface-raised">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <dl className="grid grid-cols-2 md:grid-cols-4 md:divide-x md:divide-line">
              {[
                ["1,997", "tokenized equities listed on Robinhood Chain", "1"],
                ["~82,000", "gas per holder claim", "2"],
                ["4", "transactions from announcement to claimable", ""],
                ["5", "event types in the CAE-1 standard", "3"],
              ].map(([stat, label, note], i) => (
                <div
                  key={i}
                  className="px-5 py-8 max-md:odd:pl-0 max-md:[&:nth-child(n+3)]:border-t max-md:[&:nth-child(n+3)]:border-line md:first:pl-0 md:[&:nth-child(n+2)]:pl-6"
                >
                  <dt className="tabular text-[2.35rem] font-medium leading-none tracking-tight text-ink">
                    {stat}
                    {note && <sup className="ml-0.5 text-sm font-normal text-brand">{note}</sup>}
                  </dt>
                  <dd className="mt-2 text-[0.82rem] leading-snug text-ink-soft">{label}</dd>
                </div>
              ))}
            </dl>
            <p className="fine border-t border-line py-3.5">
              Figures as of June 2026 · see{" "}
              <a href="#notes" className="underline decoration-line-strong underline-offset-2 hover:text-ink-soft">
                notes &amp; methodology
              </a>
            </p>
          </div>
        </div>
      </section>

      {/* ─────────────────────────── 01 · Background ───────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-24">
        <Kicker>01 — Background</Kicker>
        <h2 className="display mt-4 max-w-2xl text-[clamp(2.05rem,3.9vw,2.9rem)] text-ink">
          A dividend is declared. On-chain, <em>nothing happens</em>.
        </h2>
        <div className="mt-12 grid gap-x-10 gap-y-10 md:grid-cols-3">
          {[
            {
              who: "Holders",
              pain: "Hold a tokenized share through a record date and nothing arrives — and nothing on-chain proves a distribution ever happened.",
            },
            {
              who: "DeFi protocols",
              pain: "Lending markets and AMMs price tokenized stock as collateral while blind to splits and ex-dividend dates. A quiet, systemic mispricing.",
            },
            {
              who: "AI agents",
              pain: "The agent economy has no machine-readable corporate-action data to act on. A dividend-aware strategy cannot exist without it.",
            },
          ].map((row) => (
            <div key={row.who} className="border-t-2 border-ink pt-5">
              <h3 className="kicker !text-ink">{row.who}</h3>
              <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-soft">{row.pain}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ──────────────── 02 · Mechanics of a distribution ─────────────── */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-24">
          <Kicker>02 — Mechanics of a distribution</Kicker>
          <h2 className="display mt-4 max-w-2xl text-[clamp(2.05rem,3.9vw,2.9rem)] text-ink">
            From announcement to a holder’s wallet.
          </h2>
          <ol className="relative mt-14 grid gap-y-12 md:grid-cols-4 md:gap-x-8 md:gap-y-0">
            {/* rail */}
            <div
              className="absolute left-[5px] top-1 h-[calc(100%-0.5rem)] w-px bg-line-strong md:left-0 md:top-[5px] md:h-px md:w-full"
              aria-hidden
            />
            {[
              {
                title: "Announce",
                body: "The issuer records the action on-chain, with record-date semantics that match how dividends are actually declared.",
                event: "ActionAnnounced(id, asset, …)",
              },
              {
                title: "Snapshot",
                body: "Anyone reconstructs holder balances at the record block from public Transfer logs and verifies the Merkle root.",
                event: "MerkleRootPublished(id, root, …)",
              },
              {
                title: "Fund",
                body: "The issuer deposits the full payout in USDG. The action turns claimable the moment it is funded.",
                event: "Funded(id, from, amount, …)",
              },
              {
                title: "Claim",
                body: "Holders claim pro-rata — gaslessly, or through an agent acting on their behalf — straight to their wallet.",
                event: "Claimed(id, index, account, …)",
              },
            ].map((step, i) => (
              <li key={step.title} className="relative pl-7 md:pl-0 md:pt-8">
                <span
                  className="absolute left-0 top-1 h-[11px] w-[11px] rounded-full border-2 border-brand bg-surface md:top-0"
                  aria-hidden
                />
                <p className="tabular text-xs text-ink-faint">{`0${i + 1}`}</p>
                <h3 className="display mt-1.5 text-2xl text-ink">{step.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-ink-soft">{step.body}</p>
                <code className="tabular mt-4 inline-block rounded border border-line bg-surface-raised px-2 py-1 text-[0.7rem] text-ink-soft">
                  {step.event}
                </code>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ─────────────── 03 · Why no integration is required ───────────── */}
      <section className="border-t border-line">
        <div className="mx-auto grid max-w-6xl items-start gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:py-24">
          <div>
            <Kicker>03 — Why no integration is required</Kicker>
            <h2 className="display mt-4 text-[clamp(2.05rem,3.9vw,2.9rem)] text-ink">
              It works on tokens we don’t control.
            </h2>
            <p className="mt-6 max-w-xl text-[0.95rem] leading-relaxed text-ink-soft">
              Most designs ask the issuer to adopt a new token standard. CorporaX asks for nothing. It reconstructs
              holder balances at a record block from public Transfer logs and distributes against a Merkle snapshot —
              permissionless, deterministic, and auditable in a way a traditional transfer agent could never be.
            </p>
            <ul className="mt-8 max-w-xl divide-y divide-line border-y border-line text-sm text-ink">
              {[
                "No transfer hooks, no rebasing, no token migration.",
                "Record-date semantics that map one-to-one to how dividends are declared.",
                "Claim-on-behalf for gasless relays and AI agents, with zero custody risk.",
              ].map((p) => (
                <li key={p} className="py-3.5 leading-relaxed">
                  {p}
                </li>
              ))}
            </ul>
          </div>

          {/* Key facts — fund fact-sheet style. */}
          <Card className="p-7">
            <Kicker>Key facts</Kicker>
            <dl className="mt-4 divide-y divide-line text-sm">
              {(
                [
                  ["Standard", "CAE-1 (draft)", true],
                  ["Settlement asset", "USDG", true],
                  ["Snapshot method", "Merkle root, Transfer logs", false],
                  ["Contracts", "2 · immutable", true],
                  ["Distribution", "Pro-rata, claim or claim-on-behalf", false],
                  ["Gas per claim", "~82,000", true],
                  ["License", "MIT", true],
                ] as [string, string, boolean][]
              ).map(([dt, dd, mono]) => (
                <div key={dt} className="grid grid-cols-[8.5rem_1fr] items-baseline gap-6 py-3">
                  <dt className="text-ink-faint">{dt}</dt>
                  <dd className={`text-right font-medium leading-snug text-ink ${mono ? "tabular" : ""}`}>{dd}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </section>

      {/* ─────────────────────── 04 · For integrators ──────────────────── */}
      <section className="relative overflow-hidden border-t border-line-strong bg-ink text-on-ink">
        <Guilloche
          tone="paper"
          className="pointer-events-none absolute -bottom-64 -left-44 h-[560px] w-[560px]"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:py-24">
          <div>
            <p className="kicker !text-white/50">04 — For integrators · CAE-1</p>
            <h2 className="display mt-4 text-[clamp(2.05rem,3.9vw,2.9rem)] text-white">
              Corporate actions, machine-readable.
            </h2>
            <p className="mt-6 max-w-md text-[0.95rem] leading-relaxed text-white/65">
              A standard event schema and a JSON endpoint, so protocols and agents can subscribe to dividends the way
              they already subscribe to prices.
            </p>
            <a
              href="/api/actions"
              className="tabular mt-8 inline-block border-b border-white/30 pb-0.5 text-sm text-white transition hover:border-white"
            >
              GET /api/actions →
            </a>
          </div>
          <pre className="overflow-x-auto rounded-lg border border-white/15 bg-white/5 p-5 text-[0.78rem] leading-relaxed text-white/80">
            <code>{`$ curl corporax.xyz/api/actions

{
  "schema": "CAE-1",
  "actions": [{
    "id": 47,
    "assetSymbol": "MSFT",
    "actionType": "CASH_DIVIDEND",
    "status": "CLAIMABLE",
    "ratePerShare": "0.75",
    "totalPayout": "1240.50"
  }]
}`}</code>
          </pre>
        </div>
      </section>

      {/* ───────────────────────── Closing statement ───────────────────── */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-6xl px-5 py-24 text-center sm:px-8 lg:py-28">
          <Kicker>CorporaX</Kicker>
          <p className="display mx-auto mt-5 max-w-3xl text-[clamp(2.2rem,4.5vw,3.2rem)] text-ink">
            The transfer agent for the on-chain economy.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/claim">
              <Button variant="primary">Claim a dividend</Button>
            </Link>
            <Link
              href="/feed"
              className="px-2 py-2.5 text-sm font-semibold text-brand transition hover:text-brand-deep"
            >
              Read the CAE-1 feed →
            </Link>
          </div>
        </div>
      </section>

      {/* ───────────────────── Notes & methodology ─────────────────────── */}
      <section id="notes" className="border-t border-line">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
          <Kicker>Notes &amp; methodology</Kicker>
          <ol className="fine mt-4 max-w-3xl list-decimal space-y-1.5 pl-4">
            <li>Count of tokenized US equities listed on Robinhood Chain&apos;s token registry, June 2026.</li>
            <li>
              Approximate gas for <span className="tabular">Distributor.claim()</span>, measured in the
              repository&apos;s Foundry test suite.
            </li>
            <li>
              <span className="tabular">ActionAnnounced</span>, <span className="tabular">MerkleRootPublished</span>,{" "}
              <span className="tabular">ActionStatusChanged</span>, <span className="tabular">Funded</span> and{" "}
              <span className="tabular">Claimed</span> — the full lifecycle of a corporate action. Holder balances are
              reconstructed from public ERC-20 Transfer logs at the record block and can be re-derived by anyone
              running the open-source snapshot CLI.
            </li>
          </ol>
        </div>
      </section>
    </div>
  );
}

/* The hero artifact: one payable dividend, presented as a registrar's document. */
function DistributionNotice() {
  return (
    <div className="relative mx-auto mt-2 max-w-sm animate-rise lg:mt-0" style={{ animationDelay: "120ms" }}>
      <div className="relative overflow-hidden rounded-lg border border-line-strong bg-surface-raised shadow-lift">
        <GuillocheSeal className="pointer-events-none absolute -right-10 top-24 h-40 w-40" />
        <div className="rule-double mx-6 mt-5" />
        <div className="flex items-baseline justify-between px-6 pt-4">
          <p className="kicker">Notice of distribution</p>
          <p className="tabular text-[0.7rem] text-ink-faint">No. CAE-0047</p>
        </div>
        <div className="flex items-end justify-between px-6 pb-2 pt-5">
          <div>
            <p className="display text-4xl text-ink">MSFT</p>
            <p className="mt-1 text-[0.78rem] text-ink-faint">Microsoft Corp. · tokenized common stock</p>
          </div>
          <span className="stamp mb-1">Claimable</span>
        </div>
        <dl className="relative mx-6 mt-3 divide-y divide-line border-t border-line text-sm">
          {[
            ["Action", "Cash dividend", false],
            ["Rate per share", "0.75 USDG", true],
            ["Record block", "#8,041,233", true],
            ["Your position", "25.0000 MSFT", true],
          ].map(([dt, dd, mono]) => (
            <div key={dt as string} className="grid grid-cols-[8rem_1fr] items-baseline py-2.5">
              <dt className="text-ink-faint">{dt}</dt>
              <dd className={`text-right font-medium text-ink ${mono ? "tabular" : ""}`}>{dd}</dd>
            </div>
          ))}
          <div className="grid grid-cols-[8rem_1fr] items-baseline py-3">
            <dt className="text-ink-faint">Amount payable</dt>
            <dd className="tabular text-right text-xl font-semibold text-money">
              18.75 <span className="text-sm font-medium text-ink-faint">USDG</span>
            </dd>
          </div>
        </dl>
        <div className="mt-1 flex items-center justify-between border-t border-line bg-surface px-6 py-3">
          <span className="fine">Merkle root 0x8f2c…41aa · CAE-1</span>
          <Link href="/claim" className="text-[0.8rem] font-semibold text-brand transition hover:text-brand-deep">
            Open in claim →
          </Link>
        </div>
      </div>
    </div>
  );
}
