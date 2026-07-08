import { describe, expect, test } from "vitest";
import { diffManifests } from "../diff.js";
import { MANIFEST_SCHEMA_VERSION } from "../manifest.js";
import type { RegistryManifest, ManifestSkill } from "../manifest.js";

function makeManifest(skills: Partial<ManifestSkill>[]): RegistryManifest {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    skills: skills.map((s) => ({
      name: "unnamed",
      origin: { url: null },
      tags: [],
      category: null,
      ...s,
    })) as ManifestSkill[],
  };
}

describe("diffManifests", () => {
  test("empty vs empty → all zeroes", () => {
    const diff = diffManifests(makeManifest([]), makeManifest([]));
    expect(diff).toEqual({
      added: [],
      removed: [],
      changed: [],
      unchanged: [],
    });
  });

  test("source has a skill target lacks → added", () => {
    const diff = diffManifests(
      makeManifest([{ name: "alpha" }]),
      makeManifest([]),
    );
    expect(diff.added).toEqual(["alpha"]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.unchanged).toEqual([]);
  });

  test("target has a skill source lacks → removed", () => {
    const diff = diffManifests(
      makeManifest([]),
      makeManifest([{ name: "beta" }]),
    );
    expect(diff.removed).toEqual(["beta"]);
    expect(diff.added).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.unchanged).toEqual([]);
  });

  test("identical skill in both → unchanged names", () => {
    const diff = diffManifests(
      makeManifest([{ name: "gamma" }]),
      makeManifest([{ name: "gamma" }]),
    );
    expect(diff.unchanged).toEqual(["gamma"]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
  });

  test("same name but different tags → changed", () => {
    const diff = diffManifests(
      makeManifest([{ name: "delta", tags: ["new-tag"] }]),
      makeManifest([{ name: "delta", tags: [] }]),
    );
    expect(diff.changed).toEqual(["delta"]);
    expect(diff.unchanged).toEqual([]);
  });

  test("same name but different category → changed", () => {
    const diff = diffManifests(
      makeManifest([{ name: "epsilon", category: "frontend" }]),
      makeManifest([{ name: "epsilon", category: null }]),
    );
    expect(diff.changed).toEqual(["epsilon"]);
  });

  test("origins differing only in hash → unchanged (F2: hash excluded)", () => {
    const diff = diffManifests(
      makeManifest([
        {
          name: "zeta",
          origin: {
            url: "https://github.com/o/r",
            skillPath: "skills/zeta/SKILL.md",
            hash: "aaaa",
          },
        },
      ]),
      makeManifest([
        {
          name: "zeta",
          origin: {
            url: "https://github.com/o/r",
            skillPath: "skills/zeta/SKILL.md",
          },
        },
      ]),
    );
    expect(diff.unchanged).toEqual(["zeta"]);
    expect(diff.changed).toEqual([]);
  });

  test("same url but different skillPath → changed (identity still compared)", () => {
    const diff = diffManifests(
      makeManifest([
        {
          name: "eta",
          origin: { url: "https://github.com/o/r", skillPath: "a/SKILL.md" },
        },
      ]),
      makeManifest([
        {
          name: "eta",
          origin: { url: "https://github.com/o/r", skillPath: "b/SKILL.md" },
        },
      ]),
    );
    expect(diff.changed).toEqual(["eta"]);
  });

  test("mixed: added + removed + changed + unchanged", () => {
    const source = makeManifest([
      { name: "keep" },
      { name: "modify", tags: ["updated"] },
      { name: "new-one" },
    ]);
    const target = makeManifest([
      { name: "keep" },
      { name: "modify", tags: [] },
      { name: "old-one" },
    ]);
    const diff = diffManifests(source, target);
    expect(diff.added).toEqual(["new-one"]);
    expect(diff.removed).toEqual(["old-one"]);
    expect(diff.changed).toEqual(["modify"]);
    expect(diff.unchanged).toEqual(["keep"]);
  });

  test("export preview convention: diffManifests(local, remote) describes remote changes", () => {
    const local = makeManifest([{ name: "skill-a" }, { name: "skill-b" }]);
    const remote = makeManifest([{ name: "skill-a" }]);
    const diff = diffManifests(local, remote);
    // "skill-b" would be added to remote
    expect(diff.added).toEqual(["skill-b"]);
  });

  test("pull preview convention: diffManifests(remote, local) describes local changes", () => {
    const remote = makeManifest([{ name: "skill-a" }, { name: "skill-c" }]);
    const local = makeManifest([{ name: "skill-a" }]);
    const diff = diffManifests(remote, local);
    // "skill-c" would be added to local
    expect(diff.added).toEqual(["skill-c"]);
  });
});
