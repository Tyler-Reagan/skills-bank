import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseSkillFrontmatter,
  validateSkillMeta,
  SKILL_FRONTMATTER_SCHEMA,
} from "../frontmatter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Climb from src/registry/test/ up to the repo root, then into docs/.
const repoRoot = path.resolve(__dirname, "..", "..", "..", "..", "..");

let scratch: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-skill-meta-"));
});

afterEach(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

describe("SKILL_FRONTMATTER_SCHEMA parity with docs/skill-frontmatter-schema.json", () => {
  // The TS constant in frontmatter.ts and the JSON file in docs/ are
  // two physical copies of the same schema by design. This test
  // catches drift so the canonical published version (docs/) and the
  // runtime-bundled version (TS const) stay in lockstep.
  test("structurally matches the canonical docs/skill-frontmatter-schema.json", () => {
    const docsSchemaPath = path.join(
      repoRoot,
      "docs",
      "skill-frontmatter-schema.json",
    );
    const docsSchema = JSON.parse(fs.readFileSync(docsSchemaPath, "utf8"));
    expect(SKILL_FRONTMATTER_SCHEMA).toEqual(docsSchema);
  });
});

describe("parseSkillFrontmatter", () => {
  test("returns null when the file doesn't exist", () => {
    expect(parseSkillFrontmatter(path.join(scratch, "missing.md"))).toBeNull();
  });

  test("returns null when there's no frontmatter block", () => {
    const p = path.join(scratch, "no-fm.md");
    fs.writeFileSync(p, "no frontmatter here\nsome content\n");
    expect(parseSkillFrontmatter(p)).toBeNull();
  });

  test("parses scalar fields", () => {
    const p = path.join(scratch, "scalar.md");
    fs.writeFileSync(
      p,
      "---\nname: my-skill\ndescription: A helpful skill\nversion: 1.0.0\n---\nbody\n",
    );
    expect(parseSkillFrontmatter(p)).toEqual({
      name: "my-skill",
      description: "A helpful skill",
      version: "1.0.0",
    });
  });

  test("parses inline array tags", () => {
    const p = path.join(scratch, "inline-tags.md");
    fs.writeFileSync(p, "---\nname: x\ndescription: y\ntags: [a, b, c]\n---\n");
    const fm = parseSkillFrontmatter(p);
    expect(fm?.["tags"]).toEqual(["a", "b", "c"]);
  });

  test("parses block-array tags", () => {
    const p = path.join(scratch, "block-tags.md");
    fs.writeFileSync(
      p,
      "---\nname: x\ndescription: y\ntags:\n  - alpha\n  - beta\n---\n",
    );
    const fm = parseSkillFrontmatter(p);
    expect(fm?.["tags"]).toEqual(["alpha", "beta"]);
  });

  test("strips surrounding quotes from scalar values", () => {
    const p = path.join(scratch, "quoted.md");
    fs.writeFileSync(p, "---\nname: \"my-skill\"\ndescription: 'desc'\n---\n");
    expect(parseSkillFrontmatter(p)).toEqual({
      name: "my-skill",
      description: "desc",
    });
  });
});

describe("validateSkillMeta", () => {
  test("passes a well-formed SKILL.md frontmatter", () => {
    fs.writeFileSync(
      path.join(scratch, "SKILL.md"),
      "---\nname: my-skill\ndescription: A helpful skill\nversion: 1.0.0\ntags: [foo]\n---\nbody\n",
    );
    expect(validateSkillMeta(scratch)).toEqual({ ok: true });
  });

  test("fails with missing-frontmatter when SKILL.md is absent", () => {
    const r = validateSkillMeta(scratch);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("missing-frontmatter");
  });

  test("fails with missing-frontmatter when SKILL.md has no frontmatter", () => {
    fs.writeFileSync(path.join(scratch, "SKILL.md"), "# no frontmatter\n");
    const r = validateSkillMeta(scratch);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("missing-frontmatter");
  });

  test("fails with schema-violation for empty description (the impeccable case)", () => {
    fs.writeFileSync(
      path.join(scratch, "SKILL.md"),
      '---\nname: my-skill\ndescription: ""\n---\n',
    );
    const r = validateSkillMeta(scratch);
    expect(r.ok).toBe(false);
    if (r.ok === false && r.reason === "schema-violation") {
      expect(r.errors.length).toBeGreaterThan(0);
      expect(r.errors.join(" ")).toMatch(/description/);
    } else {
      throw new Error("expected schema-violation");
    }
  });

  test("fails with missing-frontmatter for missing required name", () => {
    // Frontmatter without name doesn't satisfy the name+description guard.
    fs.writeFileSync(
      path.join(scratch, "SKILL.md"),
      "---\ndescription: no name\n---\n",
    );
    const r = validateSkillMeta(scratch);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("missing-frontmatter");
  });

  test("fails with schema-violation for name with uppercase characters", () => {
    fs.writeFileSync(
      path.join(scratch, "SKILL.md"),
      "---\nname: MySkill\ndescription: x\n---\n",
    );
    const r = validateSkillMeta(scratch);
    expect(r.ok).toBe(false);
    if (r.ok === false && r.reason === "schema-violation") {
      expect(r.errors.join(" ")).toMatch(/name/);
    } else {
      throw new Error("expected schema-violation");
    }
  });
});

// ── Block-scalar + quoted-scalar coverage (moved from registry.test.ts
// when frontmatter parsing consolidated here in v1.20.3) ──

function writeSkillMdFile(body: string): string {
  const dir = path.join(scratch, "skill");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "SKILL.md");
  fs.writeFileSync(p, body);
  return p;
}

describe("parseSkillFrontmatter — block scalars", () => {
  test("inline scalar parses unchanged", () => {
    const dir = writeSkillMdFile(
      "---\nname: foo\ndescription: a short single line\n---\n# foo\n",
    );
    const fm = parseSkillFrontmatter(dir);
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
    const dir = writeSkillMdFile(
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
    const fm = parseSkillFrontmatter(dir);
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
    const dir = writeSkillMdFile(
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
    const fm = parseSkillFrontmatter(dir);
    expect(fm!["description"]).toBe("one line another line");
  });

  test("chomp indicator (`|-`) parses and strips trailing blank lines", () => {
    const dir = writeSkillMdFile(
      ["---", "name: chomp", "description: |-", "  body", "", "---"].join(
        "\n",
      ) + "\n",
    );
    const fm = parseSkillFrontmatter(dir);
    expect(fm!["description"]).toBe("body");
  });

  test("folded-strip block (`>-`) joins with spaces, no trailing newline", () => {
    // Regression for aqua-diagram, whose description was authored as a
    // `>-` folded-strip block. Pre-fix the parser captured the literal
    // indicator `">-"` as the entire description.
    const dir = writeSkillMdFile(
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
    const fm = parseSkillFrontmatter(dir);
    expect(fm!["description"]).toBe(
      "Renders aquatic diagrams from a DSL. Use when the user asks for a tank layout.",
    );
  });
});

describe("parseSkillFrontmatter — quoted scalars", () => {
  test("double-quoted value unescapes inner escaped quotes", () => {
    // Regression for zmk-debug: a description authored as a YAML
    // double-quoted scalar with escaped inner quotes. The old parser
    // stripped the delimiters but left the backslashes, so the value
    // re-serialized into meta.json as a double-escaped `\\\"`.
    const dir = writeSkillMdFile(
      [
        "---",
        "name: zmk-debug",
        'description: "Diagnoses ZMK failures. Use when the user reports \\"board not found\\" or \\"KeyError\\"."',
        "---",
        "# body",
      ].join("\n") + "\n",
    );
    const fm = parseSkillFrontmatter(dir);
    expect(fm!["description"]).toBe(
      'Diagnoses ZMK failures. Use when the user reports "board not found" or "KeyError".',
    );
  });

  test("plain scalar containing quotes keeps them verbatim", () => {
    // The current on-disk zmk-debug form: an unquoted plain scalar that
    // merely contains double quotes. The old blanket edge-quote strip
    // is gone, so interior quotes survive and no edge quote is sheared.
    const dir = writeSkillMdFile(
      [
        "---",
        "name: zmk-debug",
        'description: Diagnoses failures. Use when the user reports "board not found", "KeyError".',
        "---",
        "# body",
      ].join("\n") + "\n",
    );
    const fm = parseSkillFrontmatter(dir);
    expect(fm!["description"]).toBe(
      'Diagnoses failures. Use when the user reports "board not found", "KeyError".',
    );
  });

  test("single-quoted value unescapes doubled quotes", () => {
    const dir = writeSkillMdFile(
      [
        "---",
        "name: q",
        "description: 'It''s a folded layout'",
        "---",
        "# body",
      ].join("\n") + "\n",
    );
    const fm = parseSkillFrontmatter(dir);
    expect(fm!["description"]).toBe("It's a folded layout");
  });
});
