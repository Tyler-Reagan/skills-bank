import { describe, expect, test } from "vitest";

// Sanity test — proves the vitest rig loads ESM TypeScript from
// packages/core under pnpm + Node 22. Delete when the first real
// suite (hashSkillFolder) lands.
describe("smoke", () => {
  test("vitest can import from src and run", () => {
    expect(1 + 1).toBe(2);
  });
});
