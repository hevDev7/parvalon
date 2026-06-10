import Link from "next/link";

/** Engraved-seal monogram + wordmark. The seal nods to a transfer agent's stamp. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="group inline-flex items-center gap-2.5" aria-label="CorporaX home">
      <span className="relative inline-grid h-8 w-8 place-items-center">
        <svg viewBox="0 0 40 40" className="h-8 w-8" aria-hidden>
          <circle cx="20" cy="20" r="18.5" fill="none" stroke="var(--brass)" strokeWidth="1" opacity="0.6" />
          <circle cx="20" cy="20" r="15" fill="none" stroke="var(--brass-soft)" strokeWidth="0.6" strokeDasharray="1.5 2.2" />
          <circle cx="20" cy="20" r="11.5" fill="var(--viridian)" />
          <text
            x="20"
            y="25.5"
            textAnchor="middle"
            fontFamily="var(--font-display)"
            fontSize="15"
            fill="var(--paper-panel)"
          >
            X
          </text>
        </svg>
      </span>
      {!compact && (
        <span className="display text-[1.45rem] leading-none text-ink">
          Corpora<span className="text-viridian">X</span>
        </span>
      )}
    </Link>
  );
}
