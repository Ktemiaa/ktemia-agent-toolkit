import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Test against the sources, and make the adapter use the same copy of the core.
    alias: { ktemia: fileURLToPath(new URL("./packages/ktemia/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/live/**"],
  },
});
