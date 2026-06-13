/** Coverage strip — the tokenized-stock universe on Robinhood Chain, with
 *  dividend-ready marks on the assets CorporaX operates. Static by design:
 *  a quiet data bar, not a marquee. */
const UNIVERSE: { sym: string; enabled?: boolean }[] = [
  { sym: "MSFT", enabled: true },
  { sym: "AAPL", enabled: true },
  { sym: "TSLA" },
  { sym: "AMZN" },
  { sym: "NVDA" },
  { sym: "PLTR" },
  { sym: "NFLX" },
  { sym: "AMD" },
  { sym: "GOOGL" },
  { sym: "META" },
  { sym: "COIN" },
  { sym: "HOOD" },
];

export function Ticker() {
  return (
    <div className="border-b border-line bg-surface-raised">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 sm:px-8">
        <span className="kicker hidden shrink-0 border-r border-line py-2 pr-4 sm:block">Coverage</span>
        <div className="flex min-w-0 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,black_calc(100%-40px),transparent)]">
          {UNIVERSE.map((t) => (
            <span key={t.sym} className="flex items-center gap-1.5 whitespace-nowrap px-3 py-2 first:pl-0">
              <span
                className={`h-1.5 w-1.5 rounded-full ${t.enabled ? "bg-money" : "bg-line-strong"}`}
                aria-hidden
              />
              <span className="tabular text-[0.72rem] font-medium text-ink-soft">{t.sym}</span>
            </span>
          ))}
        </div>
        <span className="fine ml-auto shrink-0 whitespace-nowrap py-2">
          <span className="text-money">●</span> dividend-ready
          <span className="hidden md:inline"> · 1,997 listed¹</span>
        </span>
      </div>
    </div>
  );
}
