import {
  readLiveManifest,
  writeLiveManifest,
  type RegistryManifest,
} from "../manifest/manifest.js";
import { effectiveLabels, type LabelsMap } from "./labels.js";
import { walkSkills } from "./walk.js";

export interface ReconcileFoldersOptions {
  /** Label overrides keyed by skill name (the app's `labels.json`). */
  labels?: LabelsMap;
  /** Active linked repo `owner/name` — reserved for future bucket checks. */
  linkedRepo?: string;
}

/**
 * The single manifest-write seam (ADR-0020/0021). Adds an `origin:
 * {url: null}` row for every folder under `<root>/skills/` that has no
 * manifest row yet — a hand-copied folder, a from-scratch authored
 * skill, or drift from an interrupted operation. Never invents a true
 * origin for an orphan: `url: null` is the only honest answer reconcile
 * can give, and the manual origin picker is the null→url escape.
 *
 * Refreshes every row's category/tags from the supplied `labels.json`
 * so the manifest tracks current curation state. Called at boot and
 * from the `snapshotAfterMutation` seam — never from `buildRegistryIndex`,
 * which stays a pure read.
 */
export function reconcileFoldersToManifest(
  registryRoot: string,
  opts: ReconcileFoldersOptions = {},
): RegistryManifest {
  const manifest = readLiveManifest(registryRoot);
  const byName = new Map(manifest.skills.map((s) => [s.name, s]));

  for (const ref of walkSkills(registryRoot)) {
    if (!byName.has(ref.name)) {
      const row = {
        name: ref.name,
        origin: { url: null },
        category: null,
        tags: [],
      };
      byName.set(ref.name, row);
      manifest.skills.push(row);
    }
  }

  for (const skill of manifest.skills) {
    const { category, tags } = effectiveLabels(
      { category: skill.category, tags: skill.tags },
      opts.labels?.[skill.name],
    );
    skill.category = category;
    skill.tags = tags;
  }

  writeLiveManifest(registryRoot, manifest);
  return manifest;
}
