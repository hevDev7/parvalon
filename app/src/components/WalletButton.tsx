"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { shortAddr } from "@/lib/format";

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (isConnected && address) {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-2 rounded-md border border-line-strong bg-surface-raised px-3.5 py-2 text-sm transition hover:border-ink"
        >
          <span className="h-2 w-2 rounded-full bg-money" />
          <span className="tabular text-ink">{shortAddr(address)}</span>
        </button>
        {open && (
          <div className="absolute right-0 mt-2 w-48 overflow-hidden rounded-xl border border-line bg-surface-raised shadow-lift">
            <button
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
              className="block w-full px-4 py-3 text-left text-sm text-ink-soft transition hover:bg-surface-inset hover:text-danger"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-medium text-on-ink transition hover:bg-black disabled:opacity-60"
      >
        {isPending ? "Connecting…" : "Connect"}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-surface-raised shadow-lift">
          <p className="border-b border-line px-4 py-2.5 text-[0.7rem] uppercase tracking-kicker text-ink-faint">
            Choose a wallet
          </p>
          {connectors.map((c) => (
            <button
              key={c.uid}
              onClick={() => {
                connect({ connector: c });
                setOpen(false);
              }}
              className="block w-full px-4 py-3 text-left text-sm text-ink transition hover:bg-surface-inset"
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
