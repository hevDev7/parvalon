import { SectionLabel } from "@/components/Shared";
import { Reveal } from "@/components/Reveal";
import { Megaphone, Layers, Zap, XCircle, ShieldAlert, SplitSquareHorizontal } from "lucide-react";

export function Protocol() {
  return (
    <section id="protocol" className="max-w-7xl mx-auto px-6 py-32 border-b border-border-subtle">
      <Reveal>
        <SectionLabel className="text-black/50">Protocol</SectionLabel>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 mb-24 lg:items-end">
          <h2 className="lg:col-span-7 text-[48px] md:text-[64px] font-bold leading-[1.05] tracking-tight">
            Three primitives.
            <br />
            One overlay
            <br />
            protocol.
          </h2>
          <p className="lg:col-span-5 text-black/60 text-[18px] leading-[1.6] pb-2">
            A focused, immutable, two-contract protocol plus the off-chain tooling around it. Works against any standard
            ERC-20 — no token changes, no issuer integration.
          </p>
        </div>
      </Reveal>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <Reveal className="h-full" delay={0}>
          <div className="h-full bg-surface-card border border-border-subtle p-10 rounded-2xl shadow-sm hover:shadow-[0_8px_30px_rgba(0,0,0,0.05)] transition-all flex flex-col group">
            <div className="w-14 h-14 rounded-xl border border-border-subtle flex items-center justify-center mb-12 text-black/80 bg-surface group-hover:scale-110 transition-transform duration-300">
              <Megaphone className="w-6 h-6" />
            </div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-black/40 mb-6">
              CorporateActionRegistry
            </div>
            <h3 className="text-[28px] font-bold mb-6 tracking-tight">Announce</h3>
            <p className="text-[16px] text-black/60 mb-10 leading-[1.6] flex-grow">
              Issuers register a corporate action on-chain — dividend, split, or stock dividend — with proper
              record-date semantics in the immutable CorporateActionRegistry.
            </p>
            <a
              className="font-mono text-[13px] font-bold flex items-center space-x-2 text-primary hover:text-accent-blue transition-colors mt-auto uppercase tracking-wider"
              href="/feed"
            >
              <span>Read the spec</span>
              <span>→</span>
            </a>
          </div>
        </Reveal>

        <Reveal className="h-full" delay={140}>
          <div className="h-full bg-surface-card border border-border-subtle p-10 rounded-2xl shadow-sm hover:shadow-[0_8px_30px_rgba(0,0,0,0.05)] transition-all flex flex-col group relative overflow-hidden">
            <div className="w-14 h-14 rounded-xl border border-border-subtle flex items-center justify-center mb-12 text-black/80 bg-surface group-hover:scale-110 transition-transform duration-300 relative z-10">
              <Layers className="w-6 h-6" />
            </div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-black/40 mb-6 relative z-10">
              DividendDistributor
            </div>
            <h3 className="text-[28px] font-bold mb-6 tracking-tight relative z-10">Snapshot &amp; distribute</h3>
            <p className="text-[16px] text-black/60 mb-10 leading-[1.6] flex-grow relative z-10">
              Holders are reconstructed from on-chain Transfer logs at the record block, committed as a Merkle root, and
              paid out in USDG with O(1) gas per claim — ~82.4k.
            </p>
            <a
              className="font-mono text-[13px] font-bold flex items-center space-x-2 text-primary hover:text-accent-blue transition-colors mt-auto uppercase tracking-wider relative z-10"
              href="/feed"
            >
              <span>Read the spec</span>
              <span>→</span>
            </a>
            <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-gradient-pulse opacity-[0.06] blur-[100px] rounded-full" />
          </div>
        </Reveal>

        <Reveal className="h-full" delay={280}>
          <div className="h-full bg-surface-card border border-border-subtle p-10 rounded-2xl shadow-sm hover:shadow-[0_8px_30px_rgba(0,0,0,0.05)] transition-all flex flex-col group">
            <div className="w-14 h-14 rounded-xl border border-border-subtle flex items-center justify-center mb-12 text-black/80 bg-surface group-hover:scale-110 transition-transform duration-300">
              <Zap className="w-6 h-6" />
            </div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-black/40 mb-6">
              CAE-1 / /api/actions
            </div>
            <h3 className="text-[28px] font-bold mb-6 tracking-tight">Consume</h3>
            <p className="text-[16px] text-black/60 mb-10 leading-[1.6] flex-grow">
              Lending markets, AMMs and AI agents subscribe to the standardized CAE-1 event stream and /api/actions feed
              — the first machine-readable corporate-actions tape.
            </p>
            <a
              className="font-mono text-[13px] font-bold flex items-center space-x-2 text-primary hover:text-accent-blue transition-colors mt-auto uppercase tracking-wider"
              href="/api/actions"
            >
              <span>Read the spec</span>
              <span>→</span>
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function Problem() {
  return (
    <section className="py-32 max-w-7xl mx-auto px-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 mb-20">
        <div className="lg:col-span-7">
          <SectionLabel className="text-black/50">The Problem</SectionLabel>
          <h2 className="text-[40px] md:text-[56px] font-bold leading-[1.1] mt-4 tracking-tight">
            Tokenization solved issuance. It never solved what comes after.
          </h2>
        </div>
        <div className="lg:col-span-5 text-black/70 space-y-6 pt-2 text-[18px] leading-[1.6]">
          <p>
            If you hold a tokenized share today there is no on-chain rail to receive a dividend, no record date, no
            auditable proof of distribution. A lending market using TSLA as collateral has no idea when a 4:1 split
            happens. An AMM has no signal when a token goes ex-dividend. That is systemic risk the moment RWAs become
            real collateral.
          </p>
          <p>
            Parvalon is the operational services layer institutional tokenization still lacks — built as a
            permissionless overlay, not an integration.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-surface-card border border-border-subtle p-8 rounded-2xl shadow-sm">
          <div className="mb-6 text-accent-red bg-accent-red/10 w-12 h-12 rounded-lg flex items-center justify-center">
            <XCircle className="w-6 h-6" />
          </div>
          <h3 className="text-[20px] font-bold mb-3 tracking-tight">No dividend rail</h3>
          <p className="text-[15px] text-black/60 leading-relaxed">
            Holders cannot claim, issuers cannot prove distribution.
          </p>
        </div>

        <div className="bg-surface-card border border-border-subtle p-8 rounded-2xl shadow-sm">
          <div className="mb-6 text-accent-orange bg-accent-orange/10 w-12 h-12 rounded-lg flex items-center justify-center">
            <SplitSquareHorizontal className="w-6 h-6" />
          </div>
          <h3 className="text-[20px] font-bold mb-3 tracking-tight">No split signal</h3>
          <p className="text-[15px] text-black/60 leading-relaxed">
            Lending markets and AMMs go blind through corporate actions.
          </p>
        </div>

        <div className="bg-surface-card border border-border-subtle p-8 rounded-2xl shadow-sm">
          <div className="mb-6 text-accent-blue bg-accent-blue/10 w-12 h-12 rounded-lg flex items-center justify-center">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h3 className="text-[20px] font-bold mb-3 tracking-tight">No agent feed</h3>
          <p className="text-[15px] text-black/60 leading-relaxed">
            AI agents and protocols can&apos;t react to what they can&apos;t read.
          </p>
        </div>
      </div>
    </section>
  );
}
