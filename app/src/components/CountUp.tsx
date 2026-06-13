"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Counts from 0 up to `to` once it scrolls into view (IntersectionObserver).
 * Honors prefers-reduced-motion by jumping straight to the final value.
 */
export function CountUp({
  to,
  decimals = 0,
  separator = false,
  duration = 1700,
  className = "",
}: {
  to: number;
  decimals?: number;
  separator?: boolean;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [val, setVal] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setVal(to);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !started.current) {
            started.current = true;
            const start = performance.now();
            const step = (now: number) => {
              const t = Math.min(1, (now - start) / duration);
              const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
              setVal(to * eased);
              if (t < 1) requestAnimationFrame(step);
              else setVal(to);
            };
            requestAnimationFrame(step);
            obs.unobserve(e.target);
          }
        }
      },
      { threshold: 0.4 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [to, duration]);

  return (
    <span ref={ref} className={className}>
      {val.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: separator,
      })}
    </span>
  );
}
