import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // One sandbox node per file, and each file runs alone, so ports and CPU stay predictable.
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 240_000,
  },
});
