import Link from "next/link";

/** Parvalon mark — a black tile filled with the red→orange→blue accent gradient. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center space-x-2.5" aria-label="Parvalon home">
      <span className="w-6 h-6 bg-primary rounded flex items-center justify-center overflow-hidden">
        <span className="w-full h-full bg-gradient-pulse opacity-90" />
      </span>
      {!compact && <span className="font-bold text-xl tracking-tight text-primary">Parvalon</span>}
    </Link>
  );
}
