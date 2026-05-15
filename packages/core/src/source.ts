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
 * `SkillOrigin`. A skill installed from skills.sh carries
 * `kind: "skills-sh"` plus the package name + version it came from,
 * so the app can probe for newer versions and run an in-place update
 * without losing that lineage. Adoption (moving files from an agent
 * dir into the registry) preserves the pointer; only an explicit
 * Sever upstream action drops it.
 *
 * `git` is reserved for future skills cloned from arbitrary GitHub
 * repos — no probe/update path is wired for it in this milestone.
 *
 * `none` is an explicit "this is mine, stop scanning" signal from the
 * manual upstream picker, distinct from a missing field (which means
 * "unknown lineage, scanner may try to classify").
 */
export type UpstreamKind = "skills-sh" | "git" | "none";

export interface UpstreamPointer {
  kind: UpstreamKind;
  /** skills-sh: npm-package-style identifier the user passes to `npx skills add`. */
  package?: string;
  /** skills-sh: semver string of the fetched version. */
  version?: string;
  /** git: full repo identifier (e.g. `owner/repo`). Reserved. */
  repo?: string;
  /** git: branch / tag / commit pinned at fetch time. Reserved. */
  ref?: string;
  /** SHA-256 of the skill directory's content at fetch time, for drift detection. */
  contentHash?: string;
  /** ISO-8601 timestamp of the last successful fetch. */
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
  if (r.kind !== "skills-sh" && r.kind !== "git" && r.kind !== "none") {
    return undefined;
  }
  const out: UpstreamPointer = { kind: r.kind };
  if (typeof r.package === "string") out.package = r.package;
  if (typeof r.version === "string") out.version = r.version;
  if (typeof r.repo === "string") out.repo = r.repo;
  if (typeof r.ref === "string") out.ref = r.ref;
  if (typeof r.contentHash === "string") out.contentHash = r.contentHash;
  if (typeof r.fetchedAt === "string") out.fetchedAt = r.fetchedAt;
  return out;
}

export function writeSkillSource(skillDir: string, src: SkillSource): void {
  const p = path.join(skillDir, SKILL_SOURCE_FILENAME);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(src, null, 2) + "\n");
}
