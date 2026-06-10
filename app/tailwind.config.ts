import type { Config } from "tailwindcss";

/**
 * "The Engraved Ledger" design system.
 * Corporate actions are the modern descendant of engraved stock certificates and
 * transfer-agent ledgers — so the palette is warm ivory paper, deep warm ink, a
 * confident viridian for money/claims, and a brass hairline for certificate detail.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: "var(--paper)",
          deep: "var(--paper-deep)",
          panel: "var(--paper-panel)",
        },
        ink: {
          DEFAULT: "var(--ink)",
          soft: "var(--ink-soft)",
          faint: "var(--ink-faint)",
        },
        viridian: {
          DEFAULT: "var(--viridian)",
          bright: "var(--viridian-bright)",
          wash: "var(--viridian-wash)",
        },
        brass: {
          DEFAULT: "var(--brass)",
          soft: "var(--brass-soft)",
        },
        oxblood: "var(--oxblood)",
        line: "var(--line)",
        "line-strong": "var(--line-strong)",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.04em",
        kicker: "0.22em",
      },
      boxShadow: {
        certificate: "0 1px 0 rgba(20,22,15,0.04), 0 24px 60px -28px rgba(20,22,15,0.28)",
        "lift": "0 18px 48px -24px rgba(20,22,15,0.30)",
        inset: "inset 0 0 0 1px var(--line)",
      },
      keyframes: {
        "ticker": { from: { transform: "translateX(0)" }, to: { transform: "translateX(-50%)" } },
        "rise": { from: { opacity: "0", transform: "translateY(14px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "seal": {
          "0%": { transform: "scale(0.6) rotate(-8deg)", opacity: "0" },
          "60%": { transform: "scale(1.06) rotate(2deg)", opacity: "1" },
          "100%": { transform: "scale(1) rotate(0deg)", opacity: "1" },
        },
        "shimmer": { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        ticker: "ticker 60s linear infinite",
        rise: "rise 0.7s cubic-bezier(0.2,0.7,0.2,1) both",
        seal: "seal 0.6s cubic-bezier(0.2,0.8,0.2,1) both",
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
