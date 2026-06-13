/**
 * Guilloche rosette — the engraved ornament of stock certificates and banknotes,
 * rebuilt parametrically. Pure server-rendered SVG: deterministic hypotrochoid
 * rings, hairline strokes, no animation. The visual signature of the Registrar.
 *
 *   x(t) = A·cos t + d·cos(k·t)
 *   y(t) = A·sin t − d·sin(k·t)
 */

type Ring = {
  A: number; // base radius
  k: number; // lobe count (integer → curve closes in one turn)
  d: number; // pen offset (loop depth)
  opacity: number;
  brand?: boolean;
};

const RINGS: Ring[] = [
  { A: 210, k: 6, d: 58, opacity: 0.22 },
  { A: 185, k: 9, d: 34, opacity: 0.18 },
  { A: 160, k: 12, d: 22, opacity: 0.18 },
  { A: 130, k: 5, d: 46, opacity: 0.3, brand: true },
  { A: 105, k: 18, d: 12, opacity: 0.2 },
  { A: 64, k: 8, d: 20, opacity: 0.24 },
];

function ringPath({ A, k, d }: Ring, cx: number, cy: number, samples = 480): string {
  let path = "";
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    const x = cx + A * Math.cos(t) + d * Math.cos(k * t);
    const y = cy + A * Math.sin(t) - d * Math.sin(k * t);
    path += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return path + "Z";
}

export function Guilloche({
  className = "",
  rings = RINGS,
  tone = "ink",
}: {
  className?: string;
  rings?: Ring[];
  tone?: "ink" | "paper";
}) {
  const base = tone === "paper" ? "rgba(255,255,255,0.55)" : "var(--ink)";
  const accent = tone === "paper" ? "rgba(255,255,255,0.8)" : "var(--brand)";
  const frame = tone === "paper" ? "rgba(255,255,255,0.35)" : "var(--line-strong)";
  return (
    <svg viewBox="0 0 600 600" className={className} aria-hidden fill="none">
      {/* framing rules */}
      <circle cx="300" cy="300" r="282" stroke={frame} strokeWidth="1" />
      <circle cx="300" cy="300" r="276" stroke={frame} strokeWidth="0.7" opacity="0.7" />
      {rings.map((r, i) => (
        <path
          key={i}
          d={ringPath(r, 300, 300)}
          stroke={r.brand ? accent : base}
          strokeWidth="1"
          opacity={tone === "paper" ? r.opacity * 0.55 : r.opacity}
        />
      ))}
    </svg>
  );
}

/** Small corner rosette for document panels. */
export function GuillocheSeal({ className = "" }: { className?: string }) {
  return (
    <Guilloche
      className={className}
      rings={[
        { A: 200, k: 8, d: 60, opacity: 0.3 },
        { A: 150, k: 12, d: 32, opacity: 0.26 },
        { A: 95, k: 6, d: 38, opacity: 0.34, brand: true },
      ]}
    />
  );
}
