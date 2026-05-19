import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Tests in this package touch the filesystem (hashSkillFolder,
    // mirrorSkillFolder, the sync primitives). Each suite isolates
    // its scratch space under `os.tmpdir()`; sequential keeps cleanup
    // straightforward, and the suite is small enough that the lost
    // parallelism is invisible.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
