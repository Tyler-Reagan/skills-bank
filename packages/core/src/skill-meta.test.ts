import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseSkillFrontmatter,
  synthesizeSkillMeta,
  validateSkillMeta,
  SKILL_META_SCHEMA,
} from "./skill-meta.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Two levels up from packages/core/src/, then into docs/.
const repoRoot = path.resolve(__dirname, "..", "..", "..");

let scratch: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-skill-meta-"));
});

afterEach(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

describe("SKILL_META_SCHEMA parity with docs/meta-schema.json", () => {
  // The TS constant in skill-meta.ts and the JSON file in docs/ are
  // two physical copies of the same schema by design. This test
  // catches drift so the canonical published version (docs/) and the
  // runtime-bundled version (TS const) stay in lockstep.
  test("structurally matches the canonical docs/meta-schema.json", () => {
    const docsSchemaPath = path.join(repoRoot, "docs", "meta-schema.json");
    const docsSchema = JSON.parse(fs.readFileSync(docsSchemaPath, "utf8"));
    expect(SKILL_META_SCHEMA).toEqual(docsSchema);
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
    fs.writeFileSync(
      p,
      "---\nname: x\ndescription: y\ntags: [a, b, c]\n---\n",
    );
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

describe("synthesizeSkillMeta", () => {
  test("writes a meta.json when none exists and SKILL.md has full frontmatter", () => {
    fs.writeFileSync(
      path.join(scratch, "SKILL.md"),
      "---\nname: my-skill\ndescription: A helpful skill\nversion: 2.1.0\ntags: [foo, bar]\n---\nbody\n",
    );
    const r = synthesizeSkillMeta(scratch);
    expect(r.ok).toBe(true);
    expect(r.ok && r.written).toBe(true);
    const written = JSON.parse(
      fs.readFileSync(path.join(scratch, "meta.json"), "utf8"),
    );
    expect(written).toEqual({
      name: "my-skill",
      description: "A helpful skill",
      version: "2.1.0",
      tags: ["foo", "bar"],
    });
  });

  test("defaults version to 0.1.0 when frontmatter has none", () => {
    fs.writeFileSync(
      path.join(scratch, "SKILL.md"),
      "---\nname: my-skill\ndescription: A helpful skill\n---\n",
    );
    synthesizeSkillMeta(scratch);
    const written = JSON.parse(
      fs.readFileSync(path.join(scratch, "meta.json"), "utf8"),
    );
    expect(written["version"]).toBe("0.1.0");
  });

  test("no-ops when meta.json already exists (does not overwrite)", () => {
    fs.writeFileSync(
      path.join(scratch, "SKILL.md"),
      "---\nname: my-skill\ndescription: New desc\n---\n",
    );
    const existing = { name: "my-skill", description: "Pre-existing" };
    fs.writeFileSync(
      path.join(scratch, "meta.json"),
      JSON.stringify(existing),
    );
    const r = synthesizeSkillMeta(scratch);
    expect(r.ok && !r.written && r.reason).toBe("meta-already-exists");
    const after = JSON.parse(
      fs.readFileSync(path.join(scratch, "meta.json"), "utf8"),
    );
    expect(after).toEqual(existing);
  });

  test("no-ops when SKILL.md has no frontmatter", () => {
    fs.writeFileSync(path.join(scratch, "SKILL.md"), "no frontmatter\n");
    const r = synthesizeSkillMeta(scratch);
    expect(r.ok && !r.written && r.reason).toBe("no-frontmatter");
    expect(fs.existsSync(path.join(scratch, "meta.json"))).toBe(false);
  });

  test("no-ops when frontmatter lacks required name or description", () => {
    fs.writeFileSync(
      path.join(scratch, "SKILL.md"),
      "---\nname: my-skill\n---\n",
    );
    const r = synthesizeSkillMeta(scratch);
    expect(r.ok && !r.written && r.reason).toBe("missing-name-or-description");
    expect(fs.existsSync(path.join(scratch, "meta.json"))).toBe(false);
  });
});

describe("validateSkillMeta", () => {
  test("passes a well-formed meta.json", () => {
    fs.writeFileSync(
      path.join(scratch, "meta.json"),
      JSON.stringify({
        name: "my-skill",
        description: "A helpful skill",
        version: "1.0.0",
        tags: ["foo"],
      }),
    );
    expect(validateSkillMeta(scratch)).toEqual({ ok: true });
  });

  test("fails with missing-meta-json when the file doesn't exist", () => {
    const r = validateSkillMeta(scratch);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("missing-meta-json");
  });

  test("fails with invalid-json when the file is malformed", () => {
    fs.writeFileSync(path.join(scratch, "meta.json"), "{ not json");
    const r = validateSkillMeta(scratch);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("invalid-json");
  });

  test("fails with schema-violation for empty description (the impeccable case)", () => {
    fs.writeFileSync(
      path.join(scratch, "meta.json"),
      JSON.stringify({ name: "my-skill", description: "" }),
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

  test("fails with schema-violation for missing required name", () => {
    fs.writeFileSync(
      path.join(scratch, "meta.json"),
      JSON.stringify({ description: "no name" }),
    );
    const r = validateSkillMeta(scratch);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("schema-violation");
  });

  test("fails with schema-violation for name with uppercase characters", () => {
    fs.writeFileSync(
      path.join(scratch, "meta.json"),
      JSON.stringify({ name: "MySkill", description: "x" }),
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
