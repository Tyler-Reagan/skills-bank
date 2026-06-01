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
      ["---", "name: chomp", "description: |-", "  body", "", "---"].join(
        "\n",
      ) + "\n",
    );
    const fm = readSkillMdFrontmatter(dir);
    expect(fm!["description"]).toBe("body");
  });

  test("folded-strip block (`>-`) joins with spaces, no trailing newline", () => {
    // Regression for aqua-diagram, whose description was authored as a
    // `>-` folded-strip block. Pre-fix the parser captured the literal
    // indicator `">-"` as the entire description.
    const dir = writeSkillMd(
      [
        "---",
        "name: aqua-diagram",
        "description: >-",
        "  Renders aquatic diagrams from a DSL.",
        "  Use when the user asks for a tank layout.",
        "---",
        "# body",
      ].join("\n") + "\n",
    );
    const fm = readSkillMdFrontmatter(dir);
    expect(fm!["description"]).toBe(
      "Renders aquatic diagrams from a DSL. Use when the user asks for a tank layout.",
    );
  });
});

describe("readSkillMdFrontmatter — quoted scalars", () => {
  test("double-quoted value unescapes inner escaped quotes", () => {
    // Regression for zmk-debug: a description authored as a YAML
    // double-quoted scalar with escaped inner quotes. The old parser
    // stripped the delimiters but left the backslashes, so the value
    // re-serialized into meta.json as a double-escaped `\\\"`.
    const dir = writeSkillMd(
      [
        "---",
        "name: zmk-debug",
        'description: "Diagnoses ZMK failures. Use when the user reports \\"board not found\\" or \\"KeyError\\"."',
        "---",
        "# body",
      ].join("\n") + "\n",
    );
    const fm = readSkillMdFrontmatter(dir);
    expect(fm!["description"]).toBe(
      'Diagnoses ZMK failures. Use when the user reports "board not found" or "KeyError".',
    );
  });

  test("plain scalar containing quotes keeps them verbatim", () => {
    // The current on-disk zmk-debug form: an unquoted plain scalar that
    // merely contains double quotes. The old blanket edge-quote strip
    // is gone, so interior quotes survive and no edge quote is sheared.
    const dir = writeSkillMd(
      [
        "---",
        "name: zmk-debug",
        'description: Diagnoses failures. Use when the user reports "board not found", "KeyError".',
        "---",
        "# body",
      ].join("\n") + "\n",
    );
    const fm = readSkillMdFrontmatter(dir);
    expect(fm!["description"]).toBe(
      'Diagnoses failures. Use when the user reports "board not found", "KeyError".',
    );
  });

  test("single-quoted value unescapes doubled quotes", () => {
    const dir = writeSkillMd(
      [
        "---",
        "name: q",
        "description: 'It''s a folded layout'",
        "---",
        "# body",
      ].join("\n") + "\n",
    );
    const fm = readSkillMdFrontmatter(dir);
    expect(fm!["description"]).toBe("It's a folded layout");
  });
});
