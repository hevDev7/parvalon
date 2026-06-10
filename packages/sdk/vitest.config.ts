import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests live beside source as *.test.ts.
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
    // The proofs parity test reads ../../../deployments/proofs-31337-1.json via import.meta.url.
    testTimeout: 20_000,
  },
});
