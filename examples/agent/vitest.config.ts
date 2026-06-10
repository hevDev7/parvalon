import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests live under test/ as *.test.ts.
    include: ["test/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
