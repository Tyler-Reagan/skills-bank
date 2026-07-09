import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only pure-logic suites for now (no DOM). Renderer component tests
    // would need jsdom + a heavier setup; deliberately out of scope until
    // there's a reason to add them.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
