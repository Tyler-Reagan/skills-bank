import fs from "node:fs";
import path from "node:path";
import {
  AGENTS,
  getAgentSkillsDir,
  type AgentId,
} from "./agents.js";
import { buildRegistryIndex } from "./build.js";
import { writeSyncedHash } from "./heal.js";
import { hideCanonSkill } from "./hide.js";
import { findSkillFolder } from "./registry.js";
import {
  readSkillSource,
  writeSkillSource,
  type OriginPointer,
  type SkillOrigin,
} from "./source.js";
import {
  folderPathFromSkillPath,
  mirrorSkillFolder,
} from "./upstream.js";

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
export const MANIFEST_SCHEMA_VERSION = 1 as const;

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
  /**
   * v1 ships current vocabulary (`bundled` / `yours`). Phase 2 will
   * bump `schemaVersion` to v2 with renamed values (`curated` /
   * `user`); v1 imports remain readable via the migration path.
   */
  source: SkillOrigin;
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
      origin: originFromPointer(entry.source.upstream),
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
}

export interface ImportRegistryManifestOptions {
  /**
   * GitHub OAuth token for mirroring GitHub-origin skills. `null`
   * falls through to unauthenticated probes (60/hr rate limit).
   */
  token?: string | null;
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
 * per-skill `lastInstalledOn` intersected with the destination
 * machine's available agent dirs — so the caller can surface a
 * single user-confirmed batch install (Option C from the plan
 * grill).
 */
export async function importRegistryManifest(
  registryRoot: string,
  manifest: RegistryManifest,
  opts: ImportRegistryManifestOptions = {},
): Promise<ImportRegistryManifestResult> {
  const outcomes: ImportSkillOutcome[] = [];
  const installHints: { name: string; agents: AgentId[] }[] = [];
  const existingAgents = new Set<AgentId>(
    AGENTS.filter((a) => {
      try {
        return fs.statSync(getAgentSkillsDir(a)).isDirectory();
      } catch {
        return false;
      }
    }).map((a) => a.id),
  );

  for (const skill of manifest.skills) {
    const existing = findSkillFolder(registryRoot, skill.name);
    if (existing) {
      const localOrigin = originFromPointer(
        readSkillSource(existing.dir).upstream,
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
        outcomes.push({
          name: skill.name,
          result: "origin-unreachable",
          reason: "manifest entry has no GitHub origin pointer",
        });
        continue;
      }
      const bucket = skill.source === "yours" ? "personal" : "vendored";
      const destDir = path.join(registryRoot, "skills", bucket, skill.name);
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
        continue;
      }
      stampOriginMarker(destDir, skill, mirror.folderHash);
      restoreAuxState(registryRoot, destDir, skill);
      outcomes.push({ name: skill.name, result: "registered" });
    }

    const wanted = skill.lastInstalledOn.filter((a) => existingAgents.has(a));
    if (wanted.length > 0) {
      installHints.push({ name: skill.name, agents: wanted });
    }
  }

  return { outcomes, installHints };
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
    writeSkillSource(destDir, { source: skill.source, upstream: { kind: "none" } });
    return;
  }
  const upstream: OriginPointer = {
    kind: "github",
    skillFolderHash: folderHash,
    installedAt: new Date().toISOString(),
  };
  if (skill.origin.repo) upstream.repo = skill.origin.repo;
  if (skill.origin.sourceUrl) upstream.sourceUrl = skill.origin.sourceUrl;
  if (skill.origin.skillPath) upstream.skillPath = skill.origin.skillPath;
  writeSkillSource(destDir, { source: skill.source, upstream });
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
