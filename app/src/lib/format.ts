import { formatUnits } from "viem";
import type { ActionStatusName } from "@/lib/types";

/** Compact token amount from wei → human string, trimming trailing zeros. */
export function fmtAmount(wei: string | bigint, decimals = 18, maxFrac = 4): string {
  const s = formatUnits(typeof wei === "bigint" ? wei : BigInt(wei || "0"), decimals);
  const [int, frac = ""] = s.split(".");
  const trimmed = frac.slice(0, maxFrac).replace(/0+$/, "");
  const grouped = Number(int).toLocaleString("en-US");
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

export function shortAddr(a?: string): string {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function fmtDate(unixSeconds: number): string {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtRelative(unixSeconds: number): string {
  if (!unixSeconds) return "—";
  const diff = unixSeconds * 1000 - Date.now();
  const abs = Math.abs(diff);
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [86400000, "day"],
    [3600000, "hour"],
    [60000, "minute"],
  ];
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [ms, unit] of units) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return "just now";
}

export const STATUS_LABEL: Record<ActionStatusName, string> = {
  ANNOUNCED: "Announced",
  ROOT_PUBLISHED: "Snapshot published",
  CLAIMABLE: "Claimable",
  FINALIZED: "Finalized",
  CANCELLED: "Cancelled",
};

/** Returns the design tokens for a status chip. */
export function statusTone(s: ActionStatusName): { fg: string; bg: string; dot: string } {
  switch (s) {
    case "CLAIMABLE":
      return { fg: "text-viridian", bg: "bg-viridian-wash", dot: "bg-viridian-bright" };
    case "ROOT_PUBLISHED":
      return { fg: "text-brass", bg: "bg-[#f4ecd9]", dot: "bg-brass" };
    case "ANNOUNCED":
      return { fg: "text-ink-soft", bg: "bg-paper-deep", dot: "bg-ink-faint" };
    case "FINALIZED":
      return { fg: "text-ink-soft", bg: "bg-paper-deep", dot: "bg-ink-soft" };
    case "CANCELLED":
      return { fg: "text-oxblood", bg: "bg-[#f3e3df]", dot: "bg-oxblood" };
  }
}
