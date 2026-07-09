import { describe, expect, test } from "vitest";
import type { AgentId, InstalledSkill } from "@skills-bank/core";
import { aggregateByName } from "./installedGrouping.js";

function inst(
  name: string,
  agent: AgentId,
  kind: InstalledSkill["kind"],
  over: Partial<InstalledSkill> = {},
): InstalledSkill {
  return {
    name,
    agent,
    linkPath: `/home/u/.${agent}/skills/${name}`,
    target: kind === "ours" ? `/reg/skills/${name}` : null,
    kind,
    ...over,
  };
}

describe("aggregateByName", () => {
  test("dedupes the same skill across agent dirs into one group with both agent chips", () => {
    const groups = aggregateByName([
      inst("x", "claude", "ours"),
      inst("x", "cursor", "ours"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.agents).toEqual(["claude", "cursor"]);
    expect(groups[0]!.kind).toBe("ours");
    expect(groups[0]!.conflicts).toEqual([]);
  });

  test("upgrades a group to ours even when the ours install is seen AFTER a straggler", () => {
    // Regression: the old "first-encountered, only downgrades" logic
    // stranded a registered skill in Not-Registered when a leftover
    // real-dir was encountered first.
    const groups = aggregateByName([
      inst("x", "cursor", "real-directory"),
      inst("x", "claude", "ours"),
    ]);
    expect(groups[0]!.kind).toBe("ours");
    // The straggler is still tracked as a conflict.
    expect(groups[0]!.conflicts.map((c) => c.agent)).toEqual(["cursor"]);
  });

  test("among non-ours stragglers, the representative is the highest-ranked kind (real-directory > foreign-symlink > broken-symlink)", () => {
    const groups = aggregateByName([
      inst("x", "cursor", "broken-symlink"),
      inst("x", "claude", "foreign-symlink"),
      inst("x", "gemini", "real-directory"),
    ]);
    expect(groups[0]!.kind).toBe("real-directory");
    expect(groups[0]!.representative.agent).toBe("gemini");
    // All three are non-ours, so all three are conflicts.
    expect(groups[0]!.conflicts).toHaveLength(3);
  });

  test("a lower-ranked straggler seen after a higher-ranked one does not demote the representative", () => {
    const groups = aggregateByName([
      inst("x", "gemini", "real-directory"),
      inst("x", "cursor", "broken-symlink"),
    ]);
    expect(groups[0]!.kind).toBe("real-directory");
    expect(groups[0]!.representative.agent).toBe("gemini");
  });

  test("sorts groups by name", () => {
    const groups = aggregateByName([
      inst("zebra", "claude", "ours"),
      inst("apple", "claude", "ours"),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["apple", "zebra"]);
  });
});
