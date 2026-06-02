import fs from "node:fs";
import path from "node:path";
import {
  MANIFEST_SCHEMA_VERSION,
  type ManifestSkill,
  type RegistryManifest,
} from "./manifest.js";
import { skillSignature } from "./manifest-diff.js";
import { getStateDir } from "./paths.js";

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
 * there until the resolver (`ConflictResolutionModal`) folds a decision
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
  /**
   * The unambiguously-merged manifest. Skills sorted by name; conflicted
   * skills excluded. `sourceBankVersion`/`registryRoot`/`exportedAt`
   * carry from `ours` — the local bank is authoring the merge.
   */
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
    exportedAt: ours.exportedAt,
    sourceBankVersion: ours.sourceBankVersion,
    ...(ours.registryRoot ? { registryRoot: ours.registryRoot } : {}),
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

const PENDING_FILE = "pending-manifest-conflicts.json";

export interface PendingManifestConflicts {
  /** ISO-8601 stamp set by the caller when the merge ran. */
  mergedAt: string;
  conflicts: ManifestConflict[];
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
