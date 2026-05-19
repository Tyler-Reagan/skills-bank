import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  hashSkillFolder,
  writeRuntimeState,
  writeSyncedHash,
} from "./heal.js";
import { walkSkills } from "./registry.js";
import {
  readSkillSource,
  UPSTREAM_KIND_GITHUB,
  writeSkillSource,
  type UpstreamPointer,
} from "./source.js";

/**
 * Reader + upstream inference for the `vercel-labs/skills` CLI's
 * lock file. Used by the index walk to auto-stamp upstream pointers
 * onto skills the user installed via raw `npx skills add` outside
 * the app — they get the same update / drift surfaces as in-app-
 * installed skills without manual classification.
 *
 * The lock file is read-only as far as we're concerned: the CLI
 * owns its lifecycle, we just consume.
 */

/**
 * Subset of the CLI's lock-entry shape (version 3 as of `skills@1.5.7`).
 * Extra fields on disk are ignored; missing optional fields are tolerated.
 */
export interface SkillLockEntry {
  /** `owner/repo` of the source repository. */
  source: string;
  /** Always `"github"` in v3; reserved for forward-compat with other VCS hosts. */
  sourceType?: string;
  /** Full clone URL — `https://github.com/owner/repo.git` or similar. */
  sourceUrl?: string;
  /** Path to the skill's SKILL.md within the source repo. */
  skillPath: string;
  /** SHA-1 tree hash of the skill folder at last fetch. */
  skillFolderHash?: string;
  /** ISO-8601 timestamp of first install. */
  installedAt?: string;
  /** ISO-8601 timestamp of last `npx skills update` that touched this skill. */
  updatedAt?: string;
}

export interface SkillLockFile {
  /** Schema version. v3 is current; we tolerate any positive integer and
   *  let field-level type checks reject unrecognized shapes. */
  version: number;
  /** Keyed by skill name (the skill folder's leaf name on disk). */
  skills: Record<string, SkillLockEntry>;
}

/**
 * Default location of the CLI's global lock file. The CLI also writes
 * project-scoped lock files inside individual projects; this helper
 * targets the global one, which backs every agent-dir symlink the
 * user sees in Skills Bank's Installed tab.
 */
export function defaultSkillLockPath(): string {
  return path.join(os.homedir(), ".agents", ".skill-lock.json");
}

/**
 * Read + parse the CLI's lock file. Returns null when the file is
 * missing (CLI not installed, or no global skills installed yet),
 * malformed (corrupt JSON), or has an unexpected shape. Callers
 * treat null as "no inference possible" — never as an error.
 */
export function readSkillLockFile(filePath: string): SkillLockFile | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(
      fs.readFileSync(filePath, "utf8"),
    ) as Partial<SkillLockFile>;
    if (typeof raw.version !== "number") return null;
    if (!raw.skills || typeof raw.skills !== "object") return null;
    return {
      version: raw.version,
      skills: raw.skills as Record<string, SkillLockEntry>,
    };
  } catch {
    return null;
  }
}

/**
 * Look up an unambiguous upstream pointer for a skill by name. The
 * lock file's `skills` map is keyed by skill name — when a key
 * exists, it's the CLI's canonical record for that skill, so name
 * collisions across source repos don't happen at the lock-file
 * layer.
 *
 * Returns null when:
 *   - No entry in the lock file for this name (skill is foreign to the CLI).
 *   - Entry's `sourceType` is set to anything other than `"github"` (the
 *     CLI may grow non-GitHub source types; we won't auto-stamp those
 *     because our schema currently models only `github` and the manual
 *     picker is the right disambiguation path).
 *   - Entry is missing `source` or `skillPath` (malformed; bail rather
 *     than stamping incomplete data).
 *
 * Name-collision caveat: if the user has a registry skill named
 * `find-skills` that is hand-authored (not from the CLI), but the
 * lock file *also* has a `find-skills` entry (because they later
 * installed the upstream version into an agent dir), this inference
 * will mis-stamp the hand-authored skill. Drift detection downstream
 * (`origin-update-available` vs `edited-with-origin` vs the
 * existing `edited-without-origin`) will surface the mismatch on the
 * first probe; the user heals via the manual upstream picker. This
 * trade is documented in `docs/plans/per-skill-upstream-foundation.md`
 * (open question: high-confidence matching).
 */
export function inferUpstreamForSkill(
  skillName: string,
  lock: SkillLockFile,
): UpstreamPointer | null {
  const entry = lock.skills[skillName];
  if (!entry) return null;
  if (entry.sourceType && entry.sourceType !== UPSTREAM_KIND_GITHUB) {
    return null;
  }
  if (typeof entry.source !== "string") return null;
  if (typeof entry.skillPath !== "string") return null;
  const out: UpstreamPointer = {
    kind: UPSTREAM_KIND_GITHUB,
    repo: entry.source,
    skillPath: entry.skillPath,
  };
  if (typeof entry.sourceUrl === "string") out.sourceUrl = entry.sourceUrl;
  if (typeof entry.skillFolderHash === "string") {
    out.skillFolderHash = entry.skillFolderHash;
  }
  if (typeof entry.installedAt === "string") {
    out.installedAt = entry.installedAt;
  }
  // `fetchedAt` is persisted in `.skills-bank-runtime.json` (ADR-0002)
  // — scanAndStampUpstreamFromLock writes the lock's `updatedAt` to
  // that sidecar separately. Don't include it in the UpstreamPointer
  // that gets written to the committed `.skills-bank.json`.
  return out;
}

/**
 * Walk `<registryRoot>/skills/<name>/` and stamp inferred upstream
 * pointers onto any skill whose `.skills-bank.json` doesn't yet have
 * one. Idempotent: skills with an existing `upstream` field are
 * skipped untouched, so repeated invocations converge quickly.
 *
 * Side-effecting (writes one `.skills-bank.json` per match), but
 * decoupled from `buildRegistryIndex` — callers invoke this
 * deliberately at sync points (app boot, explicit Rebuild) rather
 * than as a hidden side effect of reading the registry.
 *
 * Returns the count of newly-stamped skills. Silently no-op when
 * the lock file is absent or malformed (CLI not installed, or no
 * global skills installed yet) — callers don't need to special-case.
 */
export function scanAndStampUpstreamFromLock(registryRoot: string): {
  stamped: number;
} {
  const lock = readSkillLockFile(defaultSkillLockPath());
  if (!lock) return { stamped: 0 };
  let stamped = 0;
  for (const ref of walkSkills(registryRoot)) {
    const base = readSkillSource(ref.dir);
    if (base.upstream !== undefined) continue;
    const inferred = inferUpstreamForSkill(ref.name, lock);
    if (!inferred) continue;
    try {
      writeSkillSource(ref.dir, { ...base, upstream: inferred });
      // Persist the lock's `updatedAt` as the per-skill `fetchedAt` in
      // the runtime sidecar — keeps the value out of the committed
      // marker (ADR-0002) so unrelated metadata writes don't churn it.
      const lockEntry = lock.skills[ref.name];
      if (lockEntry && typeof lockEntry.updatedAt === "string") {
        writeRuntimeState(ref.dir, { fetchedAt: lockEntry.updatedAt });
      }
      // Capture the on-disk content hash as the user-edit baseline.
      // The CLI's `skillFolderHash` is a SHA-1 git tree hash (probe
      // identity); this is the SHA-256 we compare against on every
      // build to detect post-stamp local edits. We never re-baseline
      // here even if a stale hash file exists — the scanner runs once
      // per skill (gated above) so this write is idempotent in
      // practice. Best-effort: a null hash (folder too large) just
      // skips baseline-writing; drift detection silently disables
      // for that skill until it shrinks.
      const baseline = hashSkillFolder(ref.dir);
      if (baseline) writeSyncedHash(ref.dir, baseline);
      stamped++;
    } catch {
      // A failed write isn't fatal — next scan retries.
    }
  }
  return { stamped };
}
