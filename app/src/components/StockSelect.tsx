"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { StockLogo } from "@/components/StockLogo";

/**
 * Logo-aware asset picker. A native <select> can't render images in its options,
 * so this is a lightweight custom listbox that shows each stock's logo + ticker.
 * Controlled by `value` (the asset address) like the <select> it replaces.
 */
type Option = { symbol: string; address: `0x${string}` };

export function StockSelect({
  options,
  value,
  onChange,
}: {
  options: Option[];
  value: string;
  onChange: (address: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.address === value) ?? options[0];

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-line-strong bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition focus:border-brand"
      >
        <span className="flex items-center gap-2.5">
          {selected && <StockLogo symbol={selected.symbol} size={24} />}
          <span className="font-medium">{selected?.symbol ?? "Select asset"}</span>
        </span>
        <ChevronDown className={`h-4 w-4 text-ink-faint transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1.5 max-h-72 w-full overflow-auto rounded-md border border-line bg-surface-raised p-1 shadow-lift"
        >
          {options.map((o) => {
            const active = o.address === value;
            return (
              <li key={o.address}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(o.address);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2.5 py-2.5 text-sm transition hover:bg-surface-inset ${
                    active ? "bg-surface-inset" : ""
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <StockLogo symbol={o.symbol} size={24} />
                    <span className="font-medium text-ink">{o.symbol}</span>
                  </span>
                  {active && <Check className="h-4 w-4 text-money" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
