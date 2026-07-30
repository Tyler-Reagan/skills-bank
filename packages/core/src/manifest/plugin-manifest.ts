import { readRepoFile } from "../github/files.js";
import type { ManifestSkill, RegistryManifest } from "./manifest.js";

/**
 * A linked repo can double as a Claude Code plugin — a repo-root
 * `.claude-plugin/plugin.json` declaring every skill path it ships,
 * independent of (and sometimes ahead of) this app's own
 * `registry-manifest.json`. Skills added straight to such a repo (not
 * through this app's export flow) would otherwise never surface here:
 * `fetchRemoteManifest` only reads `registry-manifest.json`. This module
 * is the fallback source that closes that gap.
 */
export const CLAUDE_PLUGIN_MANIFEST_PATH = ".claude-plugin/plugin.json";

export interface ClaudePluginManifest {
  name: string;
  /** Repo-relative skill folder paths, e.g. `"./skills/tools/audit-memories"`. */
  skills: string[];
}

/**
 * Read and parse a linked repo's `.claude-plugin/plugin.json`, or `null`
 * if the repo doesn't have one / it isn't a valid plugin manifest. A
 * best-effort secondary source: any failure (missing file, network,
 * rate limit, malformed JSON) is treated the same — silently absent —
 * so it never blocks or fails the primary `registry-manifest.json` read.
 */
export async function fetchClaudePluginManifest(
  repo: string,
  ref: string,
  token: string,
): Promise<ClaudePluginManifest | null> {
  const res = await readRepoFile({
    repo,
    path: CLAUDE_PLUGIN_MANIFEST_PATH,
    ref,
    token,
  });
  if (!res.ok) return null;
  try {
    const parsed = JSON.parse(res.content) as {
      name?: unknown;
      skills?: unknown;
    };
    if (!Array.isArray(parsed.skills)) return null;
    const skills = parsed.skills.filter(
      (s): s is string => typeof s === "string",
    );
    return {
      name: typeof parsed.name === "string" ? parsed.name : repo,
      skills,
    };
  } catch {
    return null;
  }
}

function skillPathFromDeclaredPath(declaredPath: string): string {
  const clean = declaredPath.replace(/^\.\//, "").replace(/\/+$/, "");
  return `${clean}/SKILL.md`;
}

function nameFromDeclaredPath(declaredPath: string): string {
  const clean = declaredPath.replace(/^\.\//, "").replace(/\/+$/, "");
  const segs = clean.split("/");
  return segs[segs.length - 1]!;
}

/**
 * Fold a linked repo's plugin-declared skills into `manifest`, adding a
 * row for any declared path not already tracked under `repoUrl`. Skips a
 * declared entry when its skill path is already tracked (same
 * `origin.url` + `origin.skillPath`), or when its derived name already
 * belongs to a different origin (name collision — left for the existing
 * collision-detection machinery in `importRegistryManifest` rather than
 * risking a duplicate-name row here). Pure; returns the same `manifest`
 * reference when there's nothing to add.
 */
export function mergePluginDeclaredSkills(
  manifest: RegistryManifest,
  plugin: ClaudePluginManifest,
  repoUrl: string,
): RegistryManifest {
  const trackedSkillPaths = new Set(
    manifest.skills
      .filter((s) => s.origin.url === repoUrl)
      .map((s) => s.origin.skillPath)
      .filter((p): p is string => Boolean(p)),
  );
  const namesInUse = new Map(
    manifest.skills.map((s) => [s.name, s.origin.url]),
  );

  const additions: ManifestSkill[] = [];
  for (const declared of plugin.skills) {
    const skillPath = skillPathFromDeclaredPath(declared);
    if (trackedSkillPaths.has(skillPath)) continue;
    const name = nameFromDeclaredPath(declared);
    if (namesInUse.has(name) && namesInUse.get(name) !== repoUrl) continue;
    additions.push({
      name,
      origin: { url: repoUrl, skillPath },
      category: null,
      tags: [],
    });
  }

  if (additions.length === 0) return manifest;
  return {
    schemaVersion: manifest.schemaVersion,
    skills: [...manifest.skills, ...additions],
  };
}
