import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["core/**/*.test.ts", "tests/**/*.test.ts"],
    // DB and lint subprocess tests need headroom.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Run files serially so the single throwaway Postgres database is not
    // mutated by two suites at once (keeps Test D deterministic).
    fileParallelism: false,
  },
});
