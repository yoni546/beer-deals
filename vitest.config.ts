import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Applying every migration to a fresh in-memory Postgres is not fast.
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
