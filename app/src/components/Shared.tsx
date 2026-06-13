import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`font-mono text-[11px] font-bold uppercase tracking-[0.15em] mb-6 flex items-center ${className}`}>
      <div className="w-5 h-px bg-current mr-3 opacity-60" />
      {children}
    </div>
  );
}

type BtnProps = { children: ReactNode; className?: string; href?: string; onClick?: () => void };

export function PrimaryButton({ children, className = "", href, onClick }: BtnProps) {
  const cls = `bg-primary text-white rounded-lg text-sm font-semibold hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(80,140,255,0.25)] transition-all inline-flex items-center justify-center gap-2 px-6 py-3 ${className}`;
  const inner = (
    <>
      <span>{children}</span>
      <ArrowRight className="w-4 h-4" />
    </>
  );
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <button onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

export function SecondaryButton({ children, className = "", href, onClick }: BtnProps) {
  const cls = `bg-transparent border border-black/10 text-primary rounded-lg text-sm font-semibold hover:bg-black/5 hover:border-black/20 transition-colors inline-flex items-center justify-center gap-2 px-6 py-3 ${className}`;
  const inner = (
    <>
      <span>{children}</span>
      <ArrowRight className="w-4 h-4" />
    </>
  );
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <button onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}
