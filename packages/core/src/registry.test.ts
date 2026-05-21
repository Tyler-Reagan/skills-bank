import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSkillMdFrontmatter } from "./registry.js";

let scratch: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-registry-"));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function writeSkillMd(body: string): string {
  const dir = path.join(scratch, "skill");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), body);
  return dir;
}

describe("readSkillMdFrontmatter — block scalars", () => {
  test("inline scalar parses unchanged", () => {
    const dir = writeSkillMd(
      "---\nname: foo\ndescription: a short single line\n---\n# foo\n",
    );
    const fm = readSkillMdFrontmatter(dir);
    expect(fm).toEqual({
      name: "foo",
      description: "a short single line",
    });
  });

  test("literal block (`|`) joins lines with newlines and strips indent", () => {
    // Regression for fix-knip-unused-exports and any other harvested
    // skill whose author wrote the description as a YAML literal block.
    // Pre-fix the parser captured `|` as the value and the description
    // collapsed to a one-character string, which then propagated through
    // restoreAuxState into a malformed meta.json.
    const dir = writeSkillMd(
      [
        "---",
        "name: fix-knip",
        "description: |",
        "  Fix knip violations. Handles all categories: test-only exports",
        "  (extract to new file), dead barrel re-exports, internally-only.",
        "  Use when `npm run knip` reports unused exports.",
        "---",
        "# body",
      ].join("\n") + "\n",
    );
    const fm = readSkillMdFrontmatter(dir);
    expect(fm).not.toBeNull();
    expect(fm!["name"]).toBe("fix-knip");
    expect(fm!["description"]).toBe(
      [
        "Fix knip violations. Handles all categories: test-only exports",
        "(extract to new file), dead barrel re-exports, internally-only.",
        "Use when `npm run knip` reports unused exports.",
      ].join("\n"),
    );
  });

  test("folded block (`>`) joins lines with spaces", () => {
    const dir = writeSkillMd(
      [
        "---",
        "name: folded",
        "description: >",
        "  one line",
        "  another line",
        "---",
        "# body",
      ].join("\n") + "\n",
    );
    const fm = readSkillMdFrontmatter(dir);
    expect(fm!["description"]).toBe("one line another line");
  });

  test("chomp indicator (`|-`) parses and strips trailing blank lines", () => {
    const dir = writeSkillMd(
      ["---", "name: chomp", "description: |-", "  body", "", "---"].join("\n") +
        "\n",
    );
    const fm = readSkillMdFrontmatter(dir);
    expect(fm!["description"]).toBe("body");
  });
});
