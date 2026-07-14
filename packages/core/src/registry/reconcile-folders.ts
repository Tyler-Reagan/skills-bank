import fs from "node:fs";
import path from "node:path";
import {
  readLiveManifest,
  writeLiveManifest,
  type RegistryManifest,
} from "../manifest/manifest.js";
import type { ManifestOrigin } from "../manifest/manifest.js";
import { getStateDir } from "../shared/paths.js";
import { effectiveLabels, type LabelsMap } from "./labels.js";
import { readLegacyOrigin } from "./legacy-origin.js";
import { npxEntryOrigin, readNpxLock, type NpxLock } from "./npx-lock.js";
import { bucketForOrigin } from "./source.js";
import { moveSkillBucket } from "./bucket-move.js";
import { removeRuntimeEntry } from "./runtime-map.js";
import {
  SkillNameCollisionError,
  walkSkills,
  type SkillFolderRef,
} from "./walk.js";

/** Confirmed dead: no code reads or writes these anymore (verify by grep before adding a name). */
const DEAD_STATE_FILES = ["external.json", "upstream-canon.json"];

/** Deletes DEAD_STATE_FILES if present. Missing files are a no-op. */
function sweepDeadStateFiles(registryRoot: string): void {
  const dir = getStateDir(registryRoot);
  for (const name of DEAD_STATE_FILES) {
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch {
      // already absent, or state dir doesn't exist yet — nothing to sweep
    }
  }
}

export interface ReconcileFoldersOptions {
  /** Label overrides keyed by skill name (the app's `labels.json`). */
  labels?: LabelsMap;
  /** Active linked repo `owner/name` — used to correct bucket drift. */
  linkedRepo?: string;
  /**
   * Override the npx global-lockfile path. Production leaves this unset
   * (resolves to the real `~/.agents/.skill-lock.json`); unit tests point
   * it at a fixture so they never read the developer's real lockfile.
   */
  npxLockPath?: string;
}

/**
 * Recover a real origin for a `url:null` skill: the in-folder legacy
 * sidecar first (stronger, in-folder evidence), then npx's global
 * lockfile by name. Returns null when neither has anything honest, so
 * the caller keeps the `url:null` resting state. Sidecar precedence
 * falls out of the ordering.
 */
function recoverOrigin(
  name: string,
  dir: string | undefined,
  npxLock: NpxLock,
): ManifestOrigin | null {
  return (dir ? readLegacyOrigin(dir) : null) ?? npxEntryOrigin(npxLock[name]);
}

/**
 * The single manifest-write seam (ADR-0020/0021). Adds an `origin:
 * {url: null}` row for every folder under `<root>/skills/` that has no
 * manifest row yet — a hand-copied folder, a from-scratch authored
 * skill, or drift from an interrupted operation. Never invents a true
 * origin for an orphan: `url: null` is the only honest answer reconcile
 * can give, and the manual origin picker is the null→url escape.
 *
 * Bidirectional: also drops any row whose folder no longer exists,
 * clearing its runtime entry alongside it. This is what lets every
 * removal path (unregister, purge, import-removal) call this one
 * function after mutating disk instead of hand-maintaining its own
 * copy of the folder⇔row invariant — a prior source of drift (issue
 * #209/#211/#213).
 *
 * Two exceptions — recovery, not invention: a `url: null` candidate (a
 * fresh orphan or an existing null row) adopts an origin from either a
 * surviving pre-#159 `.skills-bank.json` sidecar (finding F5) or npx's
 * global lockfile (a skill installed via `npx skills` outside the app —
 * its `sourceUrl` is a real recorded remote, #185), sidecar taking
 * precedence. So upgrading from a pre-origin-model registry, or adopting
 * an npx install, heals provenance instead of flattening it. A
 * correctness invariant that converges: once a row carries a real url
 * it's no longer a candidate, and neither source is mutated (the npx
 * lockfile is read-only — see `npx-lock.ts`).
 *
 * Also re-homes a row whose folder bucket disagrees with
 * `bucketForOrigin(origin.url, linkedRepo)`, and sweeps
 * `DEAD_STATE_FILES`.
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
  sweepDeadStateFiles(registryRoot);
  const manifest = readLiveManifest(registryRoot);
  const byName = new Map(manifest.skills.map((s) => [s.name, s]));
  const foldersByName = new Map<string, SkillFolderRef>(
    walkSkills(registryRoot).map((r) => [r.name, r]),
  );
  // Read npx's global lockfile once, up front — keeps reconcile
  // synchronous and disk-only (no async in the boot / post-mutation path).
  const npxLock = readNpxLock(opts.npxLockPath);

  for (const [name, ref] of foldersByName) {
    if (!byName.has(name)) {
      const row = {
        name,
        origin: readLegacyOrigin(ref.dir) ?? { url: null },
        category: null,
        tags: [],
      };
      byName.set(name, row);
      manifest.skills.push(row);
    }
  }

  // The reverse direction: a row whose folder is gone (moved out,
  // deleted) no longer belongs in the manifest. Drop it and its
  // runtime entry together so neither outlives the other.
  for (const name of [...byName.keys()]) {
    if (!foldersByName.has(name)) {
      byName.delete(name);
      removeRuntimeEntry(registryRoot, name);
    }
  }
  manifest.skills = manifest.skills.filter((s) => byName.has(s.name));

  // Heal every url:null row from a legacy sidecar or npx's lockfile if
  // either has a real origin. This loop re-examines every null row —
  // including the orphans loop 1 just pushed — so it's the sole hook
  // point for npx-lock recovery; loop 1 stays sidecar-only.
  for (const skill of manifest.skills) {
    if (skill.origin.url !== null) continue;
    const recovered = recoverOrigin(
      skill.name,
      foldersByName.get(skill.name)?.dir,
      npxLock,
    );
    if (recovered) skill.origin = recovered;
  }

  // Re-home rows whose bucket disagrees with their origin (ADR-0020).
  // url:null skips — that bucket is a deliberate placement, not drift.
  for (const skill of manifest.skills) {
    if (!skill.origin.url) continue;
    const ref = foldersByName.get(skill.name);
    if (!ref) continue;
    const expectedBucket = bucketForOrigin(skill.origin.url, opts.linkedRepo);
    if (ref.bucket === expectedBucket) continue;
    const result = moveSkillBucket(registryRoot, skill.name, expectedBucket);
    if (result.ok && result.newDir) {
      foldersByName.set(skill.name, {
        ...ref,
        bucket: expectedBucket,
        dir: result.newDir,
      });
    } else {
      console.warn(
        `[skills-bank] could not correct bucket drift for ${skill.name}: ${result.message}`,
      );
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

/**
 * `reconcileFoldersToManifest`, but a cross-bucket name collision on
 * disk doesn't propagate. Callers here are boot and the post-mutation
 * snapshot seam — a `SkillNameCollisionError` (someone's `skills/`
 * folder has the same name in both `personal/` and `vendored/`, an
 * invariant `walkSkills` is right to enforce for CI) must not crash the
 * running app or brick startup. Logged, not silent: only this specific,
 * already-modeled error is caught here; anything else still throws.
 * The manifest keeps its last-known-good state for the cycle — no
 * partial write, no data loss, nothing to clean up later.
 */
export function reconcileFoldersToManifestSafe(
  registryRoot: string,
  opts: ReconcileFoldersOptions = {},
): void {
  try {
    reconcileFoldersToManifest(registryRoot, opts);
  } catch (err) {
    if (err instanceof SkillNameCollisionError) {
      console.error(`[skills-bank] registry reconcile skipped: ${err.message}`);
      return;
    }
    throw err;
  }
}
