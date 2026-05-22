import fs from "node:fs";
import path from "node:path";
import { AGENTS, getAgentSkillsDir, type AgentId } from "./agents.js";
import { buildRegistryIndex } from "./build.js";
import { writeSyncedHash } from "./heal.js";
import { hideCanonSkill } from "./hide.js";
import { findSkillFolder, readSkillMdFrontmatter } from "./registry.js";
import {
  readSkillSource,
  writeSkillSource,
  type OriginPointer,
  type SkillOrigin,
} from "./source.js";
import { folderPathFromSkillPath, mirrorSkillFolder } from "./upstream.js";

/**
 * v1.1 Registry manifest (Phase 1 of the curation-layer-reset plan).
 *
 * Metadata-only export of a registry: per-skill source axis, origin
 * pointer, tags, dismissed/hidden state, and a record of which agent
 * dirs the skill was installed in at export time. No file content
 * lives in the manifest — content is re-fetched from each skill's
 * Origin on import.
 *
 * The concept is independent of the deprecated content-bearing
 * `exportRegistry` zip. See `docs/plans/curation-layer-reset.md`
 * sections 5–7.
 */
export const MANIFEST_SCHEMA_VERSION = 3 as const;

/**
 * Oldest manifest version `importRegistryManifest` will coerce up to
 * the current schema. Pre-v2 manifests (the legacy `bundled`/`yours`
 * source vocabulary) are no longer readable — drop a sentinel error
 * before the migration head if encountered. v2 is the only legacy
 * shape kept alive while users have manifests exported during the
 * v1.x window.
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
  source: SkillOrigin;
  /**
   * On-disk bucket the skill lives in (`skills/<bucket>/<name>/`).
   * Decoupled from the source axis: a `source: user` skill harvested
   * from a third-party origin is still `vendored`. The export reads
   * this directly from the registry index entry.
   */
  bucket: "personal" | "vendored";
  origin: ManifestOrigin;
  tags: string[];
  /**
   * `hidden` is the on-disk axis (`<stateDir>/hidden-canon.json`).
   * `dismissed` is the user-facing UL term for the same state. Both
   * fields are serialized so a future split — should one ever land —
   * can populate them independently without a schema bump.
   */
  dismissed: boolean;
  hidden: boolean;
  /**
   * Agent dirs that held a symlink to this skill at export time.
   * Import intersects this with the destination machine's available
   * agents and surfaces the intersection as `installHints` for the
   * user-confirmed batch install.
   */
  lastInstalledOn: AgentId[];
}

export interface RegistryManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
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
}

/**
 * Pure read: walk the active registry index, fold in per-skill
 * sidecar state, and surface a `RegistryManifest`. Never mutates
 * the registry.
 */
export function exportRegistryManifest(
  registryRoot: string,
  opts: ExportRegistryManifestOptions,
): RegistryManifest {
  const index = buildRegistryIndex(registryRoot);
  const installedByName = readInstalledAgentMap();

  const skills: ManifestSkill[] = index.entries.map((entry) => {
    const tags = Array.isArray(entry.tags) ? entry.tags : [];
    const hidden = entry.hidden === true;
    return {
      name: entry.name,
      source: entry.source.source,
      bucket: entry.bucket ?? "personal",
      origin: originFromPointer(entry.source.origin),
      tags,
      dismissed: hidden,
      hidden,
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

export type ImportSkillOutcome =
  | { name: string; result: "registered" }
  | { name: string; result: "origin-unreachable"; reason: string }
  | { name: string; result: "collision"; existingOrigin: ManifestOrigin }
  | { name: string; result: "skipped"; reason: string };

export interface ImportRegistryManifestResult {
  outcomes: ImportSkillOutcome[];
  installHints: { name: string; agents: AgentId[] }[];
  /**
   * Set to `true` when the per-skill loop was aborted via the
   * caller-supplied `AbortSignal`. Already-mirrored skills remain
   * on disk and surface in `outcomes`; remaining manifest entries
   * are simply not processed. Omitted when the import ran to
   * completion.
   */
  cancelled?: boolean;
}

/**
 * Per-skill progress event fired by `importRegistryManifest` via the
 * `onProgress` callback. The `completed` count reflects how many of
 * the manifest's `total` skills have finished processing (registered,
 * collision, OR origin-unreachable). `currentName` is the skill the
 * loop is ABOUT to process next; consumers can render it as "Importing
 * 7/23: foo-skill". `lastError` is set when the prior iteration ended
 * in failure (origin-unreachable), carrying the same reason message
 * that landed in the outcomes array.
 *
 * The first event of an import fires before any per-skill work starts:
 * `completed: 0`, `currentName` = the first skill. The final event
 * fires when the loop exits cleanly with `completed === total` (and
 * `currentName` set to the last processed skill, retained for the
 * renderer's terminal state).
 */
export interface ManifestImportProgressEvent {
  completed: number;
  total: number;
  currentName: string;
  lastError?: string;
  /**
   * Full ordered list of skill names in the manifest. Sent on the FIRST
   * progress event of an import so the renderer can pre-render
   * ghost-card placeholders. Subsequent events omit this field.
   */
  manifestNames?: string[];
  /**
   * Full manifest skill entries — same payload as
   * `RegistryManifest.skills`. Sent on the FIRST progress event so
   * Tier-3 ghost cards have the origin info they need to drive the
   * per-skill retry action. Renderer-side payload size is
   * proportional to manifest size; typical manifests (≤100 skills)
   * remain well under any reasonable wire-format budget.
   */
  manifestSkills?: ManifestSkill[];
}

export interface ImportRegistryManifestOptions {
  /**
   * GitHub OAuth token for mirroring GitHub-origin skills. `null`
   * falls through to unauthenticated probes (60/hr rate limit).
   */
  token?: string | null;
  /**
   * Optional abort signal. When fired, the per-skill loop exits at
   * the top of the next iteration. Already-mirrored skills stay on
   * disk (no rollback) and are reflected in the returned outcomes;
   * the result carries `cancelled: true`.
   */
  signal?: AbortSignal;
  /**
   * Optional per-skill progress callback. Fired at the top of each
   * iteration with the cumulative `completed` count and the
   * `currentName` about to be processed. First fire of an import
   * carries `manifestNames` (the full ordered name list) so the
   * renderer can pre-render Tier-3 ghost cards before any per-skill
   * mirroring starts. See `ManifestImportProgressEvent`.
   */
  onProgress?: (event: ManifestImportProgressEvent) => void;
}

/**
 * Apply a manifest to `registryRoot`. For each manifest entry with
 * no local record, mirror content from its Origin via
 * `mirrorSkillFolder` and stamp the resulting marker. Existing
 * entries are inspected for origin collisions; same-origin matches
 * have their auxiliary state (tags + hide) restored, divergent
 * origins surface as `collision` outcomes.
 *
 * Never installs into agent dirs. Returns `installHints` —
 * the per-skill `lastInstalledOn` carried forward verbatim from
 * the manifest. Earlier drafts intersected this against agent
 * dirs that existed on disk, but the legit wipe-and-re-import
 * workflow leaves no agent dirs present momentarily, which
 * silently dropped every hint. The cross-machine "agent not
 * present on destination" case is now handled at the install
 * step (where dirs are created on demand and a stray symlink
 * for an unused agent is harmless).
 */
export async function importRegistryManifest(
  registryRoot: string,
  manifest: unknown,
  opts: ImportRegistryManifestOptions = {},
): Promise<ImportRegistryManifestResult> {
  const m = coerceManifestToCurrent(manifest);

  const outcomes: ImportSkillOutcome[] = [];
  const installHints: { name: string; agents: AgentId[] }[] = [];
  let cancelled = false;
  const total = m.skills.length;
  const manifestNames = m.skills.map((s) => s.name);
  let lastError: string | undefined;

  for (let i = 0; i < m.skills.length; i++) {
    const skill = m.skills[i]!;
    if (opts.signal?.aborted) {
      cancelled = true;
      break;
    }
    if (opts.onProgress) {
      opts.onProgress({
        completed: i,
        total,
        currentName: skill.name,
        ...(lastError ? { lastError } : {}),
        ...(i === 0 ? { manifestNames, manifestSkills: m.skills } : {}),
      });
    }
    // Reset per-iteration; only the most recent failure surfaces in
    // the NEXT iteration's event so the renderer can mark exactly
    // the offending skill's ghost as errored.
    lastError = undefined;
    const existing = findSkillFolder(registryRoot, skill.name);
    if (existing) {
      const localOrigin = originFromPointer(
        readSkillSource(existing.dir).origin,
      );
      if (originsEqual(localOrigin, skill.origin)) {
        restoreAuxState(registryRoot, existing.dir, skill);
        outcomes.push({ name: skill.name, result: "registered" });
      } else {
        outcomes.push({
          name: skill.name,
          result: "collision",
          existingOrigin: localOrigin,
        });
        continue;
      }
    } else {
      if (
        skill.origin.kind !== "github" ||
        !skill.origin.repo ||
        !skill.origin.skillPath
      ) {
        const reason = "manifest entry has no GitHub origin pointer";
        outcomes.push({
          name: skill.name,
          result: "origin-unreachable",
          reason,
        });
        lastError = `${skill.name}: ${reason}`;
        continue;
      }
      const destDir = path.join(
        registryRoot,
        "skills",
        skill.bucket,
        skill.name,
      );
      fs.mkdirSync(path.dirname(destDir), { recursive: true });
      const folderPath = folderPathFromSkillPath(skill.origin.skillPath);
      const mirror = await mirrorSkillFolder(
        skill.origin.repo,
        folderPath,
        destDir,
        opts.token ?? null,
      );
      if (!mirror.ok) {
        outcomes.push({
          name: skill.name,
          result: "origin-unreachable",
          reason: mirror.message,
        });
        lastError = `${skill.name}: ${mirror.message}`;
        continue;
      }
      stampOriginMarker(destDir, skill, mirror.folderHash);
      restoreAuxState(registryRoot, destDir, skill);
      outcomes.push({ name: skill.name, result: "registered" });
    }

    if (skill.lastInstalledOn.length > 0) {
      installHints.push({
        name: skill.name,
        agents: [...skill.lastInstalledOn],
      });
    }
  }

  // Final terminal progress event so consumers can flip to a
  // "done" UI state without polling the result promise.
  if (opts.onProgress && !cancelled && m.skills.length > 0) {
    const lastSkill = m.skills[m.skills.length - 1]!;
    opts.onProgress({
      completed: outcomes.length,
      total,
      currentName: lastSkill.name,
      ...(lastError ? { lastError } : {}),
    });
  }

  return cancelled
    ? { outcomes, installHints, cancelled: true }
    : { outcomes, installHints };
}

function originFromPointer(p: OriginPointer | undefined): ManifestOrigin {
  if (!p || p.kind === "none") return { kind: "none" };
  const out: ManifestOrigin = { kind: "github" };
  if (p.repo) out.repo = p.repo;
  if (p.sourceUrl) out.sourceUrl = p.sourceUrl;
  if (p.skillPath) out.skillPath = p.skillPath;
  if (p.skillFolderHash) out.skillFolderHash = p.skillFolderHash;
  return out;
}

function originsEqual(a: ManifestOrigin, b: ManifestOrigin): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "none") return true;
  return (
    (a.repo ?? "") === (b.repo ?? "") &&
    (a.skillPath ?? "") === (b.skillPath ?? "")
  );
}

function stampOriginMarker(
  destDir: string,
  skill: ManifestSkill,
  folderHash: string,
): void {
  if (skill.origin.kind !== "github") {
    writeSkillSource(destDir, {
      source: skill.source,
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
  writeSkillSource(destDir, { source: skill.source, origin });
  // Baseline the synced-hash sidecar so drift detection starts clean
  // from the just-mirrored snapshot. Without this, the first probe
  // would compare against an empty hash and surface false drift.
  writeSyncedHash(destDir, folderHash);
}

function restoreAuxState(
  registryRoot: string,
  skillDir: string,
  skill: ManifestSkill,
): void {
  // Tags: write into meta.json, preserving any existing fields.
  const metaPath = path.join(skillDir, "meta.json");
  let meta: Record<string, unknown> = {};
  if (fs.existsSync(metaPath)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      meta = {};
    }
  }
  // Recover description / version / author from the just-mirrored
  // SKILL.md frontmatter when meta.json doesn't already supply them.
  // Without this, restoring a skill whose upstream carries metadata
  // only in SKILL.md (description in frontmatter, no meta.json) ends
  // up writing a fresh meta.json that omits `description`, which then
  // trips both the AJV `required` check and the human-readable
  // "missing description" warning at build time.
  const fm = readSkillMdFrontmatter(skillDir);
  if (fm) {
    if (!meta["description"] && fm["description"]) {
      meta["description"] = fm["description"];
    }
    if (!meta["version"] && fm["version"]) {
      meta["version"] = fm["version"];
    }
    if (!meta["author"] && fm["author"]) {
      meta["author"] = fm["author"];
    }
  }
  if (skill.tags.length > 0) {
    meta["tags"] = skill.tags;
  } else if ("tags" in meta) {
    delete meta["tags"];
  }
  if (!meta["name"]) meta["name"] = skill.name;
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");

  // Hide state: only meaningful for canon skills, but hideCanonSkill
  // is tolerant — it just adds the name to the hidden set. The build
  // pass gates rendering by both canon AND hidden, so a non-canon
  // entry in the hidden set stays inert until/unless it becomes canon.
  if (skill.hidden || skill.dismissed) {
    hideCanonSkill(registryRoot, skill.name);
  }
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
 *     origin → `vendored`; no-origin entries → `personal`. Skills
 *     authored in the user's own linked repo will mis-bucket as
 *     `vendored` and can be moved with `pnpm update:skill --bucket
 *     personal`. The forward path (v3 export) carries bucket
 *     explicitly so this only matters for one-time legacy imports.
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

export function coerceManifestToCurrent(input: unknown): RegistryManifest {
  if (typeof input !== "object" || input === null) {
    throw new Error("manifest: input is not an object");
  }
  const m = input as { schemaVersion?: unknown };
  if (m.schemaVersion === MANIFEST_SCHEMA_VERSION) {
    return input as RegistryManifest;
  }
  if (m.schemaVersion === 2) {
    const v2 = input as RegistryManifestV2;
    return {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      exportedAt: v2.exportedAt,
      sourceBankVersion: v2.sourceBankVersion,
      ...(v2.registryRoot ? { registryRoot: v2.registryRoot } : {}),
      skills: v2.skills.map((s) => ({
        ...s,
        bucket: s.origin.kind === "github" ? "vendored" : "personal",
      })),
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
