import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reconcileResidentOrigins } from "../reconcile.js";
import {
  readSkillSource,
  writeSkillSource,
  type SkillSource,
} from "../source.js";
import { readRuntimeState, writeRuntimeState } from "../heal.js";
import { buildSkillFolderMap, type GitTreeEntry } from "../../github/origin.js";

const LINKED = "Tyler-Reagan/skills";

let scratch: string;
let registryRoot: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-reconcile-"));
  registryRoot = path.join(scratch, "registry");
  for (const b of ["personal", "vendored"]) {
    fs.mkdirSync(path.join(registryRoot, "skills", b), { recursive: true });
  }
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function writeSkill(
  bucket: "personal" | "vendored",
  name: string,
  src?: SkillSource,
): string {
  const dir = path.join(registryRoot, "skills", bucket, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} description\n---\n`,
  );
  if (src) writeSkillSource(dir, src);
  return dir;
}

describe("reconcileResidentOrigins", () => {
  test("rewrites a resident skill's stale external origin to a self-origin and clears probe failures", () => {
    const dir = writeSkill("personal", "write-a-skill", {
      source: "user",
      origin: {
        kind: "github",
        repo: "mattpocock/skills",
        skillPath: "skills/productivity/write-a-skill/SKILL.md",
        skillFolderHash: "abc123",
        installedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    writeRuntimeState(dir, {
      probeFailureCount: 3,
      lastProbeFailureAt: "2026-06-18T00:00:00.000Z",
      fetchedAt: "2026-05-01T00:00:00.000Z",
    });

    const map = new Map([
      ["write-a-skill", "skills/tools/write-a-skill/SKILL.md"],
    ]);
    const res = reconcileResidentOrigins(registryRoot, map, LINKED);

    expect(res.rewritten).toEqual(["write-a-skill"]);
    const after = readSkillSource(dir);
    expect(after.origin).toEqual({
      kind: "github",
      repo: LINKED,
      skillPath: "skills/tools/write-a-skill/SKILL.md",
      // immutable first-install timestamp carried through; stale repo +
      // skillFolderHash dropped.
      installedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(after.source).toBe("user");

    const rt = readRuntimeState(dir);
    expect(rt.probeFailureCount).toBeUndefined();
    expect(rt.lastProbeFailureAt).toBeUndefined();
    // fetchedAt preserved.
    expect(rt.fetchedAt).toBe("2026-05-01T00:00:00.000Z");
  });

  test("assigns a self-origin to a resident skill that had no origin marker", () => {
    const dir = writeSkill("personal", "scatterbrain", { source: "user" });
    const map = new Map([
      ["scatterbrain", "skills/tools/scatterbrain/SKILL.md"],
    ]);

    const res = reconcileResidentOrigins(registryRoot, map, LINKED);
    expect(res.rewritten).toEqual(["scatterbrain"]);
    expect(readSkillSource(dir).origin).toEqual({
      kind: "github",
      repo: LINKED,
      skillPath: "skills/tools/scatterbrain/SKILL.md",
    });
  });

  test("leaves an already-correct self-origin unchanged (idempotent)", () => {
    const dir = writeSkill("personal", "qmk-keymap", {
      source: "user",
      origin: {
        kind: "github",
        repo: LINKED,
        skillPath: "skills/keyboard/qmk/qmk-keymap/SKILL.md",
      },
    });
    const before = fs.readFileSync(path.join(dir, ".skills-bank.json"), "utf8");

    const map = new Map([
      ["qmk-keymap", "skills/keyboard/qmk/qmk-keymap/SKILL.md"],
    ]);
    const res = reconcileResidentOrigins(registryRoot, map, LINKED);

    expect(res.unchanged).toEqual(["qmk-keymap"]);
    expect(res.rewritten).toEqual([]);
    expect(fs.readFileSync(path.join(dir, ".skills-bank.json"), "utf8")).toBe(
      before,
    );
  });

  test("leaves a genuinely vendored skill (absent from the linked repo) untouched", () => {
    const dir = writeSkill("vendored", "zoom-out", {
      source: "vendored",
      origin: {
        kind: "github",
        repo: "mattpocock/skills",
        skillPath: "skills/engineering/zoom-out/SKILL.md",
        skillFolderHash: "z1",
      },
    });
    // Map does not contain zoom-out → not resident.
    const map = new Map([
      ["write-a-skill", "skills/tools/write-a-skill/SKILL.md"],
    ]);

    const res = reconcileResidentOrigins(registryRoot, map, LINKED);
    expect(res.vendored).toContain("zoom-out");
    expect(readSkillSource(dir).origin?.repo).toBe("mattpocock/skills");
  });
});

describe("buildSkillFolderMap", () => {
  function tree(...paths: string[]): GitTreeEntry[] {
    return paths.map((p) => ({
      path: p,
      mode: "100644",
      type: "blob" as const,
      sha: "x",
    }));
  }

  test("keys skill folders by leaf name across nested category folders", () => {
    const m = buildSkillFolderMap(
      tree(
        "skills/tools/write-a-skill/SKILL.md",
        "skills/keyboard/qmk/qmk-keymap/SKILL.md",
        "README.md",
        "skills/tools/foo/REFERENCE.md", // not a SKILL.md
      ),
    );
    expect(m.get("write-a-skill")).toBe("skills/tools/write-a-skill/SKILL.md");
    expect(m.get("qmk-keymap")).toBe("skills/keyboard/qmk/qmk-keymap/SKILL.md");
    expect(m.has("foo")).toBe(false);
  });

  test("drops ambiguous leaf names that appear in two folders", () => {
    const m = buildSkillFolderMap(
      tree("skills/a/dup/SKILL.md", "skills/b/dup/SKILL.md"),
    );
    expect(m.has("dup")).toBe(false);
  });
});
