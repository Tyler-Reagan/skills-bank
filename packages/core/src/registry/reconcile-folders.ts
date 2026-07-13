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
import {
  SkillNameCollisionError,
  walkSkills,
  type SkillFolderRef,
} from "./walk.js";

/**
 * State files that no code anywhere reads or writes anymore, but that the
 * app never deleted a pre-existing copy of (#204):
 *   - `external.json` — the in-place-registration record, retired when
 *     ADR-0022 made the registry adopted-only (every skill now lives in
 *     the bank by construction; there is nothing left to be "external").
 *   - `upstream-canon.json` — predates ADR-0017's canon-file removal.
 * Verified dead by grep across packages/core and packages/desktop before
 * listing here — don't add a name without the same check.
 */
const DEAD_STATE_FILES = ["external.json", "upstream-canon.json"];

/**
 * Opportunistically deletes confirmed-dead state files (see
 * `DEAD_STATE_FILES`). Not a migration step — a correctness sweep that
 * happens to heal old data, run from the same seam as folder reconcile
 * (ADR-0021's "long-lived correctness invariant" convention). Missing
 * files are a no-op.
 */
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
 * Also corrects bucket-placement drift: a row whose folder location
 * disagrees with `bucketForOrigin(origin.url, linkedRepo)` gets physically
 * moved to the bucket its origin dictates (#205). Scoped to rows with a
 * known origin — a `url: null` folder's bucket is left alone.
 *
 * Also sweeps confirmed-dead state files (#204) — see
 * `DEAD_STATE_FILES` — from the same seam.
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

  // Bucket-placement drift correction (ADR-0020). A row's folder should
  // live in bucketForOrigin(origin.url, linkedRepo) — the acquisition-time
  // derivation. Rows can drift out of sync with a real origin (registered
  // before the derivation was wired correctly, or before this repo's own
  // linked-repo comparison existed) — heal it here so the drift doesn't
  // persist silently across every future boot. Scoped to rows with a known
  // (non-null) origin only: a url:null folder's bucket is a placement
  // someone made deliberately (or an orphan reconcile just discovered) and
  // is not this pass's business to relocate.
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
