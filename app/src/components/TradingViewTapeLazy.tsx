"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

/**
 * Defer the heavy external TradingView widget until its section scrolls near the
 * viewport — keeps the third-party script off the initial load entirely.
 */
const TradingViewTape = dynamic(() => import("@/components/Ticker").then((m) => m.TradingViewTape), { ssr: false });

export function TradingViewTapeLazy() {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return <div ref={ref} className="min-h-[44px]">{show ? <TradingViewTape /> : null}</div>;
}
