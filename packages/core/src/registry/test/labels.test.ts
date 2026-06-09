import { describe, expect, it } from "vitest";
import {
  applySkillLabel,
  clearSkillLabel,
  deriveLabels,
  effectiveLabels,
} from "../labels.js";

describe("deriveLabels", () => {
  it("returns expected category + tags for a react skill", () => {
    const result = deriveLabels({
      name: "react-best-practices",
      description: "React component patterns and TypeScript best practices",
    });
    expect(result.category).toBe("frontend");
    expect(result.tags).toContain("react");
    expect(result.tags).toContain("typescript");
  });

  it("returns expected category + tags for a git skill", () => {
    const result = deriveLabels({
      name: "pr-description",
      description: "Generate pull request descriptions for GitHub PRs",
    });
    expect(result.category).toBe("git");
    expect(result.tags).toContain("github");
  });

  it("returns review tag for a code-review skill", () => {
    const result = deriveLabels({
      name: "code-review",
      description: "Automated code review and audit for pull requests",
    });
    expect(result.tags).toContain("review");
  });

  it("returns hardware category for an embedded firmware skill", () => {
    const result = deriveLabels({
      name: "arduino-starter",
      description:
        "Arduino microcontroller firmware and embedded systems helper",
    });
    expect(result.category).toBe("hardware");
  });

  it("returns category: null when no rule matches", () => {
    const result = deriveLabels({
      name: "my-obscure-skill",
      description: "Does something completely unique with no matching keywords",
    });
    expect(result.category).toBeNull();
  });

  it("returns empty tags when no tag rules match", () => {
    const result = deriveLabels({
      name: "my-obscure-skill",
      description: "Does something completely unique with no matching keywords",
    });
    expect(result.tags).toEqual([]);
  });

  it("first-match wins for category", () => {
    // "react" matches frontend before any later rule
    const result = deriveLabels({
      name: "react-testing",
      description: "Testing React components",
    });
    expect(result.category).toBe("frontend");
  });
});

describe("effectiveLabels", () => {
  const derived = {
    category: "frontend" as string | null,
    tags: ["react", "typescript", "ui"],
  };

  it("returns derived when no override", () => {
    expect(effectiveLabels(derived)).toEqual(derived);
  });

  it("user category wins over derived", () => {
    const result = effectiveLabels(derived, { category: "dx" });
    expect(result.category).toBe("dx");
  });

  it("null category override explicitly uncategorizes", () => {
    const result = effectiveLabels(derived, { category: null });
    expect(result.category).toBeNull();
  });

  it("tags unioned with derived set", () => {
    const result = effectiveLabels(derived, { tags: ["mcp"] });
    expect(result.tags).toContain("mcp");
    expect(result.tags).toContain("react");
  });

  it("tags not duplicated if already in derived", () => {
    const result = effectiveLabels(derived, { tags: ["react"] });
    expect(result.tags.filter((t) => t === "react")).toHaveLength(1);
  });
});

describe("applySkillLabel / clearSkillLabel (pure)", () => {
  it("patch-merges into an existing entry without mutating the input", () => {
    const map = { foo: { category: "dx", tags: ["a"] } };
    const next = applySkillLabel(map, "foo", { tags: ["b"] });
    expect(next.foo).toEqual({ category: "dx", tags: ["b"] });
    expect(map.foo.tags).toEqual(["a"]); // input untouched
  });

  it("creates an entry for a new skill", () => {
    expect(applySkillLabel({}, "bar", { category: "ai" })).toEqual({
      bar: { category: "ai" },
    });
  });

  it("clear removes the entry immutably; no-op for an absent name", () => {
    const map = { foo: { category: "dx" } };
    expect(clearSkillLabel(map, "foo")).toEqual({});
    expect(map.foo).toEqual({ category: "dx" });
    expect(clearSkillLabel(map, "missing")).toBe(map);
  });

  it("bulk update is a fold of applySkillLabel", () => {
    const updates = { a: { category: "x" }, b: { tags: ["t"] } };
    let data: Record<string, { category?: string | null; tags?: string[] }> =
      {};
    for (const [name, patch] of Object.entries(updates)) {
      data = applySkillLabel(data, name, patch);
    }
    expect(data).toEqual(updates);
  });
});
