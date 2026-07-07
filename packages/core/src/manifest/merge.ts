import fs from "node:fs";
import path from "node:path";
import {
  coerceManifestToCurrent,
  MANIFEST_SCHEMA_VERSION,
  serializeManifest,
  type ManifestSkill,
  type RegistryManifest,
} from "./manifest.js";
import { skillSignature } from "./diff.js";
import { getStateDir } from "../shared/paths.js";

/**
 * Three-way merge of registry manifests — the engine behind git-like
 * push/pull that preserves intentional divergence WITHOUT a git merge
 * driver and WITHOUT decomposing the manifest into per-skill files.
 *
 *   - `base`   — the last-synced manifest snapshot (the merge base).
 *   - `ours`   — the local registry's current export (pre-write).
 *   - `theirs` — the repo's current committed manifest (fetched on pull).
 *
 * Per skill, the outcome follows the classic three-way table, where an
 * absent entry is itself a value (so deletions merge like edits):
 *
 *   neither side changed vs base   → keep (no-op)
 *   only ours changed              → take ours  (local edit/add/delete)
 *   only theirs changed            → take theirs (remote edit/add/delete)
 *   both changed to the SAME value → take it    (convergent; no conflict)
 *   both changed DIFFERENTLY       → CONFLICT
 *   one side edits, other deletes  → CONFLICT
 *
 * "Same skill" is decided by `skillSignature` — the exact field set
 * `diffManifests` compares — so the merge engine and the diff preview
 * never disagree about what counts as a change.
 *
 * Conflicted skills are OMITTED from `merged`; they carry no entry
 * there until the resolver (`ManifestConflictModal`) folds a decision
 * back in. The function is pure — no I/O, no clock — so it is fully
 * table-testable and safe to call from either process.
 */

export type ManifestConflictKind =
  | "both-modified"
  | "both-added"
  | "ours-modified-theirs-deleted"
  | "theirs-modified-ours-deleted";

export interface ManifestConflict {
  name: string;
  kind: ManifestConflictKind;
  /** Entry at the merge base, or null if the skill was absent there. */
  base: ManifestSkill | null;
  /** Local entry, or null if locally deleted. */
  ours: ManifestSkill | null;
  /** Remote entry, or null if remotely deleted. */
  theirs: ManifestSkill | null;
}

export interface ManifestMergeResult {
  /** The unambiguously-merged manifest. Skills sorted by name; conflicted
   *  skills excluded. */
  merged: RegistryManifest;
  conflicts: ManifestConflict[];
}

/** Equal under the shared signature — undefined (absent) is a value. */
function sameEntry(
  a: ManifestSkill | undefined,
  b: ManifestSkill | undefined,
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return skillSignature(a) === skillSignature(b);
}

export function mergeManifests(
  base: RegistryManifest,
  ours: RegistryManifest,
  theirs: RegistryManifest,
): ManifestMergeResult {
  const baseMap = new Map(base.skills.map((s) => [s.name, s]));
  const ourMap = new Map(ours.skills.map((s) => [s.name, s]));
  const theirMap = new Map(theirs.skills.map((s) => [s.name, s]));

  const names = [
    ...new Set([...ourMap.keys(), ...theirMap.keys(), ...baseMap.keys()]),
  ].sort((a, b) => a.localeCompare(b));

  const mergedSkills: ManifestSkill[] = [];
  const conflicts: ManifestConflict[] = [];

  for (const name of names) {
    const b = baseMap.get(name);
    const o = ourMap.get(name);
    const t = theirMap.get(name);

    const oursChanged = !sameEntry(b, o);
    const theirsChanged = !sameEntry(b, t);

    // Only ours changed (or nothing changed): ours is authoritative. A
    // present entry is kept; a local deletion (o === undefined) drops it.
    if (!theirsChanged) {
      if (o) mergedSkills.push(o);
      continue;
    }
    // Only theirs changed: apply the remote entry / deletion.
    if (!oursChanged) {
      if (t) mergedSkills.push(t);
      continue;
    }
    // Both changed the same way (including both-deleted): no conflict.
    if (sameEntry(o, t)) {
      if (o) mergedSkills.push(o);
      continue;
    }
    // Both changed differently — genuine divergence the user must judge.
    conflicts.push({
      name,
      kind: classifyConflict(b, o, t),
      base: b ?? null,
      ours: o ?? null,
      theirs: t ?? null,
    });
  }

  const merged: RegistryManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    skills: mergedSkills,
  };
  return { merged, conflicts };
}

/**
 * Label a confirmed conflict for the resolver UI. Reachable only from
 * the both-changed-differently branch, which constrains the cases:
 *   - base absent → both sides added the name (to different values).
 *   - base present + one side deleted → an edit-vs-delete conflict.
 *   - otherwise both sides edited an existing entry differently.
 */
function classifyConflict(
  base: ManifestSkill | undefined,
  ours: ManifestSkill | undefined,
  theirs: ManifestSkill | undefined,
): ManifestConflictKind {
  if (!base) return "both-added";
  if (ours && !theirs) return "ours-modified-theirs-deleted";
  if (!ours && theirs) return "theirs-modified-ours-deleted";
  return "both-modified";
}

/**
 * How the user resolved a single manifest conflict in the modal:
 *   - `keep-mine`  — the local side wins (keep ours; a local deletion
 *     stays deleted).
 *   - `use-theirs` — the remote side wins (take theirs; accept a remote
 *     deletion, propagating it locally).
 *   - `keep-both`  — genuine divergence worth preserving: keep theirs at
 *     the original name and fork ours to `<name>-local`.
 */
export type ManifestResolution = "keep-mine" | "use-theirs" | "keep-both";

/** name → chosen resolution, produced by the resolver modal. */
export type ManifestDecisions = Record<string, ManifestResolution>;

export interface ResolvedMerge {
  /** The merged manifest with every conflict decision folded in. */
  manifest: RegistryManifest;
  /**
   * Local skills to delete so a remote deletion propagates — names the
   * user accepted as gone (`use-theirs` where theirs is absent, or
   * `keep-mine` where ours is absent). Feed straight to
   * `importRegistryManifest`'s `removeNames` arm.
   */
  removeNames: string[];
  /**
   * `keep-both` forks: the local skill at `from` must be renamed to
   * `to` (`<name>-local`) on disk before reconcile, and both entries
   * appear in `manifest`. The on-disk rename uses `resolveRenameTarget`
   * / `applyConflictDecision` at the caller (it owns the filesystem).
   */
  renamed: { from: string; to: string }[];
}

/**
 * Fold user decisions into a merge result, producing the final manifest
 * plus the removal/rename intents the reconcile step needs. Pure — the
 * caller performs the disk mutations (`importRegistryManifest`,
 * folder rename). Conflicts without a decision default to `keep-mine`
 * (the safe, non-destructive choice), matching the modal's default.
 */
export function applyManifestResolutions(
  mergeResult: ManifestMergeResult,
  decisions: ManifestDecisions,
): ResolvedMerge {
  const skills = [...mergeResult.merged.skills];
  const removeNames: string[] = [];
  const renamed: { from: string; to: string }[] = [];

  for (const c of mergeResult.conflicts) {
    const choice = decisions[c.name] ?? "keep-mine";
    if (choice === "keep-mine") {
      if (c.ours) skills.push(c.ours);
      else removeNames.push(c.name); // ours deleted locally → keep it gone
    } else if (choice === "use-theirs") {
      if (c.theirs) skills.push(c.theirs);
      else removeNames.push(c.name); // theirs deleted → propagate removal
    } else {
      // keep-both: theirs keeps the name; ours forks to <name>-local.
      const forkName = `${c.name}-local`;
      if (c.theirs) skills.push(c.theirs);
      if (c.ours) {
        skills.push({ ...c.ours, name: forkName });
        renamed.push({ from: c.name, to: forkName });
      }
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return {
    manifest: { ...mergeResult.merged, skills },
    removeNames,
    renamed,
  };
}

const PENDING_FILE = "pending-manifest-conflicts.json";

export interface PendingManifestConflicts {
  /** ISO-8601 stamp set by the caller when the merge ran. */
  mergedAt: string;
  conflicts: ManifestConflict[];
  /**
   * The auto-merged manifest (conflicts excluded). Persisted alongside
   * the conflicts so the resolve step can fold decisions back in without
   * re-fetching `theirs` and re-running the merge.
   */
  merged: RegistryManifest;
  /**
   * The remote manifest this merge ran against. Persisted so the resolve
   * step can advance the merge base to it — once resolved, the local
   * registry has fully incorporated `theirs`, so it becomes the new
   * "last known remote" reference for the next merge. See
   * `writeMergeBase`.
   */
  theirs: RegistryManifest;
}

/**
 * Persist unresolved merge conflicts so the resolver UI survives a
 * restart — the manifest-merge analogue of sync's `pending-conflicts.json`.
 * An empty conflict list clears any stale file instead of writing one.
 */
export function writePendingManifestConflicts(
  registryRoot: string,
  payload: PendingManifestConflicts,
): void {
  const stateDir = getStateDir(registryRoot);
  const dest = path.join(stateDir, PENDING_FILE);
  if (payload.conflicts.length === 0) {
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    return;
  }
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(payload, null, 2) + "\n");
}

export function readPendingManifestConflicts(
  registryRoot: string,
): PendingManifestConflicts | null {
  const p = path.join(getStateDir(registryRoot), PENDING_FILE);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as PendingManifestConflicts;
  } catch {
    return null;
  }
}

/** Best-effort removal of the pending-conflicts file (stuck-state recovery). */
export function clearPendingManifestConflicts(registryRoot: string): {
  removed: boolean;
} {
  const p = path.join(getStateDir(registryRoot), PENDING_FILE);
  if (!fs.existsSync(p)) return { removed: false };
  fs.unlinkSync(p);
  return { removed: true };
}

const MERGE_BASE_FILE = "merge-base.json";

/**
 * The merge base: this machine's best knowledge of the LINKED REPO's
 * manifest content — a per-machine remote-tracking reference, not a
 * shared file. Advanced to the remote's content after every successful
 * sync (to `theirs` after a pull-merge, to the pushed manifest after a
 * push), so the next `mergeManifests` can tell "we changed this" from
 * "they changed this". `null` before the first sync, which the caller
 * treats as an empty base (everything reads as added).
 *
 * Stored canonically (via `serializeManifest`) so it doesn't churn, and
 * kept in the local state dir — it never travels with the registry.
 */
export function writeMergeBase(
  registryRoot: string,
  manifest: RegistryManifest,
): void {
  const stateDir = getStateDir(registryRoot);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, MERGE_BASE_FILE),
    serializeManifest(manifest),
  );
}

export function readMergeBase(registryRoot: string): RegistryManifest | null {
  const p = path.join(getStateDir(registryRoot), MERGE_BASE_FILE);
  if (!fs.existsSync(p)) return null;
  try {
    return coerceManifestToCurrent(JSON.parse(fs.readFileSync(p, "utf8")));
  } catch {
    return null;
  }
}
