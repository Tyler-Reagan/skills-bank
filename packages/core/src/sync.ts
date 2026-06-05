import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { writeUpstreamCanonNames } from "./canon.js";
import { applyConflictDecision } from "./conflict.js";
import { discoverSkillsInTree } from "./discovery.js";
import { hashSkillFolder, readSyncedHash, writeSyncedHash } from "./heal.js";
import { getStateDir } from "./paths.js";
import { findSkillFolder, walkSkills, type SkillBucket } from "./registry.js";
import {
  readSkillSource,
  writeSkillSource,
  type SkillSource,
} from "./source.js";

const GH_API_BASE = "https://api.github.com";
const USER_AGENT = "skills-bank";

export interface FetchTarballOptions {
  owner: string;
  repo: string;
  /** Branch, tag, or SHA. Defaults to "main". */
  ref?: string;
  /** Optional bearer token for private repos. */
  token?: string;
}

export interface FetchTarballResult {
  /** Absolute path to the extracted directory containing the tarball's top-level folder. */
  extractedRoot: string;
  /** Resolved commit SHA for the requested ref. */
  commitSha: string;
  /** Cleanup callback — caller invokes after applyCanonicalSync. */
  cleanup: () => void;
}

export interface ConflictEntry {
  name: string;
  /** Source marker on the user's local skill that blocked the upsert. */
  localSource: SkillSource;
  /** Path to the canonical version inside the extracted tarball. */
  canonicalPath: string;
}

export interface SyncReport {
  /** Skills written/overwritten as canonical this run. */
  upserted: string[];
  /** Skills skipped because a non-canonical local version exists. */
  conflicts: ConflictEntry[];
  /** Skills locally tagged canonical but absent from the canonical tarball. */
  orphaned: string[];
  /** Resolved commit SHA the sync was applied against. */
  commitSha: string;
  /** ISO-8601 timestamp the sync ran. */
  syncedAt: string;
  /**
   * Conflicts auto-resolved this run via stored sync-decisions.
   * Empty on a sync where the user hadn't yet chosen actions.
   */
  resolved: ResolvedEntry[];
  /**
   * Discovery-time anomalies from the source tree. Surfaced rather
   * than auto-resolved — when either array is non-empty the caller
   * should decide whether to proceed or abort the link/sync.
   * `collisions`: same skill name found at >1 location in the
   * source tree. `nested`: a skill folder located inside another
   * skill folder (outer mounts; inner is suppressed).
   */
  discoveryCollisions?: { name: string; paths: string[] }[];
  discoveryNested?: { outer: string; inner: string }[];
}

export interface ApplyCanonicalSyncOptions {
  /**
   * Which local bucket the synced skills mount into. The call site
   * encodes the policy:
   *   - `vendored` — sync from the curated/bundled repo (IPC.syncCanonical).
   *   - `personal` — link a user's own GitHub repo (IPC.reposReplaceRegistry).
   * No default: every caller must declare intent.
   */
  mountTo: SkillBucket;
}

export type ConflictAction = "keep-mine" | "use-canonical" | "rename-mine";

export interface ConflictDecision {
  action: ConflictAction;
  decidedAt: string;
}

/** name → decision. Persisted at .skills-bank/sync-decisions.json. */
export type SyncDecisions = Record<string, ConflictDecision>;

export interface ResolvedEntry {
  name: string;
  action: ConflictAction;
  /** When action === "rename-mine", the new name the local skill was moved to. */
  renamedTo?: string;
}

/**
 * Resolve a ref to a commit SHA via the GitHub commits API, then download
 * the tarball for that exact SHA. Two requests, but the SHA is then
 * authoritative for recording in each upserted skill's .skills-bank.json.
 */
export async function fetchCanonicalTarball(
  opts: FetchTarballOptions,
): Promise<FetchTarballResult> {
  const ref = opts.ref ?? "main";
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/vnd.github+json",
  };
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  const commitsUrl = `${GH_API_BASE}/repos/${opts.owner}/${opts.repo}/commits/${encodeURIComponent(ref)}`;
  const commitRes = await fetch(commitsUrl, { headers });
  if (!commitRes.ok) {
    throw new Error(
      `GitHub commits API ${commitRes.status}: ${await commitRes.text()}`,
    );
  }
  const commitData = (await commitRes.json()) as { sha?: string };
  if (!commitData.sha) throw new Error("commits API response missing sha");
  const commitSha = commitData.sha;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-sync-"));
  const tarPath = path.join(tmpDir, "tarball.tgz");

  const tarUrl = `${GH_API_BASE}/repos/${opts.owner}/${opts.repo}/tarball/${commitSha}`;
  const tarRes = await fetch(tarUrl, { headers });
  if (!tarRes.ok || !tarRes.body) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`GitHub tarball ${tarRes.status}: ${tarUrl}`);
  }

  const buf = Buffer.from(await tarRes.arrayBuffer());
  fs.writeFileSync(tarPath, buf);
  await tar.extract({ file: tarPath, cwd: tmpDir });
  fs.unlinkSync(tarPath);

  // GitHub tarballs unpack into a single top-level dir like
  // `Tyler-Reagan-skills-bank-<short_sha>/`. Locate it.
  const dirs = fs
    .readdirSync(tmpDir, { withFileTypes: true })
    .filter((e) => e.isDirectory());
  if (dirs.length !== 1) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(
      `expected one top-level dir in tarball, got ${dirs.length}`,
    );
  }
  const extractedRoot = path.join(tmpDir, dirs[0]!.name);

  return {
    extractedRoot,
    commitSha,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

// v0.11.9 M5: rename-target resolver + decision applicator moved to
// `./conflict.ts` so Merge shares the implementation. Imported below.

/**
 * Walk the canonical tarball's `skills/` dir and upsert each skill into
 * `<registryRoot>/skills/`. Conflicts on name collisions with
 * user-authored skills are either auto-resolved via the provided
 * decisions map or queued in the report for the M5 resolver UI.
 * Skills locally marked canonical that no longer exist in canonical
 * are reported as orphaned but never auto-deleted.
 */
export async function applyCanonicalSync(
  registryRoot: string,
  extractedRoot: string,
  commitSha: string,
  decisions: SyncDecisions = {},
  opts: ApplyCanonicalSyncOptions = { mountTo: "vendored" },
): Promise<SyncReport> {
  const { mountTo } = opts;
  const localBucketDir = path.join(registryRoot, "skills", mountTo);
  fs.mkdirSync(localBucketDir, { recursive: true });

  // Discovery walks the entire extracted tree by file convention,
  // so flat repos / bucketed repos / docs-nested repos all work.
  // Anomalies (collisions, nested) surface in the report; callers
  // decide whether to proceed.
  const discovery = discoverSkillsInTree(extractedRoot);

  const syncedAt = new Date().toISOString();
  const upserted: string[] = [];
  const conflicts: ConflictEntry[] = [];
  const resolved: ResolvedEntry[] = [];

  const canonicalNames = new Set<string>();
  for (const skill of discovery.discoveries) {
    const { name, sourceDir } = skill;
    canonicalNames.add(name);

    // Local lookup walks both buckets so a skill that pre-exists in
    // the OTHER bucket is treated as an existing entry, not silently
    // duplicated under the mount bucket.
    const existing = findSkillFolder(registryRoot, name);
    const localPath = existing?.dir ?? path.join(localBucketDir, name);
    const localExists = existing !== null;

    let preservedSource: SkillSource | null = null;
    if (localExists) {
      const existingSource = readSkillSource(localPath);
      // v1.5: conflict detection keys off `syncedFromCommit`, not
      // the source axis. Pre-v1.5 used `source !== "curated"` as a
      // proxy for "is this user-authored?", which worked when every
      // sync stamped curated. With v1.5's mountTo policy
      // (linked-repo syncs stamp `source: user`), the proxy
      // misfires: legitimately-previously-synced linked-repo skills
      // surface as fake conflicts because their source is `user`.
      // The correct discriminator is `syncedFromCommit` presence —
      // every sync stamps it; user-authored skills don't carry one.
      //
      // Also treat source: "curated" skills as previously-synced even
      // when syncedFromCommit is absent. These are seeded bundled skills
      // (from seedManagedRegistryIfEmpty or reset:fresh) — not
      // user-authored content. The first boot-sync overwrites them
      // cleanly and stamps a real syncedFromCommit.
      const isPreviouslySynced =
        !!existingSource.syncedFromCommit ||
        existingSource.source === "curated";
      if (!isPreviouslySynced) {
        const decision = decisions[name];
        if (decision) {
          // Apply the stored resolution via the shared primitive.
          // keep-mine skips the canonical write entirely; the other
          // two arms fall through to the cpSync below.
          const effect = applyConflictDecision({
            localSkillsDir: path.dirname(localPath),
            localPath,
            name,
            decision,
          });
          if (effect.kind === "keep-mine") {
            resolved.push({ name, action: "keep-mine" });
            continue;
          }
          if (effect.kind === "rename-mine") {
            resolved.push({
              name,
              action: "rename-mine",
              renamedTo: effect.renamedTo,
            });
          } else {
            resolved.push({ name, action: "use-canonical" });
          }
        } else {
          conflicts.push({
            name,
            localSource: existingSource,
            canonicalPath: sourceDir,
          });
          continue;
        }
      } else {
        // Canonical → canonical: skip if content hash is unchanged.
        const incomingHash = hashSkillFolder(sourceDir);
        const storedHash = readSyncedHash(localPath);
        if (incomingHash && storedHash && incomingHash === storedHash) {
          continue;
        }
        // Overwrite in place. Preserve the existing source's `upstream`
        // pointer so per-skill origin attribution survives the wipe.
        preservedSource = existingSource;
        fs.rmSync(localPath, { recursive: true, force: true });
      }
    }

    // Mount path is always under `mountTo`, even if `existing` was in
    // the other bucket — the conflict arms above handled the
    // non-bundled-other-bucket case; this branch is a fresh write.
    const mountPath = path.join(localBucketDir, name);
    fs.mkdirSync(path.dirname(mountPath), { recursive: true });
    fs.cpSync(sourceDir, mountPath, { recursive: true });
    // Read whatever source-axis state the mirrored .skills-bank.json
    // carries so per-skill `origin` survives the sync stamp. Without
    // this spread, every sync silently wipes origin attribution
    // (pre-existing oddity since v0.11.3, fixed in v1.2).
    //
    // v1.5: source axis is mountTo-derived. `personal` syncs stamp
    // `user`. `vendored` syncs preserve `"curated"` for already-
    // committed bundled skills and use `"vendored"` for anything else —
    // the sync path must never produce NEW `"curated"` entries; that
    // designation is reserved for committed `.skills-bank.json` files.
    const mirroredSource = readSkillSource(mountPath);
    const priorSource = (preservedSource ?? mirroredSource).source;
    const sourceForBucket =
      mountTo === "personal"
        ? "user"
        : priorSource === "curated"
          ? "curated"
          : "vendored";
    const merged: SkillSource = {
      ...(preservedSource ?? mirroredSource),
      source: sourceForBucket,
      syncedFromCommit: commitSha,
      syncedAt,
    };
    writeSkillSource(mountPath, merged);
    // Snapshot content hash so future builds can detect local edits
    // to bundled copies (the edited-without-origin heal state).
    const h = hashSkillFolder(mountPath);
    if (h) writeSyncedHash(mountPath, h);
    upserted.push(name);
  }

  // Scope orphan detection to the current sync channel. Curated syncs
  // only orphan `source: "curated"` skills; linked-repo syncs only
  // orphan `source: "user"` skills. Without this gate, curated skills
  // like find-skills (curated + syncedFromCommit) are falsely flagged
  // when pulling from a linked repo that doesn't include them.
  const expectedSource = mountTo === "vendored" ? "curated" : "user";
  const orphaned: string[] = [];
  for (const ref of walkSkills(registryRoot)) {
    if (canonicalNames.has(ref.name)) continue;
    const src = readSkillSource(ref.dir);
    if (src.syncedFromCommit && src.source === expectedSource) {
      orphaned.push(ref.name);
    }
  }

  const report: SyncReport = {
    upserted,
    conflicts,
    orphaned,
    commitSha,
    syncedAt,
    resolved,
    ...(discovery.collisions.length > 0
      ? { discoveryCollisions: discovery.collisions }
      : {}),
    ...(discovery.nested.length > 0
      ? { discoveryNested: discovery.nested }
      : {}),
  };

  // Persist the report and any pending conflicts so the renderer can
  // surface them across restarts (M5's resolver consumes pending-conflicts).
  const stateDir = getStateDir(registryRoot);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "last-sync.json"),
    JSON.stringify(report, null, 2) + "\n",
  );

  // M2: snapshot the canonical name set so buildRegistryIndex can
  // populate RegistryEntry.canon without re-fetching upstream on every
  // call. canonicalNames is the authoritative upstream set for this
  // sync — every name we just considered, regardless of which arm of
  // the conflict resolver each took.
  writeUpstreamCanonNames(registryRoot, [...canonicalNames], "synced");
  if (conflicts.length > 0) {
    fs.writeFileSync(
      path.join(stateDir, "pending-conflicts.json"),
      JSON.stringify({ syncedAt, commitSha, conflicts }, null, 2) + "\n",
    );
  } else {
    // Clear any stale pending-conflicts file from a prior sync.
    const stale = path.join(stateDir, "pending-conflicts.json");
    if (fs.existsSync(stale)) fs.unlinkSync(stale);
  }

  return report;
}

export function readLastSyncReport(registryRoot: string): SyncReport | null {
  const p = path.join(getStateDir(registryRoot), "last-sync.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as SyncReport;
  } catch {
    return null;
  }
}

interface PendingConflictsFile {
  syncedAt: string;
  commitSha: string;
  conflicts: ConflictEntry[];
}

export function readPendingConflicts(
  registryRoot: string,
): PendingConflictsFile | null {
  const p = path.join(getStateDir(registryRoot), "pending-conflicts.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as PendingConflictsFile;
  } catch {
    return null;
  }
}

/**
 * Best-effort delete of the pending-conflicts state file. Used by the
 * stuck-state recovery action in the UI when a prior sync left
 * decisions half-applied.
 */
export function clearPendingConflicts(registryRoot: string): {
  removed: boolean;
} {
  const p = path.join(getStateDir(registryRoot), "pending-conflicts.json");
  if (!fs.existsSync(p)) return { removed: false };
  fs.unlinkSync(p);
  return { removed: true };
}

export function readSyncDecisions(registryRoot: string): SyncDecisions {
  const p = path.join(getStateDir(registryRoot), "sync-decisions.json");
  if (!fs.existsSync(p)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Record<
      string,
      Partial<ConflictDecision>
    >;
    const out: SyncDecisions = {};
    for (const [name, dec] of Object.entries(raw)) {
      if (
        dec.action === "keep-mine" ||
        dec.action === "use-canonical" ||
        dec.action === "rename-mine"
      ) {
        out[name] = {
          action: dec.action,
          decidedAt:
            typeof dec.decidedAt === "string"
              ? dec.decidedAt
              : new Date().toISOString(),
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function writeSyncDecisions(
  registryRoot: string,
  decisions: SyncDecisions,
): void {
  const stateDir = getStateDir(registryRoot);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "sync-decisions.json"),
    JSON.stringify(decisions, null, 2) + "\n",
  );
}
