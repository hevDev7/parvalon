import Link from "next/link";

/** Registrar mark — engraved serif X in a ruled plate, monochrome wordmark. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="group inline-flex items-center gap-2.5" aria-label="CorporaX home">
      <span className="grid h-7 w-7 place-items-center rounded-[3px] border border-ink/30 bg-surface-raised transition group-hover:border-brand">
        <span className="font-display text-[16px] italic leading-none text-ink transition group-hover:text-brand">
          X
        </span>
      </span>
      {!compact && (
        <span className="font-display text-[1.25rem] font-medium tracking-tight text-ink">CorporaX</span>
      )}
    </Link>
  );
}
