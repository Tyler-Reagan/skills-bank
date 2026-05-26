import type { RegistryManifest, ManifestSkill } from "./manifest.js";

export interface ManifestDiff {
  /** Names in source but not in target (will be added to target). */
  added: string[];
  /** Names in target but not in source (will be removed from target). */
  removed: string[];
  /** Names in both but with differing fields. */
  changed: string[];
  /** Count of skills identical in both. */
  unchanged: number;
}

const COMPARED_FIELDS: (keyof ManifestSkill)[] = [
  "source",
  "origin",
  "tags",
  "hidden",
  "dismissed",
];

function skillKey(s: ManifestSkill): string {
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
  let unchanged = 0;

  for (const [name, skill] of sourceMap) {
    const existing = targetMap.get(name);
    if (!existing) {
      added.push(name);
    } else if (skillKey(skill) !== skillKey(existing)) {
      changed.push(name);
    } else {
      unchanged++;
    }
  }

  const removed = [...targetMap.keys()].filter((n) => !sourceMap.has(n));

  return { added, removed, changed, unchanged };
}
