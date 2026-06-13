import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SectionLabel } from "@/components/Shared";
import { Globe } from "@/components/Globe";
import { CountUp } from "@/components/CountUp";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* full-bleed footage filling the whole hero */}
      <video
        className="absolute inset-0 h-full w-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        aria-label="Financial district skyline"
      >
        <source src="/hero-skyline.mp4" type="video/mp4" />
      </video>
      {/* legibility scrim — dark where the copy sits (left), clearing toward the footage (right) */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/60 to-black/20" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/15" />

      {/* content — copy stays in the left column; the right column lets the footage read through */}
      <div className="relative z-10 mx-auto grid min-h-[600px] max-w-7xl grid-cols-1 items-center gap-16 px-6 pb-24 pt-20 lg:min-h-[760px] lg:grid-cols-2 lg:pb-28 lg:pt-24">
        <div className="pr-4 md:pr-8">
          <SectionLabel className="text-white/60">Corporate Actions, Onchain</SectionLabel>

          <h1 className="mb-8 text-[44px] font-bold leading-[1.05] tracking-tight text-white md:text-[64px]">
            The missing
            <br />
            <span className="text-white/55">corporate-</span>
            <br />
            <span className="text-white/55">actions</span> layer for
            <br />
            tokenized
            <br />
            <span className="relative inline-block">
              stocks
              <span className="absolute bottom-2 left-0 -z-10 h-2.5 w-full rounded bg-gradient-pulse opacity-90" />
            </span>
          </h1>

          <div className="mb-8 h-1 w-8 rounded bg-white/25" />

          <p className="mb-12 max-w-lg text-[18px] font-medium leading-[1.6] text-white/75">
            On-chain dividends, stock splits, and record-date semantics — for the ~2,000 tokenized equities that already
            exist. A permissionless overlay protocol. No issuer integration, no token changes required.
          </p>

          <div className="mb-16 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center">
            <Link
              href="/claim"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-8 py-4 text-[15px] font-semibold text-black transition-all hover:scale-[1.02] hover:shadow-[0_0_24px_rgba(255,255,255,0.25)]"
            >
              Launch dApp
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/feed"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/30 px-8 py-4 text-[15px] font-semibold text-white transition-colors hover:border-white/50 hover:bg-white/10"
            >
              Explore the feed
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 font-mono text-[11px] font-bold uppercase tracking-widest text-white/55">
            <div className="flex items-center space-x-2">
              <span className="h-2.5 w-2.5 rounded-full bg-accent-blue" />
              <span>238 tests passing</span>
            </div>
            <span className="hidden text-white/20 md:inline">/</span>
            <span>~82.4K gas per claim</span>
            <span className="hidden text-white/20 md:inline">/</span>
            <span>Robinhood Chain L2</span>
          </div>
        </div>

        {/* right column — a rotating dot-globe of global markets, over the footage */}
        <div className="relative hidden items-center justify-end lg:flex">
          <Globe className="aspect-square w-full max-w-[700px] drop-shadow-[0_0_70px_rgba(80,140,255,0.3)] lg:translate-x-10 lg:scale-[1.15]" />
        </div>
      </div>
    </section>
  );
}

function Stat({
  to,
  decimals = 0,
  separator = false,
  suffix,
  suffixClass = "",
  valueClass = "",
  label,
}: {
  to: number;
  decimals?: number;
  separator?: boolean;
  suffix?: string;
  suffixClass?: string;
  valueClass?: string;
  label: ReactNode;
}) {
  return (
    <div>
      <div className={`text-5xl md:text-6xl font-bold mb-4 flex items-baseline tracking-tight ${valueClass}`}>
        <CountUp to={to} decimals={decimals} separator={separator} />
        {suffix && <span className={suffixClass}>{suffix}</span>}
      </div>
      <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-white/50 leading-relaxed">
        {label}
      </div>
    </div>
  );
}

export function Stats() {
  return (
    <section className="bg-inverse-surface text-white py-32">
      <div className="max-w-7xl mx-auto px-6">
        <SectionLabel className="text-white/50">Evidence</SectionLabel>

        <h2 className="text-4xl md:text-5xl lg:text-[56px] font-bold mb-20 max-w-2xl leading-[1.1] tracking-tight">
          Auditable infrastructure, by the numbers.
        </h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-12 border-t border-white/10 pt-16">
          <Stat to={2000} separator suffix="+" suffixClass="text-accent-red" label={<>Tokenized<br />equities in scope</>} />
          <Stat to={82.4} decimals={1} suffix="k" suffixClass="text-3xl text-white/40" label={<>Gas per<br />claim</>} />
          <Stat to={238} label={<>Tests passing<br />(Forge + TS)</>} />
          <Stat to={0} valueClass="text-white/30" label={<>High / medium<br />Slither findings</>} />
        </div>
      </div>
    </section>
  );
}
