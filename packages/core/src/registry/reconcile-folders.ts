import {
  readLiveManifest,
  writeLiveManifest,
  type RegistryManifest,
} from "../manifest/manifest.js";
import { effectiveLabels, type LabelsMap } from "./labels.js";
import { readLegacyOrigin } from "./legacy-origin.js";
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
 * One exception — a recovery, not an invention: a folder carrying a
 * pre-#159 `.skills-bank.json` sidecar is NOT origin-less; the sidecar
 * records where it came from. For any `url: null` candidate (a fresh
 * orphan or an existing null row) reconcile reads the sidecar and adopts
 * its origin (finding F5), so upgrading from a pre-origin-model registry
 * heals provenance instead of flattening it. A correctness invariant that
 * converges: once a row carries a real url it's no longer a candidate, and
 * the sidecar is left in place (no cleanup machinery).
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
  const dirByName = new Map(
    walkSkills(registryRoot).map((r) => [r.name, r.dir]),
  );

  for (const [name, dir] of dirByName) {
    if (!byName.has(name)) {
      const row = {
        name,
        origin: readLegacyOrigin(dir) ?? { url: null },
        category: null,
        tags: [],
      };
      byName.set(name, row);
      manifest.skills.push(row);
    }
  }

  // Heal existing url:null rows from a legacy sidecar if one survives —
  // covers registries already reconciled to all-null before this landed.
  for (const skill of manifest.skills) {
    if (skill.origin.url !== null) continue;
    const dir = dirByName.get(skill.name);
    const recovered = dir ? readLegacyOrigin(dir) : null;
    if (recovered) skill.origin = recovered;
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
