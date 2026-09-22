import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // One shared database per test file, mutated only inside rolled-back
    // transactions — safe, but not written to defend against concurrent
    // file-level access, so keep RLS test files running one at a time.
    fileParallelism: false,
  },
});
