import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests live beside source as *.test.ts.
    include: ["src/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 20_000,
  },
});
