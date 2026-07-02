import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@fairy/protocol": fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url))
    }
  },
  test: {
    testTimeout: 30000
  }
});
