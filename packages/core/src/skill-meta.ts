// SKILL.md frontmatter validation against the SkillMeta schema.
// Shared between the maintainer script paths (`vendor:skill`,
// `update:skill`) and the in-app Origin Update path
// (`applyOriginUpdate`) so all three converge on one contract for
// "post-mirror invariants." (The meta.json synthesis that used to
// live here was removed in v1.20 along with meta.json itself.)
//
// Validation runs the same Ajv schema check `docs/meta-schema.json`
// documents — inlined here as SKILL_META_SCHEMA so packaged-app
// instances (where `docs/` is outside the registry tree) get the
// same check. A test in skill-meta.test.ts ensures the inlined
// schema matches the docs/-canonical file byte-for-byte
// structurally; drift between the two surfaces in CI rather than
// at runtime.

import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";

/**
 * Canonical SkillMeta schema, kept in sync with `docs/meta-schema.json`.
 * Loaded once and cached for the process lifetime.
 *
 * Two copies of the schema exist by design:
 *   - This TS constant — used by the runtime (`applyOriginUpdate`,
 *     `validate-all.ts`, `build.ts`) so packaged-app instances don't
 *     depend on a docs/ file existing inside the user's registry.
 *   - `docs/meta-schema.json` — the canonical published version that
 *     external consumers can fetch via the `$id` URL.
 * The skill-meta.test.ts suite verifies parity.
 */
export const SKILL_META_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://github.com/Tyler-Reagan/skills-bank/docs/meta-schema.json",
  title: "SkillMeta",
  type: "object",
  required: ["name", "description"],
  additionalProperties: true,
  properties: {
    name: {
      type: "string",
      pattern: "^[a-z0-9][a-z0-9-]*$",
      minLength: 1,
      maxLength: 64,
    },
    description: {
      type: "string",
      minLength: 1,
    },
    tags: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 64 },
      uniqueItems: true,
    },
    version: {
      type: "string",
      pattern: "^\\d+\\.\\d+\\.\\d+(-[A-Za-z0-9.-]+)?$",
    },
    author: { type: "string" },
  },
} as const;

interface SchemaValidator {
  (data: unknown): boolean;
  errors?: { instancePath: string; message?: string }[] | null;
}

let cachedValidator: SchemaValidator | null = null;

function compiledValidator(): SchemaValidator {
  if (cachedValidator) return cachedValidator;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  cachedValidator = ajv.compile(
    SKILL_META_SCHEMA,
  ) as unknown as SchemaValidator;
  return cachedValidator;
}

/**
 * Parse a SKILL.md's YAML frontmatter into a flat record. Supports
 * scalar `key: value` lines, inline-array tags (`tags: [a, b]`), and
 * block-array tags (one `- item` per line after a `tags:` header).
 * Anything else is silently dropped — only a small fixed set of
 * fields matters for meta.json synthesis.
 *
 * Returns null when the file is missing or has no frontmatter block.
 */
export function parseSkillFrontmatter(
  skillMdPath: string,
): Record<string, string | string[]> | null {
  if (!fs.existsSync(skillMdPath)) return null;
  const content = fs.readFileSync(skillMdPath, "utf8");
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match || !match[1]) return null;
  const out: Record<string, string | string[]> = {};
  const lines = match[1].split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    i++;
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    const rest = line.slice(idx + 1).trim();
    // Inline array: `tags: [a, b, c]`.
    if (rest.startsWith("[") && rest.endsWith("]")) {
      const inner = rest.slice(1, -1).trim();
      if (!inner) {
        out[key] = [];
      } else {
        out[key] = inner
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      }
      continue;
    }
    // Block array: header line is empty, subsequent `- item` lines.
    if (rest === "" && i < lines.length && lines[i]!.trim().startsWith("-")) {
      const arr: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("-")) {
        const item = lines[i]!.trim()
          .replace(/^-\s*/, "")
          .replace(/^["']|["']$/g, "");
        if (item) arr.push(item);
        i++;
      }
      out[key] = arr;
      continue;
    }
    // Scalar (strip surrounding quotes).
    const stripped = rest.replace(/^["']|["']$/g, "");
    out[key] = stripped;
  }
  return out;
}

export type ValidateSkillMetaResult =
  | { ok: true }
  | { ok: false; reason: "missing-frontmatter" }
  | { ok: false; reason: "schema-violation"; errors: string[] };

/**
 * Validate SKILL.md frontmatter for `skillDir` against the SkillMeta schema.
 *
 * Used by `update:skill` (pre-publish gate) and `applyOriginUpdate`
 * (post-mirror gate).
 *
 * Returns a discriminated union so callers can render flow-specific
 * UI per failure mode. The `errors` array for `schema-violation`
 * carries the formatted Ajv messages ("`/description` must NOT have
 * fewer than 1 characters" and friends).
 */
export function validateSkillMeta(skillDir: string): ValidateSkillMetaResult {
  const fm = parseSkillFrontmatter(path.join(skillDir, "SKILL.md"));
  if (
    !fm ||
    typeof fm["name"] !== "string" ||
    !fm["name"] ||
    typeof fm["description"] !== "string"
  ) {
    return { ok: false, reason: "missing-frontmatter" };
  }

  const fmObj: Record<string, unknown> = {};
  if (typeof fm["name"] === "string") fmObj["name"] = fm["name"];
  if (typeof fm["description"] === "string")
    fmObj["description"] = fm["description"];
  if (Array.isArray(fm["tags"])) fmObj["tags"] = fm["tags"];
  if (typeof fm["version"] === "string") fmObj["version"] = fm["version"];
  if (typeof fm["author"] === "string") fmObj["author"] = fm["author"];

  const validate = compiledValidator();
  if (validate(fmObj)) return { ok: true };
  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || "(root)"} ${e.message ?? "<unknown>"}`,
  );
  return { ok: false, reason: "schema-violation", errors };
}
