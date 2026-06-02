import type { RegistryManifest, ManifestSkill } from "./manifest.js";

export interface ManifestDiff {
  /** Names in source but not in target (will be added to target). */
  added: string[];
  /** Names in target but not in source (will be removed from target). */
  removed: string[];
  /** Names in both but with differing fields. */
  changed: string[];
  /** Names identical in both. */
  unchanged: string[];
}

/**
 * The per-skill fields that constitute shared registry intent. Two
 * entries with an identical signature are "the same skill" for both
 * diff and three-way merge — so `manifest-merge.ts` imports
 * `skillSignature` rather than re-deriving the field set, keeping the
 * two engines from drifting apart.
 *
 * Deliberately EXCLUDES `description` (informational, re-derivable from
 * SKILL.md), `bucket` (a path concept), and `lastInstalledOn` (per-
 * machine local). Includes `dismissed`/`hidden` (curation intent).
 */
export const COMPARED_FIELDS: (keyof ManifestSkill)[] = [
  "source",
  "origin",
  "tags",
  "hidden",
  "dismissed",
];

export function skillSignature(s: ManifestSkill): string {
  return JSON.stringify(COMPARED_FIELDS.map((f) => s[f]));
}

/**
 * Diff two manifests at skill granularity.
 *
 * Call convention:
 *   Push preview: diffManifests(local, remote)  — what changes in remote
 *   Pull preview: diffManifests(remote, local)  — what changes locally
 */
export function diffManifests(
  source: RegistryManifest,
  target: RegistryManifest,
): ManifestDiff {
  const sourceMap = new Map(source.skills.map((s) => [s.name, s]));
  const targetMap = new Map(target.skills.map((s) => [s.name, s]));

  const added: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const [name, skill] of sourceMap) {
    const existing = targetMap.get(name);
    if (!existing) {
      added.push(name);
    } else if (skillSignature(skill) !== skillSignature(existing)) {
      changed.push(name);
    } else {
      unchanged.push(name);
    }
  }

  const removed = [...targetMap.keys()].filter((n) => !sourceMap.has(n));

  return { added, removed, changed, unchanged };
}
