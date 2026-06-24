import { describe, expect, it } from "vitest";
import {
  applySkillLabel,
  categories,
  categoryDisplayName,
  clearSkillLabel,
  effectiveLabels,
} from "../labels.js";

describe("categories", () => {
  it("has 21 entries", () => {
    expect(categories).toHaveLength(21);
  });

  it("every entry has a non-empty slug and display", () => {
    for (const c of categories) {
      expect(c.slug.length).toBeGreaterThan(0);
      expect(c.display.length).toBeGreaterThan(0);
    }
  });

  it("every slug follows the meta:function pattern", () => {
    for (const c of categories) {
      expect(c.slug).toMatch(/^[a-z]+:[a-z][a-z-]*$/);
    }
  });
});

describe("categoryDisplayName", () => {
  it("returns the display name for a known slug", () => {
    expect(categoryDisplayName("engineering:ci-cd-deployment")).toBe(
      "Engineering: CI/CD & Deployment",
    );
    expect(categoryDisplayName("productivity:knowledge-management")).toBe(
      "Productivity: Knowledge Management",
    );
    expect(categoryDisplayName("engineering:library-api-reference")).toBe(
      "Engineering: Library & API Reference",
    );
  });

  it("falls back gracefully for legacy flat slugs", () => {
    expect(categoryDisplayName("frontend")).toBe("Frontend");
    expect(categoryDisplayName("ai-tooling")).toBe("AI Tooling");
    expect(categoryDisplayName("dx")).toBe("DX");
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
