// SKILL.md frontmatter validation against the SkillFrontmatter schema.
// Shared between the maintainer script paths (`bank vendor`,
// `bank update`) and the in-app Origin Update path
// (`applyOriginUpdate`) so all three converge on one contract for
// "post-mirror invariants." (The meta.json synthesis that used to
// live here was removed in v1.20 along with meta.json itself.)
//
// Validation runs the same Ajv schema check `docs/skill-frontmatter-schema.json`
// documents — inlined here as SKILL_FRONTMATTER_SCHEMA so packaged-app
// instances (where `docs/` is outside the registry tree) get the
// same check. A test in frontmatter.test.ts ensures the inlined
// schema matches the docs/-canonical file byte-for-byte
// structurally; drift between the two surfaces in CI rather than
// at runtime.

import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";

/**
 * Canonical SkillFrontmatter schema, kept in sync with
 * `docs/skill-frontmatter-schema.json`.
 * Loaded once and cached for the process lifetime.
 *
 * Two copies of the schema exist by design:
 *   - This TS constant — used by the runtime (`applyOriginUpdate`,
 *     `validate-all.ts`, `build.ts`) so packaged-app instances don't
 *     depend on a docs/ file existing inside the user's registry.
 *   - `docs/skill-frontmatter-schema.json` — the canonical published
 *     version that external consumers can fetch via the `$id` URL.
 * The frontmatter.test.ts suite verifies parity.
 */
export const SKILL_FRONTMATTER_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://github.com/Tyler-Reagan/skills-bank/docs/skill-frontmatter-schema.json",
  title: "SkillFrontmatter",
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
    SKILL_FRONTMATTER_SCHEMA,
  ) as unknown as SchemaValidator;
  return cachedValidator;
}

/**
 * Parse a SKILL.md's YAML frontmatter into a flat record. The single
 * frontmatter parser in core (registry.ts's `readSkillMeta` delegates
 * here; its former `readSkillMdFrontmatter` is a deprecated wrapper).
 * Supports:
 *   - scalar `key: value` lines (quoted scalars resolved via
 *     `unquoteScalar` — proper escape handling, not a blanket strip)
 *   - block scalars `key: |` / `key: >` with optional chomp indicator
 *   - inline arrays (`tags: [a, b]`) and block arrays (`- item` lines)
 *   - `#` comment lines (skipped)
 * Anything else is silently dropped — only the fixed SkillMeta field
 * set matters for validation and index building.
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
    // Indented lines belong to the previous key's block scalar
    // (consumed inline below) — never start a new key.
    if (/^\s/.test(line)) continue;
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
          .map((s) => unquoteScalar(s.trim()))
          .filter(Boolean);
      }
      continue;
    }
    // Block array: header line is empty, subsequent `- item` lines.
    if (rest === "" && i < lines.length && lines[i]!.trim().startsWith("-")) {
      const arr: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("-")) {
        const item = unquoteScalar(lines[i]!.trim().replace(/^-\s*/, ""));
        if (item) arr.push(item);
        i++;
      }
      out[key] = arr;
      continue;
    }
    // Block scalars: `key: |` (literal — preserve newlines) or
    // `key: >` (folded — newlines become spaces), with optional chomp
    // indicator (`|-`, `|+`, `>-`, `>+`). Without this branch the
    // captured value would be the literal indicator char (`|`), which
    // would surface as a one-character description and trip drift
    // detection downstream.
    const blockMatch = rest.match(/^([|>])[-+]?\s*$/);
    if (blockMatch) {
      const mode = blockMatch[1]!;
      const body: string[] = [];
      while (i < lines.length) {
        const next = lines[i]!;
        // Block ends at the first non-empty, un-indented line.
        if (next.length > 0 && !/^\s/.test(next)) break;
        body.push(next);
        i++;
      }
      const nonEmpty = body.filter((l) => l.trim().length > 0);
      const minIndent =
        nonEmpty.length > 0
          ? Math.min(...nonEmpty.map((l) => /^\s*/.exec(l)![0].length))
          : 0;
      const stripped = body.map((l) => l.slice(minIndent));
      while (stripped.length > 0 && !stripped[stripped.length - 1]!.trim()) {
        stripped.pop();
      }
      out[key] = mode === ">" ? stripped.join(" ") : stripped.join("\n");
      continue;
    }
    // Plain or quoted scalar.
    out[key] = unquoteScalar(rest);
  }
  return out;
}

/**
 * Resolve a single-line YAML flow scalar to its string value.
 *
 *   - Double-quoted: strip the delimiters and resolve backslash
 *     escapes (`\"`, `\\`, `\n`, …). Skipping the unescape is what
 *     leaked literal backslashes into exports for a description
 *     authored as `"… \"board not found\" …"` — they then
 *     re-serialized as a double-escaped `\\\"` on the next export
 *     (the zmk-debug regression).
 *   - Single-quoted: strip the delimiters; the only escape YAML
 *     recognizes inside single quotes is a doubled quote (`''` → `'`).
 *   - Plain (unquoted): returned verbatim. A plain scalar that merely
 *     *contains* quotes — `Diagnoses … "board not found" …` — keeps
 *     them; a blanket `replace(/^["']|["']$/g, "")` could shear a
 *     stray edge quote off such values.
 */
function unquoteScalar(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw
      .slice(1, -1)
      .replace(/\\(["\\/bfnrt]|u[0-9a-fA-F]{4})/g, (_m, esc: string) => {
        switch (esc[0]) {
          case "n":
            return "\n";
          case "t":
            return "\t";
          case "r":
            return "\r";
          case "b":
            return "\b";
          case "f":
            return "\f";
          case "u":
            return String.fromCharCode(parseInt(esc.slice(1), 16));
          default:
            return esc; // " \ /
        }
      });
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
}

export type ValidateSkillMetaResult =
  | { ok: true }
  | { ok: false; reason: "missing-frontmatter" }
  | { ok: false; reason: "schema-violation"; errors: string[] };

/**
 * Validate SKILL.md frontmatter for `skillDir` against the SkillMeta schema.
 *
 * Used by `bank update` (pre-publish gate) and `applyOriginUpdate`
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
