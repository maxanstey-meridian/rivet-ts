import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    // Scaffold, pack and interop tests run tsc, pnpm and the Rivet binary; the
    // first interop run also downloads the pinned Rivet release in a hook.
    testTimeout: 120_000,
    hookTimeout: 300_000,
    typecheck: {
      enabled: true,
      include: ["tests/**/*.test-d.ts"],
    },
  },
});
