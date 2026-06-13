import type { CSSProperties } from "react";

/**
 * An atmospheric, fully animated night skyline — pure SVG + CSS keyframes, no JS.
 * The moon rises slowly, city windows flicker on/off, stars twinkle, and small
 * boats drift across the reflective water. All values are deterministic so the
 * server and client render identically (no hydration mismatch); motion is
 * automatically stilled under `prefers-reduced-motion` via globals.css.
 */

const WATERLINE = 565;

type Building = { x: number; w: number; y: number; cols: number; rows: number };
const BUILDINGS: Building[] = [
  { x: 8, w: 74, y: 372, cols: 3, rows: 9 },
  { x: 92, w: 50, y: 300, cols: 2, rows: 11 },
  { x: 152, w: 88, y: 240, cols: 4, rows: 13 },
  { x: 250, w: 58, y: 338, cols: 3, rows: 10 },
  { x: 318, w: 100, y: 196, cols: 4, rows: 15 },
  { x: 428, w: 56, y: 326, cols: 3, rows: 10 },
  { x: 494, w: 96, y: 282, cols: 4, rows: 12 },
];

type Win = { x: number; y: number; w: number; h: number; fill: string; on: number; flicker: boolean; dur: number; delay: number };

function buildWindows(): Win[] {
  const out: Win[] = [];
  BUILDINGS.forEach((b, bi) => {
    const padX = 10;
    const padTop = 16;
    const padBottom = 12;
    const gap = 7;
    const wh = 8;
    const ww = (b.w - padX * 2 - gap * (b.cols - 1)) / b.cols;
    const usableH = WATERLINE - b.y - padTop - padBottom;
    const rowGap = b.rows > 1 ? (usableH - wh * b.rows) / (b.rows - 1) : 0;
    for (let r = 0; r < b.rows; r++) {
      for (let c = 0; c < b.cols; c++) {
        const id = bi * 131 + r * 17 + c * 7;
        const lit = id % 5 !== 0;
        if (!lit && id % 3 !== 0) continue; // leave most unlit windows as bare building
        const accent = lit && id % 13 === 0;
        out.push({
          x: b.x + padX + c * (ww + gap),
          y: b.y + padTop + r * (wh + rowGap),
          w: ww,
          h: wh,
          fill: lit ? (accent ? "#82b4ff" : "#ffce86") : "#0e1626",
          on: lit ? (accent ? 0.9 : 0.8) : 0.22,
          flicker: lit && id % 9 === 0,
          dur: 2.6 + (id % 6) * 0.7,
          delay: (id % 17) * 0.5,
        });
      }
    }
  });
  return out;
}
const WINDOWS = buildWindows();

const STARS = Array.from({ length: 40 }, (_, i) => ({
  x: (i * 71) % 600,
  y: (i * 149) % 350,
  r: i % 5 === 0 ? 1.5 : 0.9,
  twinkle: i % 3 === 0,
  dur: 2 + (i % 5) * 0.8,
  delay: (i % 11) * 0.6,
}));

const REFLECTIONS = [
  { x: 60, w: 16, delay: 0 },
  { x: 200, w: 26, delay: 1.1 },
  { x: 360, w: 34, delay: 0.5 },
  { x: 470, w: 18, delay: 1.8 },
  { x: 530, w: 22, delay: 0.9 },
];

const BOATS = [
  { y: 610, dur: 36, delay: 0, scale: 1 },
  { y: 656, dur: 48, delay: 9, scale: 0.78 },
  { y: 634, dur: 42, delay: 22, scale: 0.62 },
];

export function CityscapeNight({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 600 760"
      className={className}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Animated night skyline: a rising moon, flickering city windows, and boats drifting on the water"
    >
      <defs>
        <linearGradient id="pv-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#06090f" />
          <stop offset="0.5" stopColor="#0a1120" />
          <stop offset="0.76" stopColor="#13233f" />
          <stop offset="1" stopColor="#0c1525" />
        </linearGradient>
        <radialGradient id="pv-moon-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fdf6dc" stopOpacity="0.5" />
          <stop offset="0.4" stopColor="#bcd0ff" stopOpacity="0.16" />
          <stop offset="1" stopColor="#bcd0ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pv-bldg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0d1528" />
          <stop offset="1" stopColor="#05080f" />
        </linearGradient>
        <linearGradient id="pv-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#102441" />
          <stop offset="1" stopColor="#04070d" />
        </linearGradient>
        <radialGradient id="pv-vignette" cx="0.5" cy="0.4" r="0.78">
          <stop offset="0.55" stopColor="#000000" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.5" />
        </radialGradient>
      </defs>

      {/* sky */}
      <rect width="600" height="760" fill="url(#pv-sky)" />

      {/* stars */}
      {STARS.map((s, i) => (
        <circle
          key={`star-${i}`}
          cx={s.x}
          cy={s.y}
          r={s.r}
          fill="#dfe7ff"
          opacity={s.twinkle ? undefined : 0.5}
          style={
            s.twinkle
              ? { animation: `nightTwinkle ${s.dur}s ease-in-out infinite`, animationDelay: `${s.delay}s` }
              : undefined
          }
        />
      ))}

      {/* moon — rises and falls slowly */}
      <g style={{ animation: "moonRise 38s ease-in-out infinite alternate" } as CSSProperties}>
        <circle cx="470" cy="250" r="86" fill="url(#pv-moon-glow)" />
        <circle cx="470" cy="250" r="30" fill="#f5f1e2" />
        <circle cx="460" cy="243" r="29" fill="#0a1120" opacity="0.14" />
      </g>

      {/* buildings */}
      {BUILDINGS.map((b, i) => (
        <rect key={`bldg-${i}`} x={b.x} y={b.y} width={b.w} height={WATERLINE - b.y} fill="url(#pv-bldg)" />
      ))}

      {/* windows */}
      {WINDOWS.map((w, i) => (
        <rect
          key={`win-${i}`}
          x={w.x}
          y={w.y}
          width={w.w}
          height={w.h}
          rx="0.6"
          fill={w.fill}
          opacity={w.on}
          style={
            w.flicker
              ? { animation: `windowFlicker ${w.dur}s steps(1, end) infinite`, animationDelay: `${w.delay}s` }
              : undefined
          }
        />
      ))}

      {/* water */}
      <rect x="0" y={WATERLINE} width="600" height={760 - WATERLINE} fill="url(#pv-water)" />

      {/* light reflections shimmering on the water */}
      {REFLECTIONS.map((r, i) => (
        <rect
          key={`refl-${i}`}
          x={r.x}
          y={WATERLINE}
          width={r.w}
          height="78"
          fill="#ffce86"
          opacity="0.12"
          style={{ animation: `waterShimmer ${5 + i}s ease-in-out infinite`, animationDelay: `${r.delay}s` }}
        />
      ))}
      <rect
        x="0"
        y={WATERLINE + 6}
        width="600"
        height="1.5"
        fill="#bcd0ff"
        opacity="0.12"
        style={{ animation: "waterShimmer 6s ease-in-out infinite" }}
      />

      {/* boats drifting across */}
      {BOATS.map((bt, i) => (
        <g
          key={`boat-${i}`}
          style={{ animation: `boatDrift ${bt.dur}s linear infinite`, animationDelay: `${bt.delay}s` }}
        >
          <g transform={`translate(0 ${bt.y}) scale(${bt.scale})`}>
            <path d="M0 0 H28 L23 8 H5 Z" fill="#0a1020" stroke="#2a3a57" strokeWidth="0.8" strokeLinejoin="round" />
            <rect x="12" y="-9" width="1.6" height="9" fill="#2a3a57" />
            <circle cx="12.8" cy="-10" r="1.6" fill="#ffce86">
              <animate attributeName="opacity" values="0.4;1;0.4" dur="2.6s" repeatCount="indefinite" />
            </circle>
            <ellipse cx="14" cy="11" rx="17" ry="2" fill="#ffce86" opacity="0.1" />
          </g>
        </g>
      ))}

      {/* depth vignette */}
      <rect width="600" height="760" fill="url(#pv-vignette)" />
    </svg>
  );
}
