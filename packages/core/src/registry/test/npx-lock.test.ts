import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adoptableNpxSkills, readNpxLock, type NpxLock } from "../npx-lock.js";

/**
 * The lockfile shape npx writes (vercel-labs/skills, version 3): a
 * top-level `skills` map keyed by skill name. These fixtures cover the
 * discriminating cases the Discover computation and the origin mapping
 * care about — a real GitHub source, a GitLab (non-GitHub) source, and a
 * genuinely-local entry with no upstream.
 */
const FIXTURE: NpxLock = {
  "code-review": {
    sourceType: "github",
    sourceUrl: "https://github.com/acme/skills",
    skillPath: "skills/engineering/code-review",
    skillFolderHash: "abc123",
    ref: "main",
  },
  "gitlab-skill": {
    sourceType: "git",
    sourceUrl: "https://gitlab.com/acme/skills",
    skillPath: "skills/gitlab-skill",
  },
  "local-only": {
    sourceType: "local",
    source: "/Users/me/dev/local-only",
  },
};

// Every fixture skill is present on disk unless a test says otherwise, so the
// existing registered/origin cases exercise those axes in isolation.
const ALL_ON_DISK = Object.keys(FIXTURE);

describe("adoptableNpxSkills", () => {
  test("returns npx skills whose name is not already in the registry", () => {
    const result = adoptableNpxSkills(FIXTURE, ["code-review"], ALL_ON_DISK);
    // code-review is registered → excluded; the other two remain.
    expect(result.map((s) => s.name)).toEqual(["gitlab-skill", "local-only"]);
  });

  test("excludes a lockfile entry that is not present on disk", () => {
    // gitlab-skill is in the lockfile but missing on disk (stale row) → it
    // must not be surfaced, since adoption would fail "no installed skill".
    const result = adoptableNpxSkills(
      FIXTURE,
      [],
      ["code-review", "local-only"],
    );
    expect(result.map((s) => s.name)).toEqual(["code-review", "local-only"]);
  });

  test("excludes every npx skill when all are already registered", () => {
    const result = adoptableNpxSkills(
      FIXTURE,
      ["code-review", "gitlab-skill", "local-only"],
      ALL_ON_DISK,
    );
    expect(result).toEqual([]);
  });

  test("maps a GitHub source to a full origin row", () => {
    const result = adoptableNpxSkills(
      FIXTURE,
      ["gitlab-skill", "local-only"],
      ALL_ON_DISK,
    );
    expect(result).toEqual([
      {
        name: "code-review",
        origin: {
          url: "https://github.com/acme/skills",
          skillPath: "skills/engineering/code-review",
          hash: "abc123",
        },
      },
    ]);
  });

  test("adopts a non-GitHub (GitLab) source rather than filtering it out", () => {
    const result = adoptableNpxSkills(
      FIXTURE,
      ["code-review", "local-only"],
      ALL_ON_DISK,
    );
    expect(result).toEqual([
      {
        name: "gitlab-skill",
        origin: {
          url: "https://gitlab.com/acme/skills",
          skillPath: "skills/gitlab-skill",
        },
      },
    ]);
  });

  test("a local entry is still adoptable but carries a null origin", () => {
    const result = adoptableNpxSkills(
      FIXTURE,
      ["code-review", "gitlab-skill"],
      ALL_ON_DISK,
    );
    expect(result).toEqual([{ name: "local-only", origin: null }]);
  });

  test("empty lockfile yields nothing", () => {
    expect(adoptableNpxSkills({}, ["code-review"], ALL_ON_DISK)).toEqual([]);
  });

  test("result is sorted by name for stable rendering", () => {
    const unordered: NpxLock = {
      zebra: { sourceType: "github", sourceUrl: "https://github.com/a/z" },
      alpha: { sourceType: "github", sourceUrl: "https://github.com/a/a" },
    };
    expect(
      adoptableNpxSkills(unordered, [], ["alpha", "zebra"]).map((s) => s.name),
    ).toEqual(["alpha", "zebra"]);
  });
});

describe("readNpxLock", () => {
  test("returns {} when the lockfile is absent", () => {
    expect(
      readNpxLock(path.join(os.tmpdir(), "does-not-exist-lock.json")),
    ).toEqual({});
  });

  test("reads and parses the skills map from a fixture path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "npx-lock-"));
    const lockPath = path.join(dir, ".skill-lock.json");
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ version: 3, skills: FIXTURE }),
      "utf8",
    );
    try {
      expect(readNpxLock(lockPath)).toEqual(FIXTURE);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns {} on malformed JSON", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "npx-lock-"));
    const lockPath = path.join(dir, ".skill-lock.json");
    fs.writeFileSync(lockPath, "{ not json", "utf8");
    try {
      expect(readNpxLock(lockPath)).toEqual({});
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
