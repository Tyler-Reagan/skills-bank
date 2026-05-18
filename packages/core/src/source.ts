import fs from "node:fs";
import path from "node:path";

/**
 * Binary provenance for a registry skill. Any skill the user didn't
 * get from the bundled curated set originated from them — whether
 * authored locally, merged from another bank, or added by hand.
 *
 * Internal `entry.canon` (a derived boolean — "currently in the
 * upstream bundled snapshot") is the separate axis used purely for
 * destructive-action protection; it never surfaces to the user and
 * is intentionally not part of this enum.
 */
export type SkillOrigin = "bundled" | "yours";

/**
 * Per-skill origin pointer — independent of the registry-level
 * `SkillOrigin`. Every skill installed via `npx skills` resolves to a
 * GitHub repo + a path within it (skills.sh is a discovery aggregator
 * over many such repos, not a separate package format), so `kind:
 * "github"` is the only positive identifier we model. `none` is an
 * explicit "this is mine, stop scanning" stamp set by the manual
 * upstream picker, distinct from a missing field (which means
 * "unknown lineage, scanner may try to classify on next walk").
 *
 * Field shape mirrors the `vercel-labs/skills` CLI's `.skill-lock.json`
 * (version 3) so the fallback origin-capture scanner can copy values
 * directly without translation.
 */
export type UpstreamKind = "github" | "none";

/**
 * Constant form of `UpstreamKind`'s positive value. Use this in
 * runtime comparisons (e.g. `entry.sourceType !== UPSTREAM_KIND_GITHUB`)
 * instead of the bare `"github"` string so a typo at any call site
 * fails to compile rather than silently misrouting.
 */
export const UPSTREAM_KIND_GITHUB: UpstreamKind = "github";

export interface UpstreamPointer {
  kind: UpstreamKind;
  /** "owner/repo" — e.g. `vercel-labs/skills`. */
  repo?: string;
  /** Full clone URL — preserved raw so non-github.com hosts (GitLab, self-hosted) survive the schema. */
  sourceUrl?: string;
  /** Path to SKILL.md within the source repo — e.g. `skills/find-skills/SKILL.md`. */
  skillPath?: string;
  /** SHA-1 tree hash of the skill folder at last fetch — probe identity. */
  skillFolderHash?: string;
  /** ISO-8601 timestamp of first install (immutable). */
  installedAt?: string;
  /** ISO-8601 timestamp of the last successful refresh (bumps on update). */
  fetchedAt?: string;
}

export interface SkillSource {
  source: SkillOrigin;
  /** Commit SHA of the bundled repo this skill was last synced from. */
  syncedFromCommit?: string;
  /** ISO-8601 timestamp of the last sync. */
  syncedAt?: string;
  /**
   * Per-skill origin pointer. Optional — missing means "unknown
   * lineage" and the fallback scanner may try to classify on next
   * index walk. Set explicitly to `{ kind: "none" }` to suppress
   * scanner attempts (the manual "this is mine" stamp).
   */
  upstream?: UpstreamPointer;
}

export const SKILL_SOURCE_FILENAME = ".skills-bank.json";

/**
 * Read a skill's origin marker. Missing or invalid files default to
 * `yours` — the safe assumption for unknown provenance. The maintainer
 * runs the rename script in the plan's "Resetting your local install"
 * section before launching the post-rename build.
 */
export function readSkillSource(skillDir: string): SkillSource {
  const p = path.join(skillDir, SKILL_SOURCE_FILENAME);
  if (!fs.existsSync(p)) return { source: "yours" };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<SkillSource>;
    const source: SkillOrigin = raw.source === "bundled" ? "bundled" : "yours";
    const out: SkillSource = { source };
    if (typeof raw.syncedFromCommit === "string") {
      out.syncedFromCommit = raw.syncedFromCommit;
    }
    if (typeof raw.syncedAt === "string") out.syncedAt = raw.syncedAt;
    const upstream = parseUpstream(raw.upstream);
    if (upstream) out.upstream = upstream;
    return out;
  } catch {
    return { source: "yours" };
  }
}

// Strict parser: a malformed upstream block is dropped silently rather
// than corrupting the rest of the source marker. Each field is
// independently optional, but `kind` must be one of the known values
// or we discard the whole block (preserves the "unknown lineage —
// scanner may try to classify" semantics).
function parseUpstream(raw: unknown): UpstreamPointer | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<UpstreamPointer>;
  if (r.kind !== "github" && r.kind !== "none") return undefined;
  const out: UpstreamPointer = { kind: r.kind };
  if (typeof r.repo === "string") out.repo = r.repo;
  if (typeof r.sourceUrl === "string") out.sourceUrl = r.sourceUrl;
  if (typeof r.skillPath === "string") out.skillPath = r.skillPath;
  if (typeof r.skillFolderHash === "string") {
    out.skillFolderHash = r.skillFolderHash;
  }
  if (typeof r.installedAt === "string") out.installedAt = r.installedAt;
  // `fetchedAt` moved to `.skills-bank-runtime.json` in v0.11.7
  // (ADR-0002). Tolerate legacy markers that still carry it inline —
  // build.ts merges the runtime sidecar's value over whatever this
  // reads. Persisting it back through writeSkillSource is suppressed
  // below so the committed marker eventually settles without it.
  if (typeof r.fetchedAt === "string") out.fetchedAt = r.fetchedAt;
  return out;
}

export function writeSkillSource(skillDir: string, src: SkillSource): void {
  const p = path.join(skillDir, SKILL_SOURCE_FILENAME);
  fs.mkdirSync(skillDir, { recursive: true });
  // Strip the runtime `fetchedAt` field — it belongs in
  // `.skills-bank-runtime.json` (ADR-0002). Leaving it on disk here
  // caused unstaged churn after every app launch
  // (`docs/bug-reports/2026-05-18-fetchedAt-churn.md`). Callers that
  // need to persist it use `writeRuntimeState` from `./heal.js`.
  let toWrite: SkillSource = src;
  if (src.upstream && "fetchedAt" in src.upstream) {
    const { fetchedAt: _drop, ...upstreamNoFetched } = src.upstream;
    void _drop;
    toWrite = { ...src, upstream: upstreamNoFetched };
  }
  fs.writeFileSync(p, JSON.stringify(toWrite, null, 2) + "\n");
}
