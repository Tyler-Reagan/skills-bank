import { describe, expect, test } from "vitest";
import { classifySkillForPublish } from "./publish-classify.js";
import type { RegistryEntry } from "./types.js";

const linkedRepo = { fullName: "u/r" };

function entry(over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    name: "alpha",
    description: "test skill",
    path: "skills/personal/alpha",
    source: { source: "user" },
    bucket: "personal",
    ...over,
  };
}

describe("classifySkillForPublish", () => {
  test("no linked repo → not-publishable / no-linked-repo", () => {
    const r = classifySkillForPublish({
      linkedRepo: null,
      entry: entry(),
      publishState: "untracked",
      personalNameInUse: false,
    });
    expect(r).toEqual({
      flow: "not-publishable",
      reason: "no-linked-repo",
    });
  });

  test("missing description → not-publishable / missing-meta-json", () => {
    const r = classifySkillForPublish({
      linkedRepo,
      entry: entry({ description: "" }),
      publishState: "untracked",
      personalNameInUse: false,
    });
    expect(r).toEqual({
      flow: "not-publishable",
      reason: "missing-meta-json",
    });
  });

  test("personal skill, no origin → new flow", () => {
    const r = classifySkillForPublish({
      linkedRepo,
      entry: entry(),
      publishState: "untracked",
      personalNameInUse: false,
    });
    expect(r.flow).toBe("new");
    if (r.flow !== "new") return;
    expect(r.targetPath).toBe("skills/personal/alpha");
    expect(r.defaultPrMeta.title).toMatch(/feat\(personal\): add alpha/);
  });

  test("vendored skill, origin, no drift → safekeeping flow", () => {
    const r = classifySkillForPublish({
      linkedRepo,
      entry: entry({
        bucket: "vendored",
        path: "skills/vendored/alpha",
        source: {
          source: "curated",
          origin: {
            kind: "github",
            repo: "owner/vendor",
            skillPath: "skills/alpha/SKILL.md",
          },
        },
      }),
      publishState: "untracked",
      personalNameInUse: false,
    });
    expect(r.flow).toBe("safekeeping");
    if (r.flow !== "safekeeping") return;
    expect(r.targetPath).toBe("skills/vendored/alpha");
    expect(r.defaultPrMeta.title).toMatch(/vendor alpha from owner\/vendor/);
  });

  test("vendored skill, origin, drift detected → fork flow", () => {
    const r = classifySkillForPublish({
      linkedRepo,
      entry: entry({
        bucket: "vendored",
        path: "skills/vendored/alpha",
        drift: true,
        source: {
          source: "curated",
          origin: {
            kind: "github",
            repo: "owner/vendor",
            skillPath: "skills/alpha/SKILL.md",
          },
        },
      }),
      publishState: "draft",
      personalNameInUse: false,
    });
    expect(r.flow).toBe("fork");
    if (r.flow !== "fork") return;
    expect(r.willCollide).toBe(false);
    expect(r.defaultPrMeta.title).toMatch(/fork alpha from owner\/vendor/);
  });

  test("fork flow + personalNameInUse → willCollide: true + existingPersonalDir surfaced", () => {
    const r = classifySkillForPublish({
      linkedRepo,
      entry: entry({
        bucket: "vendored",
        path: "skills/vendored/alpha",
        drift: true,
        source: {
          source: "curated",
          origin: {
            kind: "github",
            repo: "owner/vendor",
            skillPath: "skills/alpha/SKILL.md",
          },
        },
      }),
      publishState: "draft",
      personalNameInUse: true,
      existingPersonalDir: "/abs/skills/personal/alpha",
    });
    expect(r.flow).toBe("fork");
    if (r.flow !== "fork") return;
    expect(r.willCollide).toBe(true);
    expect(r.existingPersonalDir).toBe("/abs/skills/personal/alpha");
  });

  test("vendored skill WITHOUT origin → new flow (origin is the discriminator)", () => {
    const r = classifySkillForPublish({
      linkedRepo,
      entry: entry({
        bucket: "vendored",
        path: "skills/vendored/alpha",
        source: { source: "curated" },
      }),
      publishState: "untracked",
      personalNameInUse: false,
    });
    expect(r.flow).toBe("new");
  });

  test("personal skill with origin pointer (post-Discover-install) → new flow (bucket gates safekeeping)", () => {
    // Discover-install (Phase 4) lands skills in personal/ with a
    // stamped origin. They're publish-eligible as `new` since the
    // user owns them locally now — fork/safekeeping is the
    // vendored-bucket pattern.
    const r = classifySkillForPublish({
      linkedRepo,
      entry: entry({
        source: {
          source: "user",
          origin: {
            kind: "github",
            repo: "owner/discovered",
            skillPath: "alpha/SKILL.md",
          },
        },
      }),
      publishState: "untracked",
      personalNameInUse: false,
    });
    expect(r.flow).toBe("new");
  });
});
