import type { Config } from "tailwindcss";

/**
 * Parvalon design system.
 * Warm paper canvas, black primary, white cards, a red→orange→blue accent
 * gradient, Hanken Grotesk + JetBrains Mono. Legacy ink/brand/money/line tokens
 * are kept (remapped onto the new palette) for the existing dApp components.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // — new Parvalon palette —
        primary: "rgb(var(--primary) / <alpha-value>)",
        "on-primary": "rgb(var(--on-primary) / <alpha-value>)",
        accent: {
          red: "rgb(var(--accent-red) / <alpha-value>)",
          orange: "rgb(var(--accent-orange) / <alpha-value>)",
          blue: "rgb(var(--accent-blue) / <alpha-value>)",
        },
        "surface-card": "var(--surface-card)",
        "surface-dim": "var(--surface-dim)",
        "inverse-surface": "var(--inverse-surface)",
        "border-subtle": "var(--border-subtle)",

        // — surface / ink / brand / money (legacy + dApp components) —
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
      backgroundImage: {
        "gradient-pulse": "linear-gradient(135deg, #ff4f5e 0%, #ff8e3c 50%, #508cff 100%)",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      letterSpacing: {
        kicker: "0.14em",
      },
      boxShadow: {
        card: "0 1px 2px rgba(0, 0, 0, 0.04)",
        lift: "0 10px 30px -12px rgba(0, 0, 0, 0.18)",
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
