import fs from "node:fs";
import path from "node:path";
import { bucketForOrigin } from "../registry/source.js";
import { walkSkills } from "../registry/walk.js";
import { rotateFilesByPrefix } from "../shared/rotate-files.js";
import { readRepoFile } from "../github/files.js";
import { normalizeOriginUrl } from "../github/url.js";
import type { RateLimitInfo } from "../github/http.js";
import {
  fetchClaudePluginManifest,
  mergePluginDeclaredSkills,
} from "./plugin-manifest.js";
import {
  effectiveLabels,
  type LabelsMap,
  type SkillLabelOverride,
} from "../registry/labels.js";
import type { SkillBucket } from "../registry/walk.js";

/**
 * Registry manifest — the live, metadata-only record of every skill in a
 * registry (ADR-0020/0021). It is the SOLE home of a skill's origin:
 * per-skill sidecars are gone, so "where did this come from" lives here
 * and nowhere else. Per skill it records the origin URL used to re-fetch
 * content, the path to SKILL.md within that origin, a diagnostic content
 * hash, and the effective curation labels (category + tags). No file
 * content lives in the manifest — content is re-mirrored from each
 * skill's origin on import.
 *
 * Origin is a single nullable URL. A `url` pointing at the registry's own
 * linked repo is a self-origin (authored here); any other `url` is an
 * external upstream; `url: null` is an explicit "local skill, no remote"
 * stamp (from-scratch authoring or detach). GitHub-ness is a call-site
 * capability check (`isGithubUrl`), not a stored axis.
 *
 * Two projections of one document (ADR-0021): the LIVE record at the
 * registry root carries everything, including `url: null` rows; the
 * PUSHED form (to the linked repo) is `toPushedProjection` — `url: null`
 * rows filtered out, so a machine pulling never reads another machine's
 * local-only skills as "deleted upstream". `serializeManifest` is the
 * single seam where that filter lives; diff, three-way merge, and the
 * merge base all consume the pushed projection.
 */
export const MANIFEST_SCHEMA_VERSION = 6 as const;

export interface ManifestOrigin {
  /**
   * Re-fetch URL, or `null` for a local skill with no remote. Never
   * absent — `null` is the explicit stamped answer (ADR-0018 no-vacuum).
   * A self-origin URL equals the active linked repo; any other URL is
   * external; `null` is local-only (filtered from the pushed projection).
   */
  url: string | null;
  /** Path to SKILL.md within the origin repo — e.g. `skills/find-skills/SKILL.md`. */
  skillPath?: string;
  /**
   * Baseline folder tree hash at acquisition. Diagnostic / audit value
   * only — import re-mirrors and recomputes the live hash; it does not
   * gate the import on a match. (Was `skillFolderHash` pre-v6.)
   */
  hash?: string;
}

export interface ManifestSkill {
  name: string;
  origin: ManifestOrigin;
  /**
   * Effective single category from the labels taxonomy (`labels.ts`),
   * or `null` when no rule matched and the user set none.
   */
  category: string | null;
  /** Effective tag set — the flattened curation state that travels. */
  tags: string[];
}

export interface RegistryManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  skills: ManifestSkill[];
}

/** The committed filename at the registry root — the live record. */
export const MANIFEST_FILENAME = "registry-manifest.json";

export interface ExportRegistryManifestOptions {
  /** Label overrides keyed by skill name (the app's `labels.json`). */
  labels?: LabelsMap;
}

/**
 * The current live manifest for `registryRoot`, with each row's curation
 * labels refreshed from the supplied `labels.json`. PURE — reads the live
 * record and folds in labels; never re-derives origin (origin is carried
 * verbatim from the live record, its only home) and never writes. The
 * folder↔row truing-up is `reconcileFoldersToManifest`'s job; callers that
 * push apply `toPushedProjection` to the result.
 */
export function exportRegistryManifest(
  registryRoot: string,
  opts: ExportRegistryManifestOptions = {},
): RegistryManifest {
  const live = readLiveManifest(registryRoot);
  const skills = live.skills.map((s) => {
    const { category, tags } = effectiveLabels(
      { category: s.category, tags: s.tags },
      opts.labels?.[s.name],
    );
    return { ...s, category, tags };
  });
  return { schemaVersion: MANIFEST_SCHEMA_VERSION, skills };
}

/**
 * Derive the on-disk bucket a manifest row's content should live in.
 * Runs once, at acquisition (ADR-0020): `url: null` or a self-origin →
 * `personal`; any external URL → `vendored`.
 */
export function bucketForManifestSkill(
  skill: ManifestSkill,
  linkedRepo: string | undefined,
): SkillBucket {
  return bucketForOrigin(skill.origin.url, linkedRepo);
}

/**
 * The pushed projection (ADR-0021): drop `url: null` (local-only) rows so
 * they never travel to the linked repo. The single seam for the
 * live-vs-pushed distinction — diff, three-way merge, the merge base, and
 * the removal basis all run against this.
 */
export function toPushedProjection(
  manifest: RegistryManifest,
): RegistryManifest {
  return {
    schemaVersion: manifest.schemaVersion,
    skills: manifest.skills.filter((s) => s.origin.url !== null),
  };
}

/**
 * Deterministic canonical bytes for a manifest as-given (no filtering):
 * skills sorted by name, stable key order, trailing newline. Used for the
 * live record on disk so a re-write with no semantic change is a no-op
 * diff. `serializeManifest` layers the pushed-projection filter on top.
 */
export function serializeLiveManifest(manifest: RegistryManifest): string {
  const skills = [...manifest.skills]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(canonicalSkill);
  return (
    JSON.stringify({ schemaVersion: manifest.schemaVersion, skills }, null, 2) +
    "\n"
  );
}

/**
 * Serialize the PUSHED form — the exact bytes committed to the linked
 * repo (and stored as the merge base). Pushed projection first (drop
 * `url: null` rows), then canonical bytes. Round-trip stable.
 */
export function serializeManifest(manifest: RegistryManifest): string {
  return serializeLiveManifest(toPushedProjection(manifest));
}

function canonicalSkill(s: ManifestSkill): Record<string, unknown> {
  return {
    name: s.name,
    origin: canonicalOrigin(s.origin),
    category: s.category,
    tags: s.tags,
  };
}

function canonicalOrigin(o: ManifestOrigin): Record<string, unknown> {
  const out: Record<string, unknown> = { url: o.url };
  if (o.skillPath) out.skillPath = o.skillPath;
  if (o.hash) out.hash = o.hash;
  return out;
}

/** Two origins agree when their re-fetch URL and skill path match. */
export function originsEqual(a: ManifestOrigin, b: ManifestOrigin): boolean {
  return (
    (a.url ?? null) === (b.url ?? null) &&
    (a.skillPath ?? "") === (b.skillPath ?? "")
  );
}

/**
 * Single parse chokepoint for a manifest read off disk or the wire.
 * v6-only: rejects anything without `schemaVersion: 6` (no legacy
 * coercion — the model was cut destructively). Pure; fills per-skill
 * defaults so downstream sees a whole `ManifestSkill`.
 */
export function coerceManifestToCurrent(input: unknown): RegistryManifest {
  if (typeof input !== "object" || input === null) {
    throw new Error("manifest: input is not an object");
  }
  const m = input as { schemaVersion?: unknown; skills?: unknown };
  if (m.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `manifest: unsupported schemaVersion ${String(m.schemaVersion)} (expected ${MANIFEST_SCHEMA_VERSION})`,
    );
  }
  if (!Array.isArray(m.skills)) {
    throw new Error("manifest: missing skills array");
  }
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    skills: m.skills.map(normalizeManifestSkill),
  };
}

function normalizeManifestSkill(s: Record<string, unknown>): ManifestSkill {
  const rawOrigin = (s["origin"] ?? {}) as Record<string, unknown>;
  const origin: ManifestOrigin = {
    url:
      typeof rawOrigin["url"] === "string"
        ? normalizeOriginUrl(rawOrigin["url"] as string)
        : null,
  };
  if (typeof rawOrigin["skillPath"] === "string") {
    origin.skillPath = rawOrigin["skillPath"] as string;
  }
  if (typeof rawOrigin["hash"] === "string")
    origin.hash = rawOrigin["hash"] as string;
  return {
    name: s["name"] as string,
    origin,
    category:
      typeof s["category"] === "string" ? (s["category"] as string) : null,
    tags: Array.isArray(s["tags"]) ? (s["tags"] as string[]) : [],
  };
}

/** Read the live manifest at the registry root, or an empty one if absent/corrupt. */
export function readLiveManifest(registryRoot: string): RegistryManifest {
  const p = path.join(registryRoot, MANIFEST_FILENAME);
  if (!fs.existsSync(p))
    return { schemaVersion: MANIFEST_SCHEMA_VERSION, skills: [] };
  try {
    return coerceManifestToCurrent(JSON.parse(fs.readFileSync(p, "utf8")));
  } catch {
    return { schemaVersion: MANIFEST_SCHEMA_VERSION, skills: [] };
  }
}

/** Atomically write the live manifest (full record, `url: null` rows kept). */
export function writeLiveManifest(
  registryRoot: string,
  manifest: RegistryManifest,
): void {
  const p = path.join(registryRoot, MANIFEST_FILENAME);
  const tmp = p + ".tmp~";
  fs.writeFileSync(tmp, serializeLiveManifest(manifest));
  fs.renameSync(tmp, p);
}

/**
 * Reconstruct a `SkillLabelOverride` from a manifest skill's effective
 * category + tags. Returns `undefined` when the manifest carries no
 * labels so `labels.json` stays clean for genuinely unlabeled skills.
 */
function reconstructLabelOverride(
  skill: ManifestSkill,
): SkillLabelOverride | undefined {
  const hasCategory = skill.category != null;
  const hasTags = skill.tags.length > 0;
  if (!hasCategory && !hasTags) return undefined;
  const override: SkillLabelOverride = {};
  if (hasCategory) override.category = skill.category;
  if (hasTags) override.tags = skill.tags;
  return override;
}

/** Record a skill's reconstructed label override into the accumulator. */
export function recordLabelOverride(
  acc: LabelsMap,
  skill: ManifestSkill,
): void {
  const override = reconstructLabelOverride(skill);
  if (override) acc[skill.name] = override;
}

/**
 * Rolling auto-snapshot of the registry manifest under
 * `<userDataDir>/registry-snapshots/`. Retains the last `keep` snapshots
 * by mtime. Snapshots keep the full live record (history), so they are
 * written with `serializeLiveManifest`, not the pushed projection.
 */
export interface WriteSnapshotOptions {
  userDataDir: string;
  manifest: RegistryManifest;
  /** Default: 5. */
  keep?: number;
}

export interface WriteSnapshotResult {
  ok: boolean;
  path?: string;
  removed?: string[];
  message?: string;
}

export function writeRegistrySnapshot(
  opts: WriteSnapshotOptions,
): WriteSnapshotResult {
  const keep = opts.keep ?? 5;
  const dir = path.join(opts.userDataDir, "registry-snapshots");
  try {
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(dir, `snapshot-${stamp}.json`);
    fs.writeFileSync(dest, serializeLiveManifest(opts.manifest));
    const removed = rotateFilesByPrefix(dir, "snapshot-", keep);
    return { ok: true, path: dest, removed };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

// Silence unused-import lints for the walk helper kept for callers that
// reconcile folder existence; referenced by reconcileFoldersToManifest.
void walkSkills;

export type FetchRemoteManifestResult =
  | { ok: true; manifest: RegistryManifest }
  | {
      ok: false;
      reason: "rate-limit" | "read-failed";
      message: string;
      rateLimit?: RateLimitInfo;
    };

/**
 * Read a linked repo's committed `registry-manifest.json` (the pushed
 * projection). A 404 or unparseable body resolves to an EMPTY manifest so
 * the merge reads every local skill as an add; only a real read/rate-limit
 * failure surfaces as `ok: false`.
 *
 * On every `ok: true` outcome, also folds in the repo's
 * `.claude-plugin/plugin.json` (if any) via `mergePluginDeclaredSkills` —
 * a linked repo doubling as a Claude Code plugin can gain skills directly
 * (outside this app's export flow) that would otherwise never appear in
 * `registry-manifest.json`. Best-effort: absence or failure of plugin.json
 * never changes the outcome of this function.
 */
export async function fetchRemoteManifest(
  repo: string,
  branch: string,
  token: string,
): Promise<FetchRemoteManifestResult> {
  const empty: RegistryManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    skills: [],
  };
  const res = await readRepoFile({
    repo,
    path: MANIFEST_FILENAME,
    ref: branch,
    token,
  });
  if (!res.ok) {
    if (res.status === 404)
      return { ok: true, manifest: await withPluginSkills(empty, repo, branch, token) };
    return res.rateLimit
      ? {
          ok: false,
          reason: "rate-limit",
          message: res.message,
          rateLimit: res.rateLimit,
        }
      : { ok: false, reason: "read-failed", message: res.message };
  }
  let manifest: RegistryManifest;
  try {
    manifest = coerceManifestToCurrent(JSON.parse(res.content));
  } catch {
    manifest = empty;
  }
  return { ok: true, manifest: await withPluginSkills(manifest, repo, branch, token) };
}

/** Fold in plugin.json-declared skills absent from `manifest`, if the repo has one. */
async function withPluginSkills(
  manifest: RegistryManifest,
  repo: string,
  branch: string,
  token: string,
): Promise<RegistryManifest> {
  const plugin = await fetchClaudePluginManifest(repo, branch, token);
  if (!plugin) return manifest;
  const repoUrl = normalizeOriginUrl(`https://github.com/${repo}`);
  if (!repoUrl) return manifest;
  return mergePluginDeclaredSkills(manifest, plugin, repoUrl);
}
