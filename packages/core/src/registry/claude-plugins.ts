import fs from "node:fs";
import path from "node:path";
import { parseSkillFrontmatter } from "./frontmatter.js";
import { getRealHome } from "../shared/home.js";

/**
 * Reader for Claude Code's plugin state — a purely informational,
 * read-only surface (no adoption path, unlike `npx-lock.ts`'s
 * `AdoptableNpxSkill`). skills-bank never writes any of these files;
 * they're entirely owned by Claude Code's plugin manager.
 *
 * On-disk shape (verified against a live `~/.claude/plugins/` tree):
 *   - `installed_plugins.json`: `{ version, plugins: { "<name>@<marketplace>": [{ installPath, version, ... }] } }`.
 *   - `<installPath>/.claude-plugin/plugin.json`: has a `skills: string[]`
 *     array of paths relative to `installPath`, each a folder with a
 *     `SKILL.md`. This enumeration is authoritative — no directory
 *     guessing needed to find a plugin's skills.
 */

interface InstalledPluginVersionEntry {
  installPath?: string;
  version?: string;
}

interface InstalledPluginsFile {
  version?: number;
  plugins?: Record<string, InstalledPluginVersionEntry[]>;
}

export interface InstalledPluginEntry {
  pluginName: string;
  marketplaceName: string;
  installPath: string;
  version?: string;
}

export interface ClaudePluginSkill {
  name: string;
  description?: string;
  pluginName: string;
  marketplaceName: string;
  /** Absolute path to the skill folder, for reference only — never written to. */
  skillPath: string;
}

/** Path to Claude Code's installed-plugins manifest. Always the real home. */
export function claudePluginsManifestPath(): string {
  return path.join(
    getRealHome(),
    ".claude",
    "plugins",
    "installed_plugins.json",
  );
}

/**
 * Read + flatten `installed_plugins.json`. Returns `[]` on any miss —
 * file absent, unreadable, malformed JSON — matching `readNpxLock`'s
 * "absence and emptiness look alike to callers" contract. A
 * present-but-broken file still logs, since that's evidence of lost
 * state rather than a genuinely plugin-free machine.
 */
export function readInstalledPlugins(
  manifestPath: string = claudePluginsManifestPath(),
): InstalledPluginEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(
        `[skills-bank] Claude plugins manifest unreadable: ${manifestPath}: ${(err as Error).message}`,
      );
    }
    return [];
  }
  let parsed: InstalledPluginsFile;
  try {
    parsed = JSON.parse(raw) as InstalledPluginsFile;
  } catch (err) {
    console.error(
      `[skills-bank] Claude plugins manifest unparseable: ${manifestPath}: ${(err as Error).message}`,
    );
    return [];
  }
  if (!parsed.plugins || typeof parsed.plugins !== "object") return [];

  const entries: InstalledPluginEntry[] = [];
  for (const [key, versions] of Object.entries(parsed.plugins)) {
    const separatorIndex = key.lastIndexOf("@");
    if (separatorIndex <= 0) continue;
    const pluginName = key.slice(0, separatorIndex);
    const marketplaceName = key.slice(separatorIndex + 1);
    for (const entry of versions ?? []) {
      if (typeof entry.installPath !== "string" || !entry.installPath) continue;
      entries.push({
        pluginName,
        marketplaceName,
        installPath: entry.installPath,
        ...(entry.version ? { version: entry.version } : {}),
      });
    }
  }
  return entries;
}

interface PluginManifestFile {
  skills?: string[];
}

/**
 * Build a `ClaudePluginSkill` from a resolved skill folder, or `null` if
 * its `SKILL.md` is missing or has no `name` — same discipline as
 * `walk.ts`'s `readSkillMeta`.
 */
function toPluginSkill(
  skillPath: string,
  entry: InstalledPluginEntry,
): ClaudePluginSkill | null {
  const frontmatter = parseSkillFrontmatter(path.join(skillPath, "SKILL.md"));
  const name = frontmatter?.name;
  if (typeof name !== "string" || !name) return null;
  const description = frontmatter.description;
  return {
    name,
    ...(typeof description === "string" ? { description } : {}),
    pluginName: entry.pluginName,
    marketplaceName: entry.marketplaceName,
    skillPath,
  };
}

/**
 * Resolve one installed plugin's skills into `ClaudePluginSkill` rows.
 * Two discovery modes, mirroring Claude Code's own plugin loader:
 *   - **Explicit** — `plugin.json`'s `skills: string[]` (paths relative to
 *     `installPath`), used when skills live somewhere other than the
 *     default convention (e.g. nested under `skills/<category>/<name>`,
 *     as `mattpocock-skills` does).
 *   - **Convention** — when `plugin.json` has no `skills` field at all,
 *     every immediate subdirectory of `<installPath>/skills/` containing
 *     a `SKILL.md` is a skill. Most plugins (vercel, mcp-apps,
 *     frontend-design) rely on this and never declare `skills` explicitly.
 * An explicit `skills` field always wins outright — it is never merged
 * with a convention scan, matching "declared list replaces the default."
 */
function resolvePluginSkillPaths(
  installPath: string,
  pluginManifest: PluginManifestFile,
): string[] {
  if (Array.isArray(pluginManifest.skills)) {
    return pluginManifest.skills
      .filter((p): p is string => typeof p === "string")
      .map((relSkillPath) => path.resolve(installPath, relSkillPath));
  }
  const skillsDir = path.join(installPath, "skills");
  let dirEntries: fs.Dirent[];
  try {
    dirEntries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return dirEntries
    .filter((d) => d.isDirectory())
    .map((d) => path.join(skillsDir, d.name));
}

/**
 * Resolve every installed plugin's skills into `ClaudePluginSkill` rows,
 * reusing the same frontmatter parser the registry's own folder walk uses
 * (`parseSkillFrontmatter`).
 */
export function readPluginSkills(
  entries: InstalledPluginEntry[],
): ClaudePluginSkill[] {
  const result: ClaudePluginSkill[] = [];
  for (const entry of entries) {
    const pluginManifestPath = path.join(
      entry.installPath,
      ".claude-plugin",
      "plugin.json",
    );
    let pluginManifest: PluginManifestFile;
    try {
      pluginManifest = JSON.parse(
        fs.readFileSync(pluginManifestPath, "utf8"),
      ) as PluginManifestFile;
    } catch {
      continue;
    }

    for (const skillPath of resolvePluginSkillPaths(
      entry.installPath,
      pluginManifest,
    )) {
      const skill = toPluginSkill(skillPath, entry);
      if (skill) result.push(skill);
    }
  }
  return result;
}

/** Convenience composition: every skill exposed by every installed Claude Code plugin. */
export function listClaudePluginSkills(): ClaudePluginSkill[] {
  return readPluginSkills(readInstalledPlugins());
}
