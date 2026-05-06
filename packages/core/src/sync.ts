import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { getStateDir } from "./paths.js";
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
 * Walk the canonical tarball's `skills/` dir and upsert each skill into
 * `<registryRoot>/skills/`. User-authored skills (`source: user` /
 * `source: imported`) block name collisions and surface as conflicts;
 * the caller resolves them via M5's modal. Skills locally marked
 * canonical that no longer exist in canonical are reported as orphaned
 * but never auto-deleted.
 */
export async function applyCanonicalSync(
  registryRoot: string,
  extractedRoot: string,
  commitSha: string,
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

  const canonicalNames = new Set<string>();
  for (const ent of fs.readdirSync(canonicalSkillsDir, {
    withFileTypes: true,
  })) {
    if (!ent.isDirectory()) continue;
    const name = ent.name;
    canonicalNames.add(name);
    const canonicalPath = path.join(canonicalSkillsDir, name);
    const localPath = path.join(localSkillsDir, name);

    if (fs.existsSync(localPath)) {
      const existingSource = readSkillSource(localPath);
      if (existingSource.source !== "canonical") {
        conflicts.push({ name, localSource: existingSource, canonicalPath });
        continue;
      }
      // Canonical → canonical: overwrite in place.
      fs.rmSync(localPath, { recursive: true, force: true });
    }

    fs.cpSync(canonicalPath, localPath, { recursive: true });
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
  };

  // Persist the report and any pending conflicts so the renderer can
  // surface them across restarts (M5's resolver consumes pending-conflicts).
  const stateDir = getStateDir(registryRoot);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "last-sync.json"),
    JSON.stringify(report, null, 2) + "\n",
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
