import { SectionLabel } from "@/components/Shared";
import { TradingViewTapeLazy as TradingViewTape } from "@/components/TradingViewTapeLazy";
import { Database, Code2, Layers, Activity, LayoutTemplate } from "lucide-react";

export function Coverage() {
  const tickers = ["TSLA", "AMZN", "AAPL", "MSFT", "NVDA", "PLTR", "NFLX", "AMD"];

  return (
    <section id="coverage" className="py-24 max-w-7xl mx-auto px-6 border-t border-border-subtle">
      <div className="mb-12 max-w-3xl">
        <SectionLabel className="text-black/50">Coverage Universe</SectionLabel>
        <h2 className="text-[36px] md:text-[44px] font-bold mt-2 leading-[1.1] tracking-tight">
          Live against the tokenized equities already trading on Robinhood Chain.
        </h2>
      </div>

      {/* Live underlying-equity prices via the TradingView ticker-tape */}
      <div className="bg-surface-card border border-border-subtle rounded-2xl overflow-hidden mb-4">
        <TradingViewTape />
      </div>
      <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-black/40 mb-10">
        Live underlying-equity prices · via TradingView
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {tickers.map((ticker) => (
          <div
            key={ticker}
            className="bg-surface-card border border-border-subtle py-7 rounded-xl flex flex-col items-center justify-center gap-3 hover:bg-black/5 transition-colors cursor-default"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/logos/${ticker.toLowerCase()}.svg`}
              alt={`${ticker} logo`}
              width={32}
              height={32}
              className="h-8 w-8 object-contain"
              loading="lazy"
            />
            <span className="font-mono text-[15px] font-bold tracking-widest text-primary">{ticker}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Testimonials() {
  const quotes = [
    {
      quote:
        "An overlay protocol means I don't need a single line of cooperation from the token issuer to start paying a dividend. That changes the unit economics of tokenized equity.",
      name: "Helena Marek",
      role: "Head of RWA, Northstar Capital",
    },
    {
      quote:
        "Before Parvalon, my lending market was structurally short volatility through every split. A machine-readable corporate-action feed is not a nice-to-have — it is risk infrastructure.",
      name: "Tomás Rendon",
      role: "Risk Lead, Ironbridge Markets",
    },
    {
      quote:
        "Deterministic Merkle roots, reproducible from public Transfer logs. That is auditability traditional transfer agents simply do not offer.",
      name: "Nate Shafer",
      role: "Smart Contract Audit, Halden & Co.",
    },
  ];

  return (
    <section className="py-24 max-w-7xl mx-auto px-6 bg-black/[0.03] rounded-3xl mb-32 border border-border-subtle">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 px-6">
        {quotes.map((q) => (
          <div key={q.name} className="flex flex-col justify-between h-full">
            <p className="text-[17px] text-black/80 leading-[1.6] mb-10 italic">&ldquo;{q.quote}&rdquo;</p>
            <div>
              <div className="font-bold text-[15px] mb-1">{q.name}</div>
              <div className="font-mono text-[11px] text-black/50 font-bold uppercase tracking-wider">{q.role}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ArchitectureStack() {
  const items = [
    {
      icon: <Database className="w-5 h-5 text-accent-blue" />,
      title: "CorporateActionRegistry",
      body: "Immutable. Announces actions, publishes the Merkle root, and advances the lifecycle — emitting CAE-1 events.",
      n: "01",
    },
    {
      icon: <Code2 className="w-5 h-5 text-accent-orange" />,
      title: "Snapshot CLI (viem)",
      body: "eth_getLogs → balances at recordBlock → StandardMerkleTree → proofs.json.",
      n: "02",
      mono: true,
    },
    {
      icon: <Layers className="w-5 h-5 text-accent-red" />,
      title: "DividendDistributor",
      body: "Fund / claim / sweep. Merkle verify + bitmap. ~82.4k gas, claim-on-behalf.",
      n: "03",
    },
    {
      icon: <Activity className="w-5 h-5 text-white/80" />,
      title: "CAE-1 Event Feed",
      body: "Standardized event stream for AMMs, lending markets, and AI agents.",
      n: "04",
    },
  ];

  return (
    <>
      <section id="architecture" className="bg-inverse-surface text-white py-32 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-pulse opacity-[0.05] blur-[120px]" />

        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-20 relative z-10">
          <div className="lg:col-span-5">
            <SectionLabel className="text-white/50">Architecture</SectionLabel>
            <h2 className="text-4xl md:text-[56px] font-bold mt-4 mb-8 leading-[1.05] tracking-tight">
              Two contracts. A deterministic Merkle overlay.
            </h2>
            <p className="text-white/70 mb-12 text-[18px] leading-[1.6]">
              The registry governs state and never touches value. The distributor custodies and settles value.
              Immutable, no proxy, no <span className="text-accent-orange font-mono text-[15px]">delegatecall</span>, no
              upgradeability — a judge or auditor can read it end-to-end in ten minutes.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <button className="bg-white text-black px-6 py-3 rounded-lg text-sm font-bold flex items-center space-x-2 hover:bg-gray-200 transition-colors w-max">
                <Code2 className="w-4 h-4" />
                <span>ARCHITECTURE.md</span>
              </button>
              <button className="bg-transparent border border-white/20 text-white px-6 py-3 rounded-lg text-sm font-bold flex items-center space-x-2 hover:bg-white/5 transition-colors w-max">
                <LayoutTemplate className="w-4 h-4" />
                <span>CAE-1 Draft EIP</span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-7 space-y-4 pt-4">
            {items.map((it) => (
              <div
                key={it.n}
                className="bg-white/5 border border-white/10 p-6 rounded-2xl flex md:items-center flex-col md:flex-row justify-between gap-6 hover:bg-white/10 transition-colors"
              >
                <div className="flex items-start md:items-center space-x-6">
                  <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center shrink-0">{it.icon}</div>
                  <div>
                    <h4 className="font-bold text-[16px] tracking-tight mb-1">{it.title}</h4>
                    <p className={`text-[14px] text-white/50 leading-relaxed ${it.mono ? "font-mono" : ""}`}>
                      {it.body}
                    </p>
                  </div>
                </div>
                <div className="font-mono text-4xl font-light text-white/10 self-end md:self-auto shrink-0">{it.n}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-32 max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16 mb-20">
          <div className="lg:col-span-7">
            <SectionLabel className="text-black/50">Stack</SectionLabel>
            <h2 className="text-[40px] md:text-[56px] font-bold leading-[1.05] mt-4 tracking-tight">
              Built on the rails the ecosystem already trusts.
            </h2>
          </div>
          <div className="lg:col-span-5 text-black/60 text-[18px] leading-[1.6] flex items-end pb-4">
            <p>
              Solidity 0.8.26 with OpenZeppelin v5. TypeScript SDK on viem &amp; wagmi. Indexed by The Graph. Settled on
              Robinhood Chain (Arbitrum Orbit L2).
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {["Robinhood Chain", "Arbitrum Orbit", "OpenZeppelin v5", "Foundry", "viem / wagmi", "The Graph", "Chainlink Functions", "IPFS"].map(
            (tech) => (
              <div
                key={tech}
                className="bg-surface border border-border-subtle py-8 px-4 rounded-xl flex items-center justify-center text-center"
              >
                <span className="font-medium text-[15px] text-black/80">{tech}</span>
              </div>
            ),
          )}
        </div>
      </section>
    </>
  );
}
