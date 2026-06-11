import Link from "next/link";

/** Lime monogram mark + wordmark — an on-chain terminal signature. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="group inline-flex items-center gap-2.5" aria-label="CorporaX home">
      <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-lime shadow-glow transition group-hover:bg-lime-bright">
        <span className="font-display text-[15px] font-extrabold leading-none text-surface">X</span>
      </span>
      {!compact && (
        <span className="font-display text-[1.18rem] font-bold tracking-tight text-ink">
          Corpora<span className="text-lime">X</span>
        </span>
      )}
    </Link>
  );
}
