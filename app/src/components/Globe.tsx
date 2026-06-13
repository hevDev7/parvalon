"use client";

import { useEffect, useRef } from "react";

/**
 * Custom dotted globe rendered to a transparent canvas — continents are sampled
 * from an equirectangular land mask and each continent gets its own dot colour.
 * Logos + arcs are an overlay that shares the exact same projection, so they
 * stay locked to the surface as it spins.
 */

const THETA = 0.3; // tilt
const PHI_SPEED = 0.0028; // rotation speed
const R = 40; // projected globe radius (cobe-matched: 0.8 of half-canvas)
const PHI_OFFSET = 0;

// Logos placed by lat/lon, on clear landmasses.
const NODES: { sym: string; lat: number; lon: number }[] = [
  { sym: "AAPL", lat: 40, lon: -100 },
  { sym: "MSFT", lat: 50, lon: 12 },
  { sym: "NVDA", lat: 24, lon: 80 },
  { sym: "TSLA", lat: -25, lon: 133 },
  { sym: "AMZN", lat: -9, lon: -58 },
  { sym: "NFLX", lat: 37, lon: 119 },
];
const ARCS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 5],
  [5, 3],
  [3, 4],
  [4, 0],
  [0, 2],
  [1, 5],
];

type Proj = { sx: number; sy: number; z: number };

function project(latDeg: number, lonDeg: number, phi: number): Proj {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const x = Math.cos(lat) * Math.cos(lon);
  const y = Math.sin(lat);
  const z = -Math.cos(lat) * Math.sin(lon);
  const p = phi + PHI_OFFSET;
  const x1 = x * Math.cos(p) + z * Math.sin(p);
  const z1 = -x * Math.sin(p) + z * Math.cos(p);
  const y2 = y * Math.cos(THETA) - z1 * Math.sin(THETA);
  const z2 = y * Math.sin(THETA) + z1 * Math.cos(THETA);
  return { sx: 50 + x1 * R, sy: 50 - y2 * R, z: z2 };
}

function arcPath(a: Proj, b: Proj): string {
  const mx = (a.sx + b.sx) / 2;
  const my = (a.sy + b.sy) / 2;
  let dx = mx - 50;
  let dy = my - 50;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const bulge = 9;
  return `M ${a.sx.toFixed(2)} ${a.sy.toFixed(2)} Q ${(mx + dx * bulge).toFixed(2)} ${(my + dy * bulge).toFixed(2)} ${b.sx.toFixed(2)} ${b.sy.toFixed(2)}`;
}

// Per-continent dot colours (assigned by rough lat/lon regions).
function continentColor(lat: number, lon: number): string {
  if (lat < -60) return "#dde4f5"; // Antarctica
  if (lon >= -82 && lon <= -34 && lat >= -56 && lat <= 13) return "#2bffaa"; // S. America — green
  if (lon >= -170 && lon <= -52 && lat >= 7 && lat <= 84) return "#4d9dff"; // N. America — blue
  if (lon >= -26 && lon <= 42 && lat >= 35 && lat <= 72) return "#ffc23d"; // Europe — amber
  if (lon >= -20 && lon <= 52 && lat >= -36 && lat <= 36) return "#ff5e70"; // Africa — coral
  if (lon >= 110 && lon <= 180 && lat >= -50 && lat <= 0) return "#ff6fd6"; // Oceania — pink
  if (lon >= 26 && lat >= -10) return "#b07cff"; // Asia — violet
  return "#9fabce";
}

export function Globe({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<(HTMLDivElement | null)[]>([]);
  const pathRefs = useRef<(SVGPathElement | null)[]>([]);
  const phiRef = useRef(0);

  // dotted globe — owns the rotation (writes phiRef)
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let dots: { X: number; Y: number; Z: number; c: string }[] = [];
    let cssSize = 0;
    let dpr = 1;
    let raf = 0;

    const resize = () => {
      cssSize = container.offsetWidth || 1;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cssSize * dpr);
      canvas.height = Math.round(cssSize * dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    // build land dots from the equirectangular mask
    const img = new Image();
    img.onload = () => {
      const mw = 640;
      const mh = 320;
      const off = document.createElement("canvas");
      off.width = mw;
      off.height = mh;
      const octx = off.getContext("2d");
      if (!octx) return;
      octx.drawImage(img, 0, 0, mw, mh);
      const data = octx.getImageData(0, 0, mw, mh).data;
      const isLand = (lat: number, lon: number) => {
        const u = (lon + 180) / 360;
        const v = (90 - lat) / 180;
        const px = Math.min(mw - 1, Math.max(0, Math.floor(u * mw)));
        const py = Math.min(mh - 1, Math.max(0, Math.floor(v * mh)));
        const i = (py * mw + px) * 4;
        return data[i] + data[i + 1] + data[i + 2] < 330; // land = dark
      };
      const N = 13000;
      const ga = Math.PI * (3 - Math.sqrt(5));
      const built: typeof dots = [];
      for (let i = 0; i < N; i++) {
        const yy = 1 - (2 * (i + 0.5)) / N;
        const r = Math.sqrt(Math.max(0, 1 - yy * yy));
        const th = i * ga;
        const xx = r * Math.cos(th);
        const zz = r * Math.sin(th);
        const lat = (Math.asin(yy) * 180) / Math.PI;
        const lon = (Math.atan2(-zz, xx) * 180) / Math.PI;
        if (!isLand(lat, lon)) continue;
        built.push({ X: xx, Y: yy, Z: zz, c: continentColor(lat, lon) });
      }
      dots = built;
      canvas.style.opacity = "1";
    };
    img.src = "/earth-mask.png";

    const cT = Math.cos(THETA);
    const sT = Math.sin(THETA);
    const draw = () => {
      phiRef.current += PHI_SPEED;
      const phi = phiRef.current + PHI_OFFSET;
      const cphi = Math.cos(phi);
      const sphi = Math.sin(phi);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const s = Math.max(1.5, 1.5 * dpr);
      const scale = (R / 100) * cssSize * dpr;
      const cx = 0.5 * cssSize * dpr;
      const cy = 0.5 * cssSize * dpr;
      for (let k = 0; k < dots.length; k++) {
        const d = dots[k];
        const x1 = d.X * cphi + d.Z * sphi;
        const z1 = -d.X * sphi + d.Z * cphi;
        const y2 = d.Y * cT - z1 * sT;
        const z2 = d.Y * sT + z1 * cT;
        if (z2 <= 0) continue;
        const px = cx + x1 * scale;
        const py = cy - y2 * scale;
        ctx.globalAlpha = Math.min(1, z2 * 0.85 + 0.5);
        ctx.fillStyle = d.c;
        ctx.fillRect(px - s, py - s, s * 2, s * 2);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // overlay — logos + arcs follow the same projection
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const container = containerRef.current;
      if (container) {
        const size = container.offsetWidth;
        const phi = phiRef.current;
        const proj = NODES.map((n) => project(n.lat, n.lon, phi));

        proj.forEach((p, idx) => {
          const el = nodeRefs.current[idx];
          if (!el) return;
          const px = (p.sx / 100) * size;
          const py = (p.sy / 100) * size;
          const z = Math.max(0, p.z);
          const a = (Math.atan2(p.sy - 50, p.sx - 50) * 180) / Math.PI;
          el.style.transform =
            `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) ` +
            `rotate(${a.toFixed(1)}deg) scale(${z.toFixed(3)}, 1) rotate(${(-a).toFixed(1)}deg) ` +
            `translate(-50%, -50%)`;
          el.style.opacity = p.z > 0 ? Math.min(1, 0.35 + 0.9 * z).toFixed(2) : "0";
          el.style.filter = `brightness(${(0.45 + 0.55 * z).toFixed(2)})`;
        });

        ARCS.forEach(([i, j], k) => {
          const path = pathRefs.current[k];
          if (!path) return;
          const a = proj[i];
          const b = proj[j];
          if (a.z > 0.05 && b.z > 0.05) {
            path.setAttribute("d", arcPath(a, b));
            path.style.opacity = Math.min(0.95, 0.7 * Math.min(a.z, b.z) + 0.45).toFixed(2);
          } else {
            path.style.opacity = "0";
          }
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", opacity: 0, transition: "opacity 0.8s ease" }}
      />

      {/* connecting arcs (redrawn each frame) */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden
      >
        {ARCS.map((_, k) => (
          <path
            key={k}
            ref={(el) => {
              pathRefs.current[k] = el;
            }}
            fill="none"
            stroke="#ffffff"
            strokeWidth={0.3}
            strokeLinecap="round"
            opacity={0}
            strokeDasharray="2 3"
            style={{ animation: "arcFlow 2.6s linear infinite", animationDelay: `${(k % 5) * 0.3}s` }}
          />
        ))}
      </svg>

      {/* logo nodes — wrap the sphere */}
      <div className="pointer-events-none absolute inset-0">
        {NODES.map((n, idx) => (
          <div
            key={n.sym}
            ref={(el) => {
              nodeRefs.current[idx] = el;
            }}
            className="absolute left-0 top-0 will-change-transform"
            style={{ opacity: 0, transformOrigin: "0 0" }}
          >
            <div className="relative h-12 w-12 overflow-hidden rounded-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/logos/${n.sym.toLowerCase()}.svg`}
                alt={n.sym}
                className="h-full w-full object-cover"
              />
              <span className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_12px_rgba(0,0,0,0.65)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
