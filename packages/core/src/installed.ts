import fs from "node:fs";
import path from "node:path";
import { getClaudeSkillsDir } from "./paths.js";
import { loadIndex } from "./registry.js";
import type { InstalledKind, InstalledSkill, RegistryEntry } from "./types.js";

export function listInstalled(registryRoot: string): InstalledSkill[] {
  const skillsDir = getClaudeSkillsDir();
  if (!fs.existsSync(skillsDir)) return [];
  const index = loadIndex(registryRoot);
  const entriesByPath = new Map<string, RegistryEntry>();
  for (const e of index.entries) {
    entriesByPath.set(path.resolve(registryRoot, e.path), e);
  }

  const out: InstalledSkill[] = [];
  for (const name of fs.readdirSync(skillsDir)) {
    const linkPath = path.join(skillsDir, name);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(linkPath);
    } catch {
      continue;
    }

    if (stat.isSymbolicLink()) {
      const raw = fs.readlinkSync(linkPath);
      const resolved = path.resolve(skillsDir, raw);
      const exists = fs.existsSync(resolved);
      const ourEntry = entriesByPath.get(resolved);
      let kind: InstalledKind;
      if (!exists) kind = "broken-symlink";
      else if (ourEntry) kind = "ours";
      else kind = "foreign-symlink";
      out.push({
        name,
        linkPath,
        target: resolved,
        kind,
        ...(ourEntry ? { registryEntry: ourEntry } : {}),
      });
    } else if (stat.isDirectory()) {
      out.push({ name, linkPath, target: null, kind: "real-directory" });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
