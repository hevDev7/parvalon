/** Stock-ticker tape — atmospheric nod to the ~2,000 tokenized stocks on Arbitrum.
 *  TSLA/AMZN carry a viridian mark: the assets CorporaX makes dividend-ready. */
const UNIVERSE: { sym: string; enabled?: boolean }[] = [
  { sym: "TSLA", enabled: true },
  { sym: "AMZN", enabled: true },
  { sym: "NVDA" },
  { sym: "PLTR" },
  { sym: "AAPL" },
  { sym: "NFLX" },
  { sym: "AMD" },
  { sym: "MSFT" },
  { sym: "GOOGL" },
  { sym: "META" },
  { sym: "COIN" },
  { sym: "HOOD" },
];

function Row() {
  return (
    <div className="flex shrink-0 items-center">
      {UNIVERSE.map((t) => (
        <span key={t.sym} className="flex items-center gap-2 whitespace-nowrap px-5 py-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${t.enabled ? "bg-viridian-bright" : "bg-ink-faint/40"}`}
            aria-hidden
          />
          <span className="tabular text-[0.72rem] font-medium tracking-wide text-ink-soft">{t.sym}</span>
          <span className="tabular text-[0.68rem] text-ink-faint">{t.enabled ? "dividend-ready" : "tokenized"}</span>
        </span>
      ))}
    </div>
  );
}

export function Ticker() {
  return (
    <div className="border-b border-line bg-paper-panel/60">
      <div className="tape-mask overflow-hidden">
        <div className="flex w-max animate-ticker">
          <Row />
          <Row />
        </div>
      </div>
    </div>
  );
}
