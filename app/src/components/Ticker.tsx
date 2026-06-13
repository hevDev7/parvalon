"use client";

import { useEffect, useRef } from "react";

/** Live TradingView ticker-tape for the covered tokenized-stock universe.
 *  All symbols are NASDAQ-listed; the widget auto-updates and scrolls on its own. */
const UNIVERSE = ["MSFT", "AAPL", "TSLA", "AMZN", "NVDA", "PLTR", "NFLX", "AMD", "GOOGL", "META", "COIN", "HOOD"];

export function TradingViewTape() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = "";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    container.appendChild(widget);

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
    script.async = true;
    script.type = "text/javascript";
    script.innerHTML = JSON.stringify({
      symbols: UNIVERSE.map((sym) => ({ proName: `NASDAQ:${sym}`, title: sym })),
      colorTheme: "light",
      isTransparent: true,
      displayMode: "adaptive",
      showSymbolLogo: true,
      locale: "en",
    });
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, []);

  return (
    <div
      className="tradingview-widget-container"
      ref={containerRef}
      aria-label="Live prices for covered tokenized stocks, via TradingView"
    />
  );
}
