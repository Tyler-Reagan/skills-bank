import fs from "node:fs";
import path from "node:path";
import { buildRegistryIndex } from "../registry/build.js";
import { hashSkillFolder } from "../registry/heal.js";
import { setRuntimeEntry } from "../registry/runtime-map.js";
import { findSkillFolder } from "../registry/walk.js";
import { isGithubUrl, parseOwnerRepo } from "../github/url.js";
import {
  folderPathFromSkillPath,
  installSkillFiles,
} from "../github/origin.js";
import { deleteFromBankSkill } from "../skills/install.js";
import { type LabelsMap } from "../registry/labels.js";
import {
  type RegistryManifest,
  type ManifestSkill,
  type ManifestOrigin,
  coerceManifestToCurrent,
  originsEqual,
  toPushedProjection,
  bucketForManifestSkill,
  recordLabelOverride,
  readLiveManifest,
  writeLiveManifest,
} from "./manifest.js";

export type ImportSkillOutcome =
  | { name: string; result: "registered" }
  | { name: string; result: "origin-unreachable"; reason: string }
  | { name: string; result: "collision"; existingOrigin: ManifestOrigin }
  | { name: string; result: "skipped"; reason: string };

export interface ManifestRemovalResult {
  name: string;
  ok: boolean;
  message: string;
}

export interface ImportRegistryManifestResult {
  outcomes: ImportSkillOutcome[];
  /**
   * Per-skill results of the confirmed-removal arm (Gap 2). Present
   * only when `opts.removeNames` was supplied. A name absent from the
   * local registry is a no-op success (the deletion already
   * propagated). Empty/omitted on a purely additive import.
   */
  removed?: ManifestRemovalResult[];
  /**
   * Reconstructed label overrides keyed by skill name, for every
   * registered skill whose effective category/tags differ from pure
   * auto-derivation. The caller (desktop main) merges this into the
   * app's `labels.json` so curation travels with the pull. Skills whose
   * labels match auto-derivation are omitted (no override needed).
   */
  restoredLabels?: LabelsMap;
  /**
   * Set to `true` when the per-skill loop was aborted via the
   * caller-supplied `AbortSignal`. Already-mirrored skills remain
   * on disk and surface in `outcomes`; remaining manifest entries
   * are simply not processed. Omitted when the import ran to
   * completion.
   */
  cancelled?: boolean;
}

/**
 * Per-skill progress event fired by `importRegistryManifest` via the
 * `onProgress` callback. The `completed` count reflects how many of
 * the manifest's `total` skills have finished processing (registered,
 * collision, OR origin-unreachable). `currentName` is the skill the
 * loop is ABOUT to process next; consumers can render it as "Importing
 * 7/23: foo-skill". `lastError` is set when the prior iteration ended
 * in failure (origin-unreachable), carrying the same reason message
 * that landed in the outcomes array.
 *
 * The first event of an import fires before any per-skill work starts:
 * `completed: 0`, `currentName` = the first skill. The final event
 * fires when the loop exits cleanly with `completed === total` (and
 * `currentName` set to the last processed skill, retained for the
 * renderer's terminal state).
 */
export interface ManifestImportProgressEvent {
  completed: number;
  total: number;
  currentName: string;
  lastError?: string;
  /**
   * Full ordered list of skill names in the manifest. Sent on the FIRST
   * progress event of an import so the renderer can pre-render
   * ghost-card placeholders. Subsequent events omit this field.
   */
  manifestNames?: string[];
  /**
   * Full manifest skill entries — same payload as
   * `RegistryManifest.skills`. Sent on the FIRST progress event so
   * Tier-3 ghost cards have the origin info they need to drive the
   * per-skill retry action. Renderer-side payload size is
   * proportional to manifest size; typical manifests (≤100 skills)
   * remain well under any reasonable wire-format budget.
   */
  manifestSkills?: ManifestSkill[];
}

export interface ImportRegistryManifestOptions {
  /**
   * GitHub OAuth token for mirroring GitHub-origin skills. `null`
   * falls through to unauthenticated probes (60/hr rate limit).
   */
  token?: string | null;
  /**
   * Optional abort signal. When fired, the per-skill loop exits at
   * the top of the next iteration. Already-mirrored skills stay on
   * disk (no rollback) and are reflected in the returned outcomes;
   * the result carries `cancelled: true`.
   */
  signal?: AbortSignal;
  /**
   * Optional per-skill progress callback. Fired at the top of each
   * iteration with the cumulative `completed` count and the
   * `currentName` about to be processed. First fire of an import
   * carries `manifestNames` (the full ordered name list) so the
   * renderer can pre-render Tier-3 ghost cards before any per-skill
   * mirroring starts. See `ManifestImportProgressEvent`.
   */
  onProgress?: (event: ManifestImportProgressEvent) => void;
  /**
   * Confirmed-removal arm (Gap 2). Skill names the caller has decided
   * should be deleted from the local registry — typically the local
   * skills that a three-way merge resolved as "deleted upstream" (so
   * the deletion propagates rather than silently resurrecting on the
   * next export). Each name is removed via `deleteFromBankSkill` (bank
   * copy + agent-dir symlinks) AFTER the additive pass.
   *
   * Defaulting to additive-only when omitted is deliberate: the broad
   * import path (account import, wipe-and-re-import) must NEVER delete
   * a local skill just because the manifest it's applying doesn't list
   * it. Only the merge-reconcile caller, holding a user-confirmed
   * removal set, opts in.
   */
  removeNames?: string[];
  /**
   * Active linked repo `owner/name`. Determines the bucket a newly
   * mirrored skill lands in (`bucketForManifestSkill`).
   */
  linkedRepo?: string;
}

/**
 * Apply a manifest to `registryRoot`. For each manifest entry with
 * no local record, mirror content from its origin URL via
 * `installSkillFiles` and stamp the resulting manifest row + runtime
 * baseline. Existing entries are inspected for origin collisions:
 * same-origin matches have their label override restored, divergent
 * origins surface as `collision` outcomes.
 *
 * Never installs into agent dirs.
 */
export async function importRegistryManifest(
  registryRoot: string,
  manifest: unknown,
  opts: ImportRegistryManifestOptions = {},
): Promise<ImportRegistryManifestResult> {
  const m = coerceManifestToCurrent(manifest);

  const outcomes: ImportSkillOutcome[] = [];
  const restoredLabels: LabelsMap = {};
  let cancelled = false;
  const total = m.skills.length;
  const manifestNames = m.skills.map((s) => s.name);
  let lastError: string | undefined;

  const liveManifest = readLiveManifest(registryRoot);
  const liveByName = new Map(liveManifest.skills.map((s) => [s.name, s]));

  for (let i = 0; i < m.skills.length; i++) {
    const skill = m.skills[i]!;
    if (opts.signal?.aborted) {
      cancelled = true;
      break;
    }
    if (opts.onProgress) {
      opts.onProgress({
        completed: i,
        total,
        currentName: skill.name,
        ...(lastError ? { lastError } : {}),
        ...(i === 0 ? { manifestNames, manifestSkills: m.skills } : {}),
      });
    }
    // Reset per-iteration; only the most recent failure surfaces in
    // the NEXT iteration's event so the renderer can mark exactly
    // the offending skill's ghost as errored.
    lastError = undefined;
    const existing = findSkillFolder(registryRoot, skill.name);
    if (existing) {
      const localOrigin = liveByName.get(skill.name)?.origin ?? { url: null };
      if (originsEqual(localOrigin, skill.origin)) {
        // Same-origin re-import: content already on disk and untouched
        // (labels live in labels.json, not the folder), so no re-hash is
        // needed. Just recover the label override for the caller.
        recordLabelOverride(restoredLabels, skill);
        outcomes.push({ name: skill.name, result: "registered" });
      } else {
        outcomes.push({
          name: skill.name,
          result: "collision",
          existingOrigin: localOrigin,
        });
        continue;
      }
    } else {
      const repo = parseOwnerRepo(skill.origin.url);
      if (!isGithubUrl(skill.origin.url) || !repo || !skill.origin.skillPath) {
        const reason = "manifest entry has no GitHub origin";
        outcomes.push({
          name: skill.name,
          result: "origin-unreachable",
          reason,
        });
        lastError = `${skill.name}: ${reason}`;
        continue;
      }
      const bucket = bucketForManifestSkill(skill, opts.linkedRepo);
      const destDir = path.join(registryRoot, "skills", bucket, skill.name);
      fs.mkdirSync(path.dirname(destDir), { recursive: true });
      const folderPath = folderPathFromSkillPath(skill.origin.skillPath);
      const mirror = await installSkillFiles(
        repo,
        folderPath,
        destDir,
        opts.token ?? null,
      );
      if (!mirror.ok) {
        outcomes.push({
          name: skill.name,
          result: "origin-unreachable",
          reason: mirror.message,
        });
        lastError = `${skill.name}: ${mirror.message}`;
        continue;
      }
      // Stamp the manifest row with the mirrored hash, and baseline the
      // runtime map's synced hash to the just-mirrored SHA-256 content
      // hash (not the GitHub tree SHA-1 in `mirror.folderHash` — that's
      // what drift detection compares). Metadata comes from the mirrored
      // SKILL.md frontmatter; labels live in labels.json, recovered for
      // the caller below.
      const idx = liveManifest.skills.findIndex((s) => s.name === skill.name);
      const row: ManifestSkill = {
        name: skill.name,
        origin: { ...skill.origin, hash: mirror.folderHash },
        category: skill.category,
        tags: skill.tags,
      };
      if (idx >= 0) liveManifest.skills[idx] = row;
      else liveManifest.skills.push(row);
      liveByName.set(skill.name, row);
      const localHash = hashSkillFolder(destDir);
      if (localHash)
        setRuntimeEntry(registryRoot, skill.name, { syncedHash: localHash });
      recordLabelOverride(restoredLabels, skill);
      outcomes.push({ name: skill.name, result: "registered" });
    }
  }

  writeLiveManifest(registryRoot, liveManifest);

  // Final terminal progress event so consumers can flip to a
  // "done" UI state without polling the result promise.
  if (opts.onProgress && !cancelled && m.skills.length > 0) {
    const lastSkill = m.skills[m.skills.length - 1]!;
    opts.onProgress({
      completed: outcomes.length,
      total,
      currentName: lastSkill.name,
      ...(lastError ? { lastError } : {}),
    });
  }

  const labelsOut =
    Object.keys(restoredLabels).length > 0 ? { restoredLabels } : {};

  if (cancelled) {
    return { outcomes, ...labelsOut, cancelled: true };
  }

  // Confirmed-removal arm. Runs only on a clean (non-cancelled)
  // completion so a half-applied import never also half-deletes.
  let removed: ManifestRemovalResult[] | undefined;
  if (opts.removeNames && opts.removeNames.length > 0) {
    removed = opts.removeNames.map((name) => {
      if (!findSkillFolder(registryRoot, name)) {
        // Already gone — the deletion has nothing left to propagate.
        return { name, ok: true, message: `${name} not in registry` };
      }
      const res = deleteFromBankSkill(name, { registryRoot });
      return { name, ok: res.ok, message: res.message };
    });
  }

  return removed
    ? { outcomes, ...labelsOut, removed }
    : { outcomes, ...labelsOut };
}

/**
 * Local skills absent from the manifest's PUSHED projection — the
 * deletion candidates for a reconcile. Diffing against
 * `toPushedProjection` (not a raw disk walk) means `url: null`
 * (local-only) skills are structurally immune: they never appear in a
 * pushed manifest to begin with, so they can never read as "deleted
 * upstream." Pure set diff; the caller decides whether to act on the
 * result (the confirmed-removal arm) or surface it for confirmation.
 */
export function computeManifestRemovals(
  registryRoot: string,
  manifest: RegistryManifest,
): string[] {
  const local = toPushedProjection(readLiveManifest(registryRoot));
  const keep = new Set(manifest.skills.map((s) => s.name));
  return local.skills.map((s) => s.name).filter((n) => !keep.has(n));
}

export interface ReconcileResult {
  /** Local skills actually removed to propagate manifest deletions. */
  removed: string[];
  /**
   * Label overrides the import reconstructed from the manifest. The
   * caller (desktop main) persists these into the app's `labels.json`,
   * which lives outside the registry root — so reconcile returns them
   * rather than writing them itself.
   */
  restoredLabels?: LabelsMap;
}

/**
 * Make the local registry match `manifest`: import adds/updates, delete
 * the skills the pushed manifest no longer lists (via
 * `computeManifestRemovals`, immune to `url: null` local-only skills),
 * then reconcile folders to the manifest and rebuild the index. The
 * complete "reconcile local to this manifest" op. The caller owns the
 * merge-base advance and persisting `restoredLabels`.
 */
export async function reconcileRegistryToManifest(
  registryRoot: string,
  manifest: RegistryManifest,
  opts: {
    token?: string | null;
    linkedRepo?: string;
    onProgress?: (event: ManifestImportProgressEvent) => void;
  } = {},
): Promise<ReconcileResult> {
  const removeNames = computeManifestRemovals(registryRoot, manifest);
  const result = await importRegistryManifest(registryRoot, manifest, {
    ...(opts.token !== undefined ? { token: opts.token } : {}),
    ...(opts.linkedRepo ? { linkedRepo: opts.linkedRepo } : {}),
    ...(removeNames.length > 0 ? { removeNames } : {}),
    ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
  });
  const { reconcileFoldersToManifest } =
    await import("../registry/reconcile-folders.js");
  reconcileFoldersToManifest(registryRoot, { linkedRepo: opts.linkedRepo });
  buildRegistryIndex(registryRoot, { includeGitInfo: true, writeFile: true });
  return {
    removed: (result.removed ?? []).filter((r) => r.ok).map((r) => r.name),
    ...(result.restoredLabels ? { restoredLabels: result.restoredLabels } : {}),
  };
}
