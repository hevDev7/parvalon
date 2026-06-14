"use client";

import dynamic from "next/dynamic";

/**
 * Code-split + client-only the canvas Globe so it stays out of SSR and the
 * initial JS bundle, and its requestAnimationFrame draw loop only starts after
 * the page is interactive. The decorative hero copy/CTA render instantly; the
 * globe fades in.
 */
const Globe = dynamic(() => import("@/components/Globe").then((m) => m.Globe), { ssr: false });

export function GlobeLazy({ className }: { className?: string }) {
  return <Globe className={className} />;
}
