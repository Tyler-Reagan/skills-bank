import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverSkillsInTree } from "../discovery.js";

/**
 * Phase 1 scope-expansion contract: discoverSkillsInTree replaces the
 * remote-layout invariant with a file-convention walk. These tests
 * pin the recognition rule, the depth + skip semantics, and the
 * collision/nested surfacing.
 */

let scratch: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-discovery-"));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function writeSkill(
  relDir: string,
  files: Record<string, string> = { "SKILL.md": "# x" },
): void {
  const abs = path.join(scratch, relDir);
  fs.mkdirSync(abs, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(abs, name), body);
  }
}

describe("discoverSkillsInTree", () => {
  test("flat remote: each top-level folder with SKILL.md is one discovery", () => {
    writeSkill("alpha");
    writeSkill("beta");
    writeSkill("gamma");

    const r = discoverSkillsInTree(scratch);
    expect(r.discoveries.map((d) => d.name)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(r.collisions).toEqual([]);
    expect(r.nested).toEqual([]);
    expect(r.discoveries[0]!.relPath).toBe("alpha");
    expect(r.discoveries[2]!.skillMdRelPath).toBe("gamma/SKILL.md");
  });

  test("bucketed remote: walker descends through skills/{personal,vendored}/", () => {
    writeSkill("skills/personal/alpha");
    writeSkill("skills/personal/beta");
    writeSkill("skills/vendored/gamma");

    const r = discoverSkillsInTree(scratch);
    expect(r.discoveries.map((d) => d.name).sort()).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(r.discoveries.find((d) => d.name === "alpha")!.relPath).toBe(
      "skills/personal/alpha",
    );
    expect(r.collisions).toEqual([]);
  });

  test("nested remote: deep relPath preserved for upstream stamping", () => {
    writeSkill("docs/skills/utility/alpha");

    const r = discoverSkillsInTree(scratch);
    expect(r.discoveries).toHaveLength(1);
    expect(r.discoveries[0]!.name).toBe("alpha");
    expect(r.discoveries[0]!.relPath).toBe("docs/skills/utility/alpha");
    expect(r.discoveries[0]!.skillMdRelPath).toBe(
      "docs/skills/utility/alpha/SKILL.md",
    );
  });

  test("name from SKILL.md frontmatter overrides folder basename", () => {
    writeSkill("folder-name", {
      "SKILL.md":
        "---\nname: frontmatter-name\ndescription: x\n---\n# frontmatter-name\n",
    });

    const r = discoverSkillsInTree(scratch);
    expect(r.discoveries).toHaveLength(1);
    expect(r.discoveries[0]!.name).toBe("frontmatter-name");
    expect(r.discoveries[0]!.sourceDir).toBe(path.join(scratch, "folder-name"));
  });

  test("name collision across paths → dropped from discoveries, surfaced in collisions", () => {
    writeSkill("a/alpha");
    writeSkill("b/alpha");

    const r = discoverSkillsInTree(scratch);
    expect(r.discoveries).toEqual([]);
    expect(r.collisions).toEqual([
      { name: "alpha", paths: ["a/alpha", "b/alpha"] },
    ]);
  });

  test("skill nested inside another skill → outer emitted, inner surfaced in nested", () => {
    writeSkill("outer");
    writeSkill("outer/inner");

    const r = discoverSkillsInTree(scratch);
    expect(r.discoveries.map((d) => d.name)).toEqual(["outer"]);
    expect(r.nested).toEqual([{ outer: "outer", inner: "outer/inner" }]);
  });

  test("SKILL.md folder discovered with correct skillMdRelPath", () => {
    writeSkill("alpha");

    const r = discoverSkillsInTree(scratch);
    expect(r.discoveries).toHaveLength(1);
    expect(r.discoveries[0]!.skillMdRelPath).toBe("alpha/SKILL.md");
  });

  test(".git, node_modules, dist, build, dot-dirs all skipped", () => {
    writeSkill(".git/hooks/dont-mount");
    writeSkill("node_modules/foo");
    writeSkill("dist/built");
    writeSkill("build/artifact");
    writeSkill(".cache/something");
    writeSkill("real-skill");

    const r = discoverSkillsInTree(scratch);
    expect(r.discoveries.map((d) => d.name)).toEqual(["real-skill"]);
  });

  test("depth cap honored — skills deeper than maxDepth are invisible", () => {
    // Walker depth-1 is direct children of root. Nesting 10 levels deep
    // should be invisible at default cap of 8.
    let deep = "";
    for (let i = 0; i < 10; i++) deep = path.posix.join(deep, `d${i}`);
    writeSkill(`${deep}/buried`);
    writeSkill("shallow");

    const r = discoverSkillsInTree(scratch);
    expect(r.discoveries.map((d) => d.name)).toEqual(["shallow"]);
  });

  test("missing root → empty report", () => {
    const r = discoverSkillsInTree(path.join(scratch, "does-not-exist"));
    expect(r.discoveries).toEqual([]);
    expect(r.collisions).toEqual([]);
    expect(r.nested).toEqual([]);
  });
});
