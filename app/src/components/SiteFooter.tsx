import Link from "next/link";
import { activeChain } from "@/lib/chain";

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface-raised/50">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
        <div className="rule mb-8" />
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-md">
            <p className="display text-xl text-ink">The transfer agent for the on-chain economy.</p>
            <p className="mt-2 text-sm text-ink-soft">
              Corporate actions — dividends, splits, record dates — finally machine-readable and on-chain.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <Link href="/claim" className="text-ink-soft transition hover:text-ink">
              Claim
            </Link>
            <Link href="/issuer" className="text-ink-soft transition hover:text-ink">
              Issuer console
            </Link>
            <Link href="/feed" className="text-ink-soft transition hover:text-ink">
              CAE-1 feed
            </Link>
            <a href="/api/actions" className="text-ink-soft transition hover:text-ink">
              /api/actions
            </a>
          </div>
        </div>
        <div className="mt-8 flex flex-col gap-1 text-[0.72rem] text-ink-faint sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} CorporaX · MIT · Built on Robinhood Chain</span>
          <span className="tabular">
            network: {activeChain.name} · chainId {activeChain.id}
          </span>
        </div>
      </div>
    </footer>
  );
}
