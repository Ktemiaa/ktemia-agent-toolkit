import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { ktemia: fileURLToPath(new URL("./packages/ktemia/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["test/live/**/*.test.ts"],
    // Reads .env from the repo root without a dotenv dependency.
    env: loadEnv("", process.cwd(), ""),
    testTimeout: 180_000,
  },
});
