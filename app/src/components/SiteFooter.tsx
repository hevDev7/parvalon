import Link from "next/link";
import { activeChain } from "@/lib/chain";

const NAV_COLUMNS: { title: string; links: { href: string; label: string; external?: boolean }[] }[] = [
  {
    title: "Holders",
    links: [
      { href: "/claim", label: "Claim a dividend" },
      { href: "/feed", label: "Corporate-action feed" },
    ],
  },
  {
    title: "Issuers",
    links: [
      { href: "/issuer", label: "Issuer console" },
      { href: "/feed", label: "Distribution records" },
    ],
  },
  {
    title: "Integrators",
    links: [
      { href: "/api/actions", label: "GET /api/actions", external: true },
      { href: "/feed", label: "CAE-1 event stream" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line-strong bg-surface-raised">
      <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-[1.2fr_repeat(3,0.6fr)] md:items-baseline">
          <div className="col-span-2 max-w-sm md:col-span-1">
            <p className="display text-2xl text-ink">Corporate actions, on public rails.</p>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              Dividends, splits, record dates — recorded, funded, and settled where the tokens already live.
            </p>
          </div>
          {NAV_COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="kicker">{col.title}</p>
              <ul className="mt-3 space-y-1 text-sm">
                {col.links.map((l) =>
                  l.external ? (
                    <li key={l.label}>
                      <a href={l.href} className="inline-block py-1.5 text-ink-soft transition hover:text-brand">
                        {l.label}
                      </a>
                    </li>
                  ) : (
                    <li key={l.label}>
                      <Link href={l.href} className="inline-block py-1.5 text-ink-soft transition hover:text-brand">
                        {l.label}
                      </Link>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>

        {/* Disclosures — fine print is part of the design, not an afterthought. */}
        <div className="rule mt-12" />
        <div className="fine mt-6 max-w-4xl space-y-2.5">
          <p>
            CorporaX is open-source infrastructure software, published under the MIT license. It is not a registered
            transfer agent, broker-dealer, or investment adviser, and nothing on this site is an offer to sell or a
            solicitation to buy any security.
          </p>
          <p>
            Distribution records shown here are read directly from immutable smart contracts on{" "}
            {activeChain.name}. Holder snapshots are reconstructed from public ERC-20 Transfer logs at the stated
            record block and can be independently re-derived by anyone running the open-source snapshot CLI. Figures
            marked ¹ ² ³ are explained in the notes on the homepage.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-1 border-t border-line pt-5 text-[0.72rem] text-ink-faint sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} CorporaX · MIT · Built on Robinhood Chain</span>
          <span className="tabular">
            network: {activeChain.name} · chainId {activeChain.id}
          </span>
        </div>
      </div>
    </footer>
  );
}
