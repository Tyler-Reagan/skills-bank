import fs from "node:fs";
import path from "node:path";

/**
 * Provenance for a registry skill.
 *
 * - `"curated"` — shipped with the app by the maintainer. Only set via
 *   committed `.skills-bank.json` files in the repo; no runtime install
 *   or sync path may produce this value for new skills.
 * - `"user"` — from the user's own linked GitHub registry repo.
 * - `"vendored"` — user-chosen third-party install (Discover tab or
 *   Settings → Install from GitHub) that is not from the linked repo.
 *
 * Internal `entry.canon` (a derived boolean — "currently in the curated
 * upstream snapshot") is the separate axis used purely for destructive-
 * action protection; it never surfaces to the user and is intentionally
 * not part of this type.
 *
 * Renamed from `bundled`/`yours` in v1.3. `"vendored"` added in v1.20.
 */
export type SkillOrigin = "curated" | "user" | "vendored";

/**
 * Per-skill Origin pointer — independent of the registry-level
 * `SkillOrigin`. Every skill installed via `npx skills` resolves to a
 * GitHub repo + a path within it (skills.sh is a discovery aggregator
 * over many such repos, not a separate package format), so `kind:
 * "github"` is the only positive identifier we model. `none` is an
 * explicit "this is mine, stop scanning" stamp set by the manual
 * Origin picker, distinct from a missing field (which means
 * "unknown lineage, scanner may try to classify on next walk").
 *
 * Field shape mirrors the `vercel-labs/skills` CLI's `.skill-lock.json`
 * (version 3) so the fallback Origin-capture scanner can copy values
 * directly without translation.
 */
export type OriginKind = "github" | "none";

/**
 * Constant form of `OriginKind`'s positive value. Use this in
 * runtime comparisons (e.g. `entry.sourceType !== ORIGIN_KIND_GITHUB`)
 * instead of the bare `"github"` string so a typo at any call site
 * fails to compile rather than silently misrouting.
 */
export const ORIGIN_KIND_GITHUB: OriginKind = "github";

export interface OriginPointer {
  kind: OriginKind;
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
  /** Commit SHA of the curated repo this skill was last synced from. */
  syncedFromCommit?: string;
  /** ISO-8601 timestamp of the last sync. */
  syncedAt?: string;
  /**
   * Per-skill origin pointer. Optional — missing means "unknown
   * lineage" and the fallback scanner may try to classify on next
   * index walk. Set explicitly to `{ kind: "none" }` to suppress
   * scanner attempts (the manual "this is mine" stamp).
   *
   * Field renamed from `upstream` → `origin` in v1.3 (ADR-0002
   * Phase 2 amendment). `writeSkillSource` always emits `origin`.
   */
  origin?: OriginPointer;
}

export const SKILL_SOURCE_FILENAME = ".skills-bank.json";

function normalizeSourceValue(raw: unknown): SkillOrigin {
  if (raw === "curated") return "curated";
  if (raw === "user") return "user";
  if (raw === "vendored") return "vendored";
  // Legacy values from before v1.3 vocabulary rename.
  if (raw === "bundled") return "curated";
  if (raw === "yours") return "user";
  return "user";
}

/**
 * Read a skill's origin marker. Missing or invalid files default to
 * `user` — the safe assumption for unknown provenance.
 */
export function readSkillSource(skillDir: string): SkillSource {
  const p = path.join(skillDir, SKILL_SOURCE_FILENAME);
  if (!fs.existsSync(p)) return { source: "user" };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Record<
      string,
      unknown
    >;
    const source = normalizeSourceValue(raw["source"]);
    const out: SkillSource = { source };
    if (typeof raw["syncedFromCommit"] === "string") {
      out.syncedFromCommit = raw["syncedFromCommit"];
    }
    if (typeof raw["syncedAt"] === "string") out.syncedAt = raw["syncedAt"];
    const origin = parseOrigin(raw["origin"]);
    if (origin) out.origin = origin;
    return out;
  } catch {
    return { source: "user" };
  }
}

// Strict parser: a malformed Origin block is dropped silently rather
// than corrupting the rest of the source marker. Each field is
// independently optional, but `kind` must be one of the known values
// or we discard the whole block (preserves the "unknown lineage —
// scanner may try to classify" semantics).
function parseOrigin(raw: unknown): OriginPointer | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<OriginPointer>;
  if (r.kind !== "github" && r.kind !== "none") return undefined;
  const out: OriginPointer = { kind: r.kind };
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

/**
 * Does this origin point back at the registry's own linked repo, rather
 * than a third-party upstream? A self-origin is how an authored-here
 * skill stays re-fetchable through the git-flow: its content lives in
 * the linked repo itself, so `repo` equals the active link.
 *
 * Single mechanism for the "is this mine?" decision — bucket derivation,
 * the fallback origin scanner, and the drift/sync flows all route
 * through here so the comparison against the *active* linked repo lives
 * in one place. `linkedRepo` is the configured `owner/name`; when no
 * repo is linked (or the origin carries no `repo`), nothing can be a
 * self-origin and this returns `false`.
 */
export function isSelfOrigin(
  origin: OriginPointer | undefined,
  linkedRepo: string | undefined,
): boolean {
  if (!origin || origin.kind !== "github" || !origin.repo) return false;
  if (!linkedRepo) return false;
  return origin.repo === linkedRepo;
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
  if (src.origin && "fetchedAt" in src.origin) {
    const { fetchedAt: _drop, ...originNoFetched } = src.origin;
    void _drop;
    toWrite = { ...src, origin: originNoFetched };
  }
  const tmp = p + ".tmp~";
  fs.writeFileSync(tmp, JSON.stringify(toWrite, null, 2) + "\n");
  fs.renameSync(tmp, p);
}
