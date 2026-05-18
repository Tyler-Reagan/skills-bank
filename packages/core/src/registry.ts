import fs from "node:fs";
import path from "node:path";
import type { RegistryEntry, RegistryIndex, SkillMeta } from "./types.js";

const INDEX_FILE = "index.json";

export function loadIndex(registryRoot: string): RegistryIndex {
  const p = path.join(registryRoot, INDEX_FILE);
  if (!fs.existsSync(p)) {
    return { generatedAt: new Date(0).toISOString(), entries: [] };
  }
  const data = JSON.parse(fs.readFileSync(p, "utf8")) as RegistryIndex;
  return data;
}

export function findEntry(
  index: RegistryIndex,
  name: string,
): RegistryEntry | undefined {
  return index.entries.find((e) => e.name === name);
}

/**
 * Reads SkillMeta for a skill folder. Prefers meta.json; falls back to YAML
 * frontmatter in SKILL.md. Returns null if neither is parseable.
 */
export function readSkillMeta(skillDir: string): SkillMeta | null {
  const metaPath = path.join(skillDir, "meta.json");
  if (fs.existsSync(metaPath)) {
    try {
      return JSON.parse(fs.readFileSync(metaPath, "utf8")) as SkillMeta;
    } catch {
      // fall through
    }
  }
  const skillMd = path.join(skillDir, "SKILL.md");
  if (fs.existsSync(skillMd)) {
    const content = fs.readFileSync(skillMd, "utf8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (match && match[1]) {
      const fm: Record<string, string> = {};
      for (const line of match[1].split("\n")) {
        const idx = line.indexOf(":");
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        const val = line
          .slice(idx + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
        if (key) fm[key] = val;
      }
      if (fm["name"] && fm["description"]) {
        return {
          name: fm["name"],
          description: fm["description"],
          ...(fm["version"] ? { version: fm["version"] } : {}),
          ...(fm["author"] ? { author: fm["author"] } : {}),
        };
      }
    }
  }
  return null;
}

/**
 * Resolves the absolute filesystem path for a registry entry.
 */
export function resolveEntryPath(
  registryRoot: string,
  entry: RegistryEntry,
): string {
  return path.resolve(registryRoot, entry.path);
}

/**
 * Spatial categorization of a skill folder under `<root>/skills/`.
 *
 *   - `personal` — authored by the maintainer in this repo. Includes
 *     skills whose `upstream` is self-referential
 *     (`repo === BUNDLED_REPO`), `kind: "none"`, or absent. Future
 *     `Tyler-Reagan/personal-skills` split extracts this subtree.
 *   - `vendored` — harvested from external authors' repos. `upstream`
 *     points at someone else's repo.
 *
 * Buckets are NOT stored in `.skills-bank.json` — they're purely a
 * path-level concept derived from where the folder lives on disk.
 * Moving a skill between buckets is a `git mv` plus an optional
 * marker update if origin attribution changed.
 */
export type SkillBucket = "personal" | "vendored";

export const SKILL_BUCKETS: readonly SkillBucket[] = ["personal", "vendored"];

export interface SkillFolderRef {
  name: string;
  bucket: SkillBucket;
  /** Absolute path to the skill folder on disk. */
  dir: string;
  /** Path relative to `registryRoot` — e.g. `"skills/vendored/foo"`.
   *  Used directly as `RegistryEntry.path` so `resolveEntryPath`
   *  works transparently across the bucket migration. */
  relPath: string;
}

export class SkillNameCollisionError extends Error {
  readonly name = "SkillNameCollisionError";
  constructor(
    public readonly skillName: string,
    public readonly buckets: readonly SkillBucket[],
  ) {
    super(
      `Skill "${skillName}" appears in multiple buckets: ${buckets.join(", ")}. ` +
        `Skill names must be globally unique across buckets.`,
    );
  }
}

/**
 * Walk every skill folder under `<registryRoot>/skills/{personal,vendored}/*`
 * and return a flat list with bucket attribution. The single canonical
 * iterator over the bucket layout — every consumer that previously did
 * `fs.readdirSync(path.join(root, "skills"))` migrates onto this.
 *
 * Behavior:
 *   - Missing bucket directories are tolerated (returned empty), so
 *     a partially-populated registry (e.g. fresh init with only
 *     `personal/` so far) doesn't error.
 *   - The legacy flat layout (`<root>/skills/<name>/`) is no longer
 *     supported; folders directly under `<root>/skills/` that aren't
 *     bucket names are ignored. Migration is one-shot via the
 *     directory-split sweep.
 *   - Name collisions across buckets throw `SkillNameCollisionError`.
 *     Callers that prefer to drop rather than fail on collisions
 *     should catch and warn; the default is throw so CI catches the
 *     case at index-build time.
 *
 * Output ordering is deterministic — buckets are walked in declaration
 * order (`personal` then `vendored`) and entries within a bucket are
 * sorted by name. Callers that need a different order sort the
 * result.
 */
export function walkSkills(registryRoot: string): SkillFolderRef[] {
  const skillsDir = path.join(registryRoot, "skills");
  if (!fs.existsSync(skillsDir)) return [];

  const seen = new Map<string, SkillBucket[]>();
  const out: SkillFolderRef[] = [];

  for (const bucket of SKILL_BUCKETS) {
    const bucketDir = path.join(skillsDir, bucket);
    if (!fs.existsSync(bucketDir)) continue;
    const entries = fs.readdirSync(bucketDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const existing = seen.get(ent.name);
      if (existing) {
        existing.push(bucket);
        continue;
      }
      seen.set(ent.name, [bucket]);
      out.push({
        name: ent.name,
        bucket,
        dir: path.join(bucketDir, ent.name),
        relPath: `skills/${bucket}/${ent.name}`,
      });
    }
  }

  for (const [name, buckets] of seen) {
    if (buckets.length > 1) {
      throw new SkillNameCollisionError(name, buckets);
    }
  }

  return out;
}
