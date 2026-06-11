import type { Config } from "tailwindcss";

/**
 * "Dark Institutional Onchain" design system.
 * Deep graphite canvas, a single luminous lime accent, hairline grids, and
 * monospace data — an institutional on-chain terminal for corporate actions.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "var(--surface)",
          raised: "var(--surface-raised)",
          inset: "var(--surface-inset)",
        },
        ink: {
          DEFAULT: "var(--ink)",
          soft: "var(--ink-soft)",
          faint: "var(--ink-faint)",
        },
        lime: {
          DEFAULT: "var(--lime)",
          bright: "var(--lime-bright)",
          dim: "var(--lime-dim)",
          wash: "var(--lime-wash)",
        },
        signal: "var(--signal)",
        danger: "var(--danger)",
        line: "var(--line)",
        "line-strong": "var(--line-strong)",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.04em",
        kicker: "0.2em",
      },
      boxShadow: {
        panel: "0 1px 0 rgba(255,255,255,0.03) inset, 0 24px 60px -32px rgba(0,0,0,0.8)",
        lift: "0 18px 48px -24px rgba(0,0,0,0.7)",
        inset: "inset 0 0 0 1px var(--line)",
        glow: "0 0 0 1px rgba(198,248,78,0.35), 0 0 30px -8px rgba(198,248,78,0.5)",
      },
      keyframes: {
        ticker: { from: { transform: "translateX(0)" }, to: { transform: "translateX(-50%)" } },
        rise: {
          from: { opacity: "0", transform: "translateY(14px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        seal: {
          "0%": { transform: "scale(0.6)", opacity: "0" },
          "60%": { transform: "scale(1.08)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "pulse-glow": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
      },
      animation: {
        ticker: "ticker 60s linear infinite",
        rise: "rise 0.7s cubic-bezier(0.2,0.7,0.2,1) both",
        seal: "seal 0.6s cubic-bezier(0.2,0.8,0.2,1) both",
        shimmer: "shimmer 1.6s infinite",
        "pulse-glow": "pulse-glow 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
