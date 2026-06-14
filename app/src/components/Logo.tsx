import Link from "next/link";

/** Parvalon mark — a black tile filled with the red→orange→blue accent gradient. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center space-x-2.5" aria-label="Parvalon home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-parvalon.png" alt="Parvalon" className="w-7 h-7 rounded object-contain" />
      {!compact && <span className="font-bold text-xl tracking-tight text-primary">Parvalon</span>}
    </Link>
  );
}
