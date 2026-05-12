import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { writeUpstreamCanonNames } from "./canon.js";
import { getStateDir } from "./paths.js";
import {
  readSkillSource,
  writeSkillSource,
  type SkillSource,
} from "./source.js";

const GH_API_BASE = "https://api.github.com";
const USER_AGENT = "skills-bank";

// Read the `tags` field from a skill's meta.json, if present and valid.
// Returns null when the file is missing, malformed, or has no tag list.
function readMetaTags(skillDir: string): string[] | null {
  const metaPath = path.join(skillDir, "meta.json");
  if (!fs.existsSync(metaPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Record<
      string,
      unknown
    >;
    const tags = raw["tags"];
    if (!Array.isArray(tags)) return null;
    return tags.filter((t): t is string => typeof t === "string");
  } catch {
    return null;
  }
}

// Splice a tag list into a freshly-written canonical meta.json,
// preserving the user's local tag edits across a Sync.
function writeMetaTags(skillDir: string, tags: string[]): void {
  const metaPath = path.join(skillDir, "meta.json");
  if (!fs.existsSync(metaPath)) return;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return;
  }
  if (tags.length === 0) {
    delete raw["tags"];
  } else {
    raw["tags"] = tags;
  }
  fs.writeFileSync(metaPath, JSON.stringify(raw, null, 2) + "\n");
}

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

/**
 * Find an unused folder name for renaming a user-authored skill out of
 * the way of an incoming canonical one. Tries `<name>-local` first,
 * then `<name>-local-2`, `<name>-local-3`, etc.
 */
function resolveRenameTarget(skillsDir: string, name: string): string {
  const base = `${name}-local`;
  if (!fs.existsSync(path.join(skillsDir, base))) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!fs.existsSync(path.join(skillsDir, candidate))) return candidate;
  }
  throw new Error(`no available rename target for ${name}`);
}

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
): Promise<SyncReport> {
  const canonicalSkillsDir = path.join(extractedRoot, "skills");
  if (!fs.existsSync(canonicalSkillsDir)) {
    throw new Error(
      `canonical tarball missing skills/ directory at ${canonicalSkillsDir}`,
    );
  }

  const localSkillsDir = path.join(registryRoot, "skills");
  fs.mkdirSync(localSkillsDir, { recursive: true });

  const syncedAt = new Date().toISOString();
  const upserted: string[] = [];
  const conflicts: ConflictEntry[] = [];
  const resolved: ResolvedEntry[] = [];

  const canonicalNames = new Set<string>();
  for (const ent of fs.readdirSync(canonicalSkillsDir, {
    withFileTypes: true,
  })) {
    if (!ent.isDirectory()) continue;
    const name = ent.name;
    canonicalNames.add(name);
    const canonicalPath = path.join(canonicalSkillsDir, name);
    const localPath = path.join(localSkillsDir, name);

    // Capture local tags before any destructive step so a canonical
    // overwrite preserves the user's tag edits. Tags are a local-only
    // dimension; Sync never overwrites them.
    let preservedTags: string[] | null = null;
    if (fs.existsSync(localPath)) {
      preservedTags = readMetaTags(localPath);
      const existingSource = readSkillSource(localPath);
      if (existingSource.source !== "canonical") {
        const decision = decisions[name];
        if (decision) {
          // Apply the stored resolution and skip the conflict queue.
          if (decision.action === "keep-mine") {
            resolved.push({ name, action: "keep-mine" });
            continue;
          }
          if (decision.action === "use-canonical") {
            fs.rmSync(localPath, { recursive: true, force: true });
            // Falls through to the canonical write below.
            resolved.push({ name, action: "use-canonical" });
          } else if (decision.action === "rename-mine") {
            const target = resolveRenameTarget(localSkillsDir, name);
            fs.renameSync(localPath, path.join(localSkillsDir, target));
            resolved.push({ name, action: "rename-mine", renamedTo: target });
          }
        } else {
          conflicts.push({ name, localSource: existingSource, canonicalPath });
          continue;
        }
      } else {
        // Canonical → canonical: overwrite in place.
        fs.rmSync(localPath, { recursive: true, force: true });
      }
    }

    fs.cpSync(canonicalPath, localPath, { recursive: true });
    if (preservedTags !== null) {
      writeMetaTags(localPath, preservedTags);
    }
    writeSkillSource(localPath, {
      source: "canonical",
      syncedFromCommit: commitSha,
      syncedAt,
    });
    upserted.push(name);
  }

  // Orphans: local skills marked canonical that no longer appear upstream.
  const orphaned: string[] = [];
  for (const ent of fs.readdirSync(localSkillsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (canonicalNames.has(ent.name)) continue;
    const local = path.join(localSkillsDir, ent.name);
    if (readSkillSource(local).source === "canonical") {
      orphaned.push(ent.name);
    }
  }

  const report: SyncReport = {
    upserted,
    conflicts,
    orphaned,
    commitSha,
    syncedAt,
    resolved,
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
  writeUpstreamCanonNames(
    registryRoot,
    [...canonicalNames],
    "synced",
  );
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
