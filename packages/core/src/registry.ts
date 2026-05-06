import fs from "node:fs";
import path from "node:path";
import type { RegistryEntry, RegistryIndex, SkillMeta } from "./types.js";

const INDEX_FILE = "index.json";

export function loadIndex(registryRoot: string): RegistryIndex {
  const p = path.join(registryRoot, INDEX_FILE);
  if (!fs.existsSync(p)) {
    return { generatedAt: new Date(0).toISOString(), entries: [] };
  }
  const data = JSON.parse(fs.readFileSync(p, "utf8")) as RegistryIndex;
  return data;
}

export function findEntry(
  index: RegistryIndex,
  name: string,
): RegistryEntry | undefined {
  return index.entries.find((e) => e.name === name);
}

/**
 * Reads SkillMeta for a skill folder. Prefers meta.json; falls back to YAML
 * frontmatter in SKILL.md. Returns null if neither is parseable.
 */
export function readSkillMeta(skillDir: string): SkillMeta | null {
  const metaPath = path.join(skillDir, "meta.json");
  if (fs.existsSync(metaPath)) {
    try {
      return JSON.parse(fs.readFileSync(metaPath, "utf8")) as SkillMeta;
    } catch {
      // fall through
    }
  }
  const skillMd = path.join(skillDir, "SKILL.md");
  if (fs.existsSync(skillMd)) {
    const content = fs.readFileSync(skillMd, "utf8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (match && match[1]) {
      const fm: Record<string, string> = {};
      for (const line of match[1].split("\n")) {
        const idx = line.indexOf(":");
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        const val = line
          .slice(idx + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
        if (key) fm[key] = val;
      }
      if (fm["name"] && fm["description"]) {
        return {
          name: fm["name"],
          description: fm["description"],
          ...(fm["version"] ? { version: fm["version"] } : {}),
          ...(fm["author"] ? { author: fm["author"] } : {}),
        };
      }
    }
  }
  return null;
}

/**
 * Resolves the absolute filesystem path for a registry entry.
 */
export function resolveEntryPath(
  registryRoot: string,
  entry: RegistryEntry,
): string {
  return path.resolve(registryRoot, entry.path);
}
