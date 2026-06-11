"use client";

import { useEffect, useRef } from "react";

/**
 * Animated 3D perspective grid that undulates as a smooth traveling wave —
 * the hero backdrop. Pure canvas + requestAnimationFrame (no deps). Pauses when
 * off-screen and renders a single static frame when the user prefers reduced motion.
 */
export function WaveGrid() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = ref.current;
    const parentEl = el?.parentElement;
    if (!el || !parentEl) return;
    const g = el.getContext("2d");
    if (!g) return;

    // Non-null aliases so nested closures keep the narrowed types.
    const cv = el;
    const parent = parentEl;
    const ctx = g;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let w = 0;
    let h = 0;
    let raf = 0;
    let visible = true;

    function resize() {
      w = parent.clientWidth;
      h = parent.clientHeight;
      cv.width = Math.max(1, Math.floor(w * dpr));
      cv.height = Math.max(1, Math.floor(h * dpr));
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();

    // Grid resolution.
    const COLS = 44; // left ↔ right
    const ROWS = 30; // far → near (depth)

    // Project a normalized grid vertex into the perspective "floor".
    //   gx ∈ [-1,1] across, gz ∈ [0,1] depth (0 = far horizon, 1 = near/bottom)
    function project(gx: number, gz: number, t: number) {
      // Traveling wave: phase advances with depth + a slight diagonal across.
      const phase = gz * 6.0 + gx * 1.4 - t;
      const wave = Math.sin(phase) + 0.35 * Math.sin(phase * 0.5 + gx * 2.0);

      const depth = 0.16 + 0.84 * gz; // near rows are wider/closer
      const horizon = h * 0.26;
      const floorY = horizon + (h * 0.92 - horizon) * Math.pow(gz, 1.7);

      const amp = h * 0.08 * depth;
      const sx = w / 2 + gx * (w * 0.72) * depth;
      const sy = floorY - wave * amp;
      return { sx, sy, depth, wave };
    }

    function draw(time: number) {
      const t = reduce ? 1.2 : time * 0.00085;
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1;

      // Horizontal lines (constant depth) — the lime wave crests.
      for (let r = 0; r <= ROWS; r++) {
        const gz = r / ROWS;
        ctx.beginPath();
        let peak = 0;
        for (let c = 0; c <= COLS; c++) {
          const gx = (c / COLS) * 2 - 1;
          const p = project(gx, gz, t);
          peak = Math.max(peak, p.wave);
          if (c === 0) ctx.moveTo(p.sx, p.sy);
          else ctx.lineTo(p.sx, p.sy);
        }
        // Far lines fade out; crests glow brighter.
        const base = 0.05 + gz * 0.28;
        const a = Math.min(0.6, base + Math.max(0, peak) * 0.14 * gz);
        ctx.strokeStyle = `rgba(198,248,78,${a})`;
        ctx.shadowBlur = peak > 0.7 ? 6 : 0;
        ctx.shadowColor = "rgba(198,248,78,0.6)";
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Vertical lines (constant column) — faint structural rails.
      for (let c = 0; c <= COLS; c += 1) {
        const gx = (c / COLS) * 2 - 1;
        ctx.beginPath();
        for (let r = 0; r <= ROWS; r++) {
          const gz = r / ROWS;
          const p = project(gx, gz, t);
          if (r === 0) ctx.moveTo(p.sx, p.sy);
          else ctx.lineTo(p.sx, p.sy);
        }
        ctx.strokeStyle = "rgba(231,233,234,0.045)";
        ctx.stroke();
      }

      if (!reduce && visible) raf = requestAnimationFrame(draw);
    }

    const ro = new ResizeObserver(() => {
      resize();
      if (reduce) draw(0);
    });
    ro.observe(parent);

    // Pause the loop when the hero scrolls out of view.
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        if (visible && !reduce) {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(draw);
        }
      },
      { threshold: 0 },
    );
    io.observe(parent);

    if (reduce) draw(0);
    else raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />;
}
