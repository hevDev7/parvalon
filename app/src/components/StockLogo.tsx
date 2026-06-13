"use client";

import { useState } from "react";

/**
 * Stock / token logo. Uses the bundled brand SVGs in `public/logos/` (offline,
 * reliable) and falls back to a refined brand-coloured monogram if a logo is
 * missing — so it always reads as a logo, never a broken image. USDG (the payout
 * stablecoin) renders as a money-toned "$" tile.
 */
const HAS_LOGO = new Set(["AAPL", "AMD", "AMZN", "MSFT", "NFLX", "NVDA", "PLTR", "TSLA"]);

const COLOR: Record<string, string> = {
  TSLA: "#E82127",
  AMZN: "#FF9900",
  MSFT: "#0078D4",
  AAPL: "#111111",
  NVDA: "#76B900",
  PLTR: "#101113",
  NFLX: "#E50914",
  AMD: "#ED1C24",
  USDG: "#138a5e",
};

export function StockLogo({
  symbol,
  size = 28,
  className = "",
}: {
  symbol: string;
  size?: number;
  className?: string;
}) {
  const sym = (symbol || "?").toUpperCase();
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size } as const;
  const stable = sym === "USDG";

  if (HAS_LOGO.has(sym) && !failed) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-line ${className}`}
        style={box}
      >
        {/* bundled SVG in public/logos — no next/image remote config needed */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/logos/${sym.toLowerCase()}.svg`}
          alt={`${sym} logo`}
          width={size}
          height={size}
          loading="lazy"
          className="h-full w-full object-contain p-[16%]"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  const label = stable ? "$" : sym.slice(0, 2);
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-bold leading-none text-white ${className}`}
      style={{ ...box, background: COLOR[sym] ?? "#3a3a3a", fontSize: size * (stable ? 0.52 : 0.38) }}
      aria-label={`${sym} logo`}
    >
      {label}
    </span>
  );
}
