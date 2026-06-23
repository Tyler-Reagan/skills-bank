import fs from "node:fs";
import path from "node:path";
import { AGENTS, getAgentSkillsDir, type AgentId } from "../shared/agents.js";
import { buildRegistryIndex } from "../registry/build.js";
import { invalidateCanonCache } from "../registry/canon.js";
import { hashSkillFolder, writeSyncedHash } from "../registry/heal.js";
import { findSkillFolder, walkSkills } from "../registry/walk.js";
import {
  readSkillSource,
  writeSkillSource,
  isSelfOrigin,
  type OriginPointer,
  type SkillOrigin,
} from "../registry/source.js";
import {
  folderPathFromSkillPath,
  installSkillFiles,
} from "../github/origin.js";
import { deleteFromBankSkill } from "../skills/install.js";
import { readRepoFile } from "../github/files.js";
import type { RateLimitInfo } from "../github/http.js";
import {
  effectiveLabels,
  type LabelsMap,
  type SkillLabelOverride,
} from "../registry/labels.js";

/**
 * Registry manifest — the metadata-only artifact at the heart of the
 * git-flow push/pull between a registry and its linked repo. It records,
 * per skill: the source axis, an origin pointer used to re-fetch content,
 * the on-disk bucket, and the effective curation labels (category + tags).
 * No file content lives in the manifest — content is re-mirrored from each
 * skill's origin on import.
 *
 * Origin is what makes a skill re-fetchable on pull. A third-party skill
 * points at its upstream repo; an *authored-here* skill points back at the
 * registry's own linked repo (a "self-origin" — `kind: "github"`, `repo` =
 * the active link), so it reconstructs from the same place its content is
 * committed. A skill with no resolvable origin (`kind: "none"`) is
 * effectively untracked — present locally but not yet pullable anywhere.
 *
 * Category + tags come from the labels system (`labels.ts`): since
 * v1.19 labels are fully user-driven — `deriveLabels` runs only on
 * explicit Auto-Generate / Auto-Categorize actions in the renderer —
 * `SkillLabelOverride` carries the user's edits, and the manifest stores
 * the *effective* (merged) values so the curation state travels with the
 * registry.
 */
export const MANIFEST_SCHEMA_VERSION = 5 as const;

/**
 * Oldest manifest version `importRegistryManifest` will coerce up to the
 * current schema. Pre-v2 manifests (the legacy `bundled`/`yours` source
 * vocabulary) are no longer readable — `coerceManifestToCurrent` throws a
 * sentinel error if encountered. v2 (no `bucket`), v3 (full per-skill
 * shape), and v4 (the `dismissed`/`hidden` booleans, pre-`category`) are
 * the legacy forms kept alive while users hold manifests exported during
 * the v1.x window.
 */
export const MANIFEST_OLDEST_READABLE_VERSION = 2 as const;

export interface ManifestOrigin {
  kind: "github" | "none";
  repo?: string;
  sourceUrl?: string;
  skillPath?: string;
  /**
   * Baseline folder tree SHA at export time. Diagnostic / audit value
   * only — import re-mirrors and recomputes the live hash; it does
   * not gate the import on a match.
   */
  skillFolderHash?: string;
}

export interface ManifestSkill {
  name: string;
  description?: string;
  source: SkillOrigin;
  /**
   * On-disk bucket the skill lives in (`skills/<bucket>/<name>/`).
   * DERIVED from origin at export: an external GitHub origin → `vendored`
   * (harvested, link retained); a self-origin or no origin → `personal`
   * (authored in the linked repo). Decoupled from the source axis — a
   * `source: user` skill harvested from a third party is still `vendored`.
   */
  bucket: "personal" | "vendored";
  origin: ManifestOrigin;
  /**
   * Effective single category from the labels taxonomy (`labels.ts`),
   * or `null` when no rule matched and the user set none. Auto-derived
   * from name + description at registration, overridable by the user.
   */
  category: string | null;
  /**
   * Effective tag set — auto-derived from name + description, then
   * adjusted by the user's add/reject overrides. Stored flattened so
   * the manifest is a complete, human-readable record of curation state.
   */
  tags: string[];
  /**
   * Agent dirs that held a symlink to this skill at export time.
   * Import intersects this with the destination machine's available
   * agents and surfaces the intersection as `installHints` for the
   * user-confirmed batch install. In-memory only — `serializeManifest`
   * drops it from the committed file (per-machine local state).
   */
  lastInstalledOn: AgentId[];
}

export interface RegistryManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  /**
   * Wall-clock export time. Carried in-memory and in rolling snapshots
   * (which retain full history), but `serializeManifest` OMITS it from
   * the committed canonical file — its per-export churn was the leading
   * source of meaningless manifest diffs. A manifest parsed back from a
   * canonical file therefore arrives with `exportedAt: ""` (filled by
   * `coerceManifestToCurrent`).
   */
  exportedAt: string;
  /** Source bank's package version, e.g. "1.1.0". */
  sourceBankVersion: string;
  /** Optional fingerprint of the source registry, e.g. "Tyler-Reagan/skills". */
  registryRoot?: string;
  skills: ManifestSkill[];
}

export interface ExportRegistryManifestOptions {
  sourceBankVersion: string;
  /** Optional label written into `RegistryManifest.registryRoot`. */
  registryRootLabel?: string;
  /**
   * Active linked repo `owner/name`. Distinguishes self vs external
   * origins for bucket derivation, and lets an authored-here skill with
   * a `none` marker get a synthesized self-origin (pointing at this repo,
   * at the skill's in-registry path) so it's re-fetchable on pull. Absent
   * → every GitHub origin is external and no self-origin is synthesized.
   */
  linkedRepo?: string;
  /** Label overrides keyed by skill name (the app's `labels.json`). */
  labels?: LabelsMap;
}

/**
 * Pure read: walk the active registry index, fold in per-skill sidecar
 * state + supplied labels, and surface a `RegistryManifest`. Never
 * mutates the registry; no I/O beyond the index walk.
 */
export function exportRegistryManifest(
  registryRoot: string,
  opts: ExportRegistryManifestOptions,
): RegistryManifest {
  const index = buildRegistryIndex(registryRoot);
  const installedByName = readInstalledAgentMap();

  const skills: ManifestSkill[] = index.entries
    // Two local-only classes are excluded from the synced manifest so a
    // pull on another machine never sees an entry it can't restore:
    //   1. In-place (non-adopted) registrations — files live outside the
    //      bank at a machine-specific absolute path.
    //   2. Detached skills carrying the explicit `{ kind: "none" }` sever
    //      stamp (ADR-0012) — no fetchable upstream, and `import.ts`
    //      rejects non-github origins. They travel only via an explicit
    //      adopt-into-linked-repo, which gives them a real self-origin
    //      first. (A *missing* origin — unknown lineage, never stamped —
    //      is left as-is; that's pre-existing behavior, not a detach.)
    .filter(
      (entry) =>
        entry.adopted !== false && entry.source.origin?.kind !== "none",
    )
    .map((entry) => {
      // Origin is carried verbatim from the skill's marker. A resident
      // skill already holds a real self-origin (reconcileResidentOrigins
      // runs before export wherever we have the linked tree).
      const origin = originFromPointer(entry.source.origin);
      // Bucket is derived, not read from disk: external GitHub origin →
      // `vendored`; self-origin or no origin → `personal`.
      const bucket: "personal" | "vendored" =
        origin.kind === "github" && !isSelfOrigin(origin, opts.linkedRepo)
          ? "vendored"
          : "personal";
      const { category, tags } = effectiveLabels(
        { category: null, tags: [] },
        opts.labels?.[entry.name],
      );
      return {
        name: entry.name,
        ...(entry.description ? { description: entry.description } : {}),
        source: entry.source.source,
        bucket,
        origin,
        category,
        tags,
        lastInstalledOn: installedByName.get(entry.name) ?? [],
      };
    });

  const out: RegistryManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    sourceBankVersion: opts.sourceBankVersion,
    skills,
  };
  if (opts.registryRootLabel) out.registryRoot = opts.registryRootLabel;
  return out;
}

/**
 * Serialize a manifest into the canonical committed form: the exact
 * bytes that land in `registry-manifest.json`. Deterministic, so a
 * re-export with no semantic change produces an identical file and git
 * shows no diff.
 *
 * Canonicalization rules:
 *   - Skills sorted by `name`; stable top-level and per-skill key order.
 *   - `exportedAt` dropped — its per-export churn was the dominant
 *     source of empty diffs (snapshots retain history instead).
 *   - `lastInstalledOn` dropped — it records which agent dirs exist on
 *     THIS machine, which is per-machine local state, not shared
 *     registry intent. `diffManifests` already excludes it from
 *     significance; committing it would manufacture cross-machine
 *     conflicts. `category`/`tags` ARE kept: they're curation intent
 *     and `diffManifests` compares them.
 *   - Trailing newline.
 *
 * Round-trip stable: `serializeManifest(coerceManifestToCurrent(
 * JSON.parse(serializeManifest(m)))) === serializeManifest(m)`.
 */
export function serializeManifest(manifest: RegistryManifest): string {
  const skills = [...manifest.skills]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(canonicalSkill);
  const out: Record<string, unknown> = {
    schemaVersion: manifest.schemaVersion,
    sourceBankVersion: manifest.sourceBankVersion,
  };
  if (manifest.registryRoot) out.registryRoot = manifest.registryRoot;
  out.skills = skills;
  return JSON.stringify(out, null, 2) + "\n";
}

function canonicalSkill(s: ManifestSkill): Record<string, unknown> {
  const out: Record<string, unknown> = { name: s.name };
  if (s.description) out.description = s.description;
  out.source = s.source;
  out.bucket = s.bucket;
  out.origin = canonicalOrigin(s.origin);
  out.category = s.category;
  out.tags = s.tags;
  return out;
}

function canonicalOrigin(o: ManifestOrigin): Record<string, unknown> {
  if (o.kind !== "github") return { kind: "none" };
  const out: Record<string, unknown> = { kind: "github" };
  if (o.repo) out.repo = o.repo;
  if (o.sourceUrl) out.sourceUrl = o.sourceUrl;
  if (o.skillPath) out.skillPath = o.skillPath;
  if (o.skillFolderHash) out.skillFolderHash = o.skillFolderHash;
  return out;
}

export function originFromPointer(
  p: OriginPointer | undefined,
): ManifestOrigin {
  if (!p || p.kind === "none") return { kind: "none" };
  const out: ManifestOrigin = { kind: "github" };
  if (p.repo) out.repo = p.repo;
  if (p.sourceUrl) out.sourceUrl = p.sourceUrl;
  if (p.skillPath) out.skillPath = p.skillPath;
  if (p.skillFolderHash) out.skillFolderHash = p.skillFolderHash;
  return out;
}

export function originsEqual(a: ManifestOrigin, b: ManifestOrigin): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "none") return true;
  return (
    (a.repo ?? "") === (b.repo ?? "") &&
    (a.skillPath ?? "") === (b.skillPath ?? "")
  );
}

export function stampOriginMarker(
  destDir: string,
  skill: ManifestSkill,
  folderHash: string,
  linkedRepo?: string,
): void {
  // Manifest import is a runtime path; per the `source.ts` doctrine it
  // may never mint `curated`. That value is reserved for the maintainer's
  // committed markers, reached only via the first-launch seed and curated
  // sync (both call `writeSkillSource` directly, never this function). A
  // manifest claiming `curated` is another registry's attribution and
  // does not transfer here, so downgrade it: github origin → vendored,
  // self/none origin → user.
  let source: SkillOrigin =
    skill.source === "curated"
      ? skill.origin.kind === "github"
        ? "vendored"
        : "user"
      : skill.source;
  // Provenance-D (ADR-0012): `user` provenance means "from my linked
  // repo" — i.e. a self-origin. A `user` claim carrying a *third-party*
  // github origin is contradictory; it's the historical linked-repo-pull
  // bug that stamped `user` indiscriminately (the 69-skill cleanup). Heal
  // it to `vendored` at acquisition. A `vendored` self-origin
  // (vendored-then-adopted) is NOT contradictory and is left sticky.
  // Only fires when the active link is known — without it we can't tell
  // self from third-party, so we leave the claim untouched.
  if (
    source === "user" &&
    linkedRepo &&
    skill.origin.kind === "github" &&
    !isSelfOrigin(
      { kind: skill.origin.kind, repo: skill.origin.repo },
      linkedRepo,
    )
  ) {
    source = "vendored";
  }
  if (skill.origin.kind !== "github") {
    writeSkillSource(destDir, {
      source,
      origin: { kind: "none" },
    });
    return;
  }
  const origin: OriginPointer = {
    kind: "github",
    skillFolderHash: folderHash,
    installedAt: new Date().toISOString(),
  };
  if (skill.origin.repo) origin.repo = skill.origin.repo;
  if (skill.origin.sourceUrl) origin.sourceUrl = skill.origin.sourceUrl;
  if (skill.origin.skillPath) origin.skillPath = skill.origin.skillPath;
  writeSkillSource(destDir, { source, origin });
}

/**
 * Reconstruct a `SkillLabelOverride` from a manifest skill's effective
 * category + tags. The manifest is the source of truth; values are stored
 * directly into `labels.json` on the destination with no derivation.
 * Returns `undefined` when the manifest carries no labels so `labels.json`
 * stays clean for genuinely unlabeled skills.
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
 * Single quarantined chokepoint for version-gated logic. Coerces any
 * accepted legacy manifest shape into the current `RegistryManifest`
 * before the import body executes. The rest of the import path treats
 * the result as the only manifest shape that exists — no per-version
 * branches downstream of this function.
 *
 * Pure transformer; no I/O. Throws on unsupported / malformed input
 * so the import IPC can surface a clean error rather than partially
 * mirroring against a half-coerced structure.
 *
 * Legacy fallbacks:
 *   - v2 manifests lack `bucket`. Derive it from origin: any GitHub
 *     origin → `vendored`; no-origin entries → `personal`. The forward
 *     path now derives bucket from origin at export, so this matches.
 *   - v3/v4 carried `dismissed`/`hidden` and no `category`.
 *     `normalizeManifestSkill` drops the former and defaults
 *     `category: null`; v5 thus reads v3/v4 files cleanly.
 *   - Files parsed back from disk lack `exportedAt`/`lastInstalledOn`
 *     (serializer-dropped); `normalizeManifestSkill` refills
 *     `lastInstalledOn: []` and the top-level branch refills
 *     `exportedAt: ""` so the in-memory shape stays whole.
 */
// Quarantined legacy shapes. Only referenced by `coerceManifestToCurrent`.
interface ManifestSkillV2 {
  name: string;
  source: SkillOrigin;
  origin: ManifestOrigin;
  tags: string[];
  dismissed: boolean;
  hidden: boolean;
  lastInstalledOn: AgentId[];
}
interface RegistryManifestV2 {
  schemaVersion: 2;
  exportedAt: string;
  sourceBankVersion: string;
  registryRoot?: string;
  skills: ManifestSkillV2[];
}

/**
 * Fill any optional/dropped per-skill field to its canonical default so
 * every downstream consumer sees a whole `ManifestSkill` regardless of
 * which legacy shape — or which serializer-trimmed file — it came from.
 * `category` defaults to `null` (absent in v3/v4); legacy `dismissed`/
 * `hidden` are ignored; `lastInstalledOn` (canonical files drop it)
 * defaults to `[]`.
 */
function normalizeManifestSkill(s: Record<string, unknown>): ManifestSkill {
  return {
    name: s["name"] as string,
    ...(s["description"] ? { description: s["description"] as string } : {}),
    source: s["source"] as SkillOrigin,
    bucket: s["bucket"] as "personal" | "vendored",
    origin: s["origin"] as ManifestOrigin,
    category: typeof s["category"] === "string" ? s["category"] : null,
    tags: Array.isArray(s["tags"]) ? (s["tags"] as string[]) : [],
    lastInstalledOn: Array.isArray(s["lastInstalledOn"])
      ? (s["lastInstalledOn"] as AgentId[])
      : [],
  };
}

export function coerceManifestToCurrent(input: unknown): RegistryManifest {
  if (typeof input !== "object" || input === null) {
    throw new Error("manifest: input is not an object");
  }
  const m = input as {
    schemaVersion?: unknown;
    exportedAt?: string;
    sourceBankVersion: string;
    registryRoot?: string;
    skills: Record<string, unknown>[];
  };
  // v3, v4, and v5 converge through the same defensive normalize, which
  // drops the legacy `dismissed`/`hidden` booleans and defaults
  // `category`. The remaining deltas are purely in the canonical
  // committed form, handled by `serializeManifest`.
  if (m.schemaVersion === 5 || m.schemaVersion === 4 || m.schemaVersion === 3) {
    return {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      exportedAt: m.exportedAt ?? "",
      sourceBankVersion: m.sourceBankVersion,
      ...(m.registryRoot ? { registryRoot: m.registryRoot } : {}),
      skills: m.skills.map(normalizeManifestSkill),
    };
  }
  if (m.schemaVersion === 2) {
    const v2 = input as RegistryManifestV2;
    return {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      exportedAt: v2.exportedAt,
      sourceBankVersion: v2.sourceBankVersion,
      ...(v2.registryRoot ? { registryRoot: v2.registryRoot } : {}),
      skills: v2.skills.map((s) =>
        normalizeManifestSkill({
          ...s,
          bucket: s.origin.kind === "github" ? "vendored" : "personal",
        }),
      ),
    };
  }
  throw new Error(
    `manifest: unsupported schemaVersion ${String(m.schemaVersion)} (oldest readable: ${MANIFEST_OLDEST_READABLE_VERSION})`,
  );
}

function readInstalledAgentMap(): Map<string, AgentId[]> {
  const out = new Map<string, AgentId[]>();
  for (const agent of AGENTS) {
    const dir = getAgentSkillsDir(agent);
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const p = path.join(dir, name);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(p);
      } catch {
        continue;
      }
      if (!stat.isSymbolicLink() && !stat.isDirectory()) continue;
      const list = out.get(name) ?? [];
      if (!list.includes(agent.id)) list.push(agent.id);
      out.set(name, list);
    }
  }
  return out;
}

/**
 * Rolling auto-snapshot of the registry manifest under
 * `<userDataDir>/registry-snapshots/`. Retains the last `keep`
 * snapshots by mtime; older files are removed atomically.
 *
 * Called from the main process on every registry-mutating IPC. Pure
 * write; never throws into the caller (a snapshot failure must not
 * break the user's mutation).
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
    const stamp = opts.manifest.exportedAt.replace(/[:.]/g, "-");
    const dest = path.join(dir, `snapshot-${stamp}.json`);
    fs.writeFileSync(dest, JSON.stringify(opts.manifest, null, 2) + "\n");
    const removed = rotateSnapshots(dir, keep);
    return { ok: true, path: dest, removed };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

function rotateSnapshots(dir: string, keep: number): string[] {
  const entries = fs
    .readdirSync(dir)
    .filter((n) => n.startsWith("snapshot-") && n.endsWith(".json"))
    .map((n) => ({
      name: n,
      mtimeMs: safeMtimeMs(path.join(dir, n)),
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const removed: string[] = [];
  for (const e of entries.slice(keep)) {
    const p = path.join(dir, e.name);
    try {
      fs.unlinkSync(p);
      removed.push(p);
    } catch {
      // best-effort rotation; surfacing a partial-rotation error
      // would crowd the user-facing path for no benefit.
    }
  }
  return removed;
}

function safeMtimeMs(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

export type FetchRemoteManifestResult =
  | { ok: true; manifest: RegistryManifest }
  | {
      ok: false;
      reason: "rate-limit" | "read-failed";
      message: string;
      rateLimit?: RateLimitInfo;
    };

/**
 * Read a linked repo's committed `registry-manifest.json`. A 404 (no
 * manifest yet) or an unparseable body resolves to an EMPTY manifest, so
 * the merge reads every local skill as an add rather than aborting; only
 * a real read/rate-limit failure surfaces as `ok: false`. The single
 * authoritative "what does the remote manifest say" — callers must not
 * re-derive the 404 fallback.
 */
export async function fetchRemoteManifest(
  repo: string,
  branch: string,
  token: string,
): Promise<FetchRemoteManifestResult> {
  const empty: RegistryManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    exportedAt: "",
    sourceBankVersion: "",
    skills: [],
  };
  const res = await readRepoFile({
    repo,
    path: "registry-manifest.json",
    ref: branch,
    token,
  });
  if (!res.ok) {
    if (res.status === 404) return { ok: true, manifest: empty };
    return res.rateLimit
      ? {
          ok: false,
          reason: "rate-limit",
          message: res.message,
          rateLimit: res.rateLimit,
        }
      : { ok: false, reason: "read-failed", message: res.message };
  }
  try {
    return { ok: true, manifest: JSON.parse(res.content) as RegistryManifest };
  } catch {
    return { ok: true, manifest: empty };
  }
}
