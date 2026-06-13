import type { Config } from "tailwindcss";

/**
 * "The Registrar" design system.
 * Warm paper canvas, near-black ink, one deep cobalt accent, ledger green
 * reserved for money, hairline rules, serif display and monospaced numerals —
 * a fund prospectus, not a crypto landing page.
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
        "on-ink": "var(--on-ink)",
        brand: {
          DEFAULT: "var(--brand)",
          deep: "var(--brand-deep)",
          wash: "var(--brand-wash)",
        },
        money: {
          DEFAULT: "var(--money)",
          wash: "var(--money-wash)",
        },
        signal: {
          DEFAULT: "var(--signal)",
          wash: "var(--signal-wash)",
        },
        danger: {
          DEFAULT: "var(--danger)",
          wash: "var(--danger-wash)",
        },
        line: "var(--line)",
        "line-strong": "var(--line-strong)",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        kicker: "0.14em",
      },
      boxShadow: {
        card: "0 1px 2px rgba(21, 25, 29, 0.05)",
        lift: "0 10px 30px -12px rgba(21, 25, 29, 0.18)",
        inset: "inset 0 0 0 1px var(--line)",
      },
      keyframes: {
        rise: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        seal: {
          from: { transform: "scale(0.92)", opacity: "0" },
          to: { transform: "scale(1)", opacity: "1" },
        },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        rise: "rise 0.4s ease-out both",
        seal: "seal 0.25s ease-out both",
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
