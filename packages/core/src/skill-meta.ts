// Skill `meta.json` helpers — synthesis from SKILL.md frontmatter and
// schema validation. Shared between the maintainer CLI paths
// (`vendor:skill`, `update:skill`) and the in-app Origin Update path
// (`applyOriginUpdate`) so all three converge on one contract for
// "post-mirror invariants."
//
// Synthesis (extracted from scripts/vendor-skill.ts) creates a
// minimal meta.json from SKILL.md frontmatter when the mirrored
// folder lacks one. Validation runs the same Ajv schema check
// `docs/meta-schema.json` documents — inlined here as
// SKILL_META_SCHEMA so packaged-app instances (where `docs/` is
// outside the registry tree) get the same check. A test in
// skill-meta.test.ts ensures the inlined schema matches the
// docs/-canonical file byte-for-byte structurally; drift between
// the two surfaces in CI rather than at runtime.

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

export type SynthesizeSkillMetaResult =
  | { ok: true; written: true; path: string }
  | {
      ok: true;
      written: false;
      reason:
        | "meta-already-exists"
        | "no-frontmatter"
        | "missing-name-or-description";
    };

/**
 * Synthesize a `meta.json` into `skillDir` from the SKILL.md
 * frontmatter when (a) meta.json doesn't already exist and (b) the
 * frontmatter yields at minimum a `name` and `description`. No-op
 * with structured reason otherwise.
 *
 * Field set is the maintainable subset of `SkillMeta` plus optional
 * `license` (schema's `additionalProperties: true` round-trips it).
 *
 * Used by both `vendor:skill` (mirror-then-synthesize path) and
 * `applyOriginUpdate` (post-mirror synthesis for upstreams that
 * don't ship a meta.json). Closes the gap reported in
 * `docs/bug-reports/2026-05-19-origin-update-missing-meta-synthesis.md`.
 */
export function synthesizeSkillMeta(
  skillDir: string,
): SynthesizeSkillMetaResult {
  const metaPath = path.join(skillDir, "meta.json");
  if (fs.existsSync(metaPath)) {
    return { ok: true, written: false, reason: "meta-already-exists" };
  }
  const fm = parseSkillFrontmatter(path.join(skillDir, "SKILL.md"));
  if (!fm) {
    return { ok: true, written: false, reason: "no-frontmatter" };
  }
  const name = typeof fm["name"] === "string" ? fm["name"] : null;
  const description =
    typeof fm["description"] === "string" ? fm["description"] : null;
  if (!name || !description) {
    return { ok: true, written: false, reason: "missing-name-or-description" };
  }
  const meta: Record<string, string | string[]> = { name, description };
  const version = typeof fm["version"] === "string" ? fm["version"] : "0.1.0";
  meta["version"] = version;
  if (Array.isArray(fm["tags"]) && fm["tags"].length > 0) {
    meta["tags"] = fm["tags"];
  }
  if (typeof fm["license"] === "string" && fm["license"]) {
    meta["license"] = fm["license"];
  }
  if (typeof fm["author"] === "string" && fm["author"]) {
    meta["author"] = fm["author"];
  }
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
  return { ok: true, written: true, path: metaPath };
}

export type ValidateSkillMetaResult =
  | { ok: true }
  | { ok: false; reason: "missing-meta-json" }
  | { ok: false; reason: "invalid-json"; message: string }
  | { ok: false; reason: "schema-violation"; errors: string[] };

/**
 * Validate `skillDir/meta.json` against the SkillMeta schema.
 *
 * Used by `update:skill` (pre-publish gate) and `applyOriginUpdate`
 * (post-mirror gate). Closes the gap reported in
 * `docs/bug-reports/2026-05-19-origin-update-missing-validation.md`.
 *
 * Returns a discriminated union so callers can render flow-specific
 * UI per failure mode. The `errors` array for `schema-violation`
 * carries the formatted Ajv messages ("`/description` must NOT have
 * fewer than 1 characters" and friends).
 */
export function validateSkillMeta(skillDir: string): ValidateSkillMetaResult {
  const metaPath = path.join(skillDir, "meta.json");
  if (!fs.existsSync(metaPath)) {
    return { ok: false, reason: "missing-meta-json" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch (err) {
    return {
      ok: false,
      reason: "invalid-json",
      message: (err as Error).message,
    };
  }
  const validate = compiledValidator();
  if (validate(parsed)) return { ok: true };
  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || "(root)"} ${e.message ?? "<unknown>"}`,
  );
  return { ok: false, reason: "schema-violation", errors };
}
