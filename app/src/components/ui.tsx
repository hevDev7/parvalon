import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { fmtAmount, statusTone, STATUS_LABEL } from "@/lib/format";
import type { ActionStatusName } from "@/lib/types";

/* ----------------------------------------------------------------- Button */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ink" | "ghost" | "outline";
  loading?: boolean;
};

const BTN: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-viridian text-paper-panel hover:bg-viridian-bright shadow-lift",
  ink: "bg-ink text-paper-panel hover:bg-viridian",
  ghost: "bg-transparent text-ink-soft hover:text-ink hover:bg-paper-deep",
  outline: "border border-line-strong bg-paper-panel text-ink hover:border-viridian hover:text-viridian",
};

export function Button({ variant = "primary", loading, children, className = "", disabled, ...rest }: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-55 ${BTN[variant]} ${className}`}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`h-4 w-4 animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------- Card */
export function Card({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
}) {
  return (
    <Tag className={`rounded-2xl border border-line bg-paper-panel shadow-certificate ${className}`}>{children}</Tag>
  );
}

/* ------------------------------------------------------------------ Kicker */
export function Kicker({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`kicker ${className}`}>{children}</p>;
}

/* ------------------------------------------------------------- StatusBadge */
export function StatusBadge({ status }: { status: ActionStatusName }) {
  const tone = statusTone(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.72rem] font-medium ${tone.bg} ${tone.fg}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/* -------------------------------------------------------------------- Money */
export function Money({
  wei,
  symbol,
  decimals = 18,
  className = "",
}: {
  wei: string | bigint;
  symbol?: string;
  decimals?: number;
  className?: string;
}) {
  return (
    <span className={`tabular ${className}`}>
      {fmtAmount(wei, decimals)}
      {symbol ? <span className="ml-1 text-ink-faint">{symbol}</span> : null}
    </span>
  );
}

/* --------------------------------------------------------------- EmptyState */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-paper-panel/60 px-6 py-16 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-full border border-line bg-paper-deep">
        <span className="display text-2xl text-ink-faint">∅</span>
      </div>
      <h3 className="display text-xl text-ink">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-ink-soft">{body}</p>
      {action && (
        <Link href={action.href} className="mt-5">
          <Button variant="outline">{action.label}</Button>
        </Link>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- Field */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm font-medium text-ink">{label}</span>
        {hint && <span className="text-[0.72rem] text-ink-faint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm text-ink shadow-inset outline-none transition placeholder:text-ink-faint focus:border-viridian";
