import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests live beside source as *.test.ts.
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
    // The parity test reads ../../../deployments/proofs-31337-1.json via __dirname.
    testTimeout: 20_000,
  },
});
