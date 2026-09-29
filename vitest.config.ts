import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig says `"jsx": "preserve"` (Next compiles JSX itself); component tests
  // need it compiled.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // *.spec.ts under tests/e2e belongs to Playwright, not vitest.
    include: ["tests/**/*.test.{ts,tsx}"],
    // Applying every migration to a fresh in-memory Postgres is not fast.
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
