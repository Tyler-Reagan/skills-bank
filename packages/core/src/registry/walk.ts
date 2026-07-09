import fs from "node:fs";
import path from "node:path";
import type {
  RegistryEntry,
  RegistryIndex,
  SkillMeta,
} from "../shared/types.js";
import { parseSkillFrontmatter } from "./frontmatter.js";

export function findEntry(
  index: RegistryIndex,
  name: string,
): RegistryEntry | undefined {
  return index.entries.find((e) => e.name === name);
}

/**
 * Reads SkillMeta for a skill folder from SKILL.md frontmatter.
 * Returns null if the file is absent or frontmatter lacks name/description.
 */
export function readSkillMeta(skillDir: string): SkillMeta | null {
  const fm = parseSkillFrontmatter(path.join(skillDir, "SKILL.md"));
  if (
    fm &&
    typeof fm["name"] === "string" &&
    fm["name"] &&
    typeof fm["description"] === "string" &&
    fm["description"]
  ) {
    return {
      name: fm["name"],
      description: fm["description"],
      ...(typeof fm["version"] === "string" && fm["version"]
        ? { version: fm["version"] }
        : {}),
      ...(typeof fm["author"] === "string" && fm["author"]
        ? { author: fm["author"] }
        : {}),
    };
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
 *   - `personal` — self-originated: Origin's `url` is `null` or matches
 *     the active Linked Repo.
 *   - `vendored` — external Origin, mirrored in from a third-party repo.
 *
 * Derived once from Origin at acquisition time (`bucketForOrigin`,
 * ADR-0020) — the folder location is the durable record afterward, so
 * re-linking to a different repo moves no files. A registry may use
 * only one bucket as a matter of composition; the unused bucket simply
 * isn't materialized on disk, and `walkSkills` tolerates missing
 * buckets. This repo's own tree keeps `skills/vendored/` deliberately
 * empty — the maintainer's authored skills live in the separate
 * `Tyler-Reagan/skills` repo instead.
 *
 * Buckets are not stored in the manifest — they're purely a path-level
 * concept derived from where the folder lives on disk. Moving a skill
 * between buckets is `bucket-move.ts`'s job (a folder move, e.g. on
 * Detach).
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

/**
 * Locate a skill folder by name across both buckets. Returns the
 * `SkillFolderRef` for whichever bucket currently houses it, or null
 * if no bucket has a folder of that name. Throws
 * `SkillNameCollisionError` when both buckets have it — same
 * invariant `walkSkills` enforces, surfaced eagerly for single-name
 * lookups so callers don't silently prefer one bucket over the other.
 *
 * Used by the Register / repair / conflict-resolution paths to ask
 * "where does this skill live in the registry?" without re-walking
 * the entire `skills/` tree. Pre-v0.11.3 these paths joined
 * `skills/<name>/` directly — that path no longer exists post-bucket-
 * split, so the lookup has to consult both subdirectories.
 */
export function findSkillFolder(
  registryRoot: string,
  name: string,
): SkillFolderRef | null {
  const matches: SkillFolderRef[] = [];
  for (const bucket of SKILL_BUCKETS) {
    const dir = path.join(registryRoot, "skills", bucket, name);
    if (!fs.existsSync(dir)) continue;
    matches.push({
      name,
      bucket,
      dir,
      relPath: `skills/${bucket}/${name}`,
    });
  }
  if (matches.length > 1) {
    throw new SkillNameCollisionError(
      name,
      matches.map((m) => m.bucket),
    );
  }
  return matches[0] ?? null;
}
