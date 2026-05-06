import fs from "node:fs";
import path from "node:path";
import { AGENTS, getAgentSkillsDir, type AgentDef } from "./agents.js";
import { buildRegistryIndex } from "./build.js";
import type {
  InstalledKind,
  InstalledSkill,
  RegistryEntry,
  RegistryIndex,
} from "./types.js";

export interface ListInstalledOptions {
  /**
   * Pre-built registry index. If omitted, listInstalled will build one in
   * memory from the registry root. Pass an existing index when calling
   * multiple list functions in sequence to avoid redundant scans.
   */
  index?: RegistryIndex;
  /**
   * Restrict the scan to a subset of agents. Default: every agent in
   * AGENTS whose skills dir exists on disk.
   */
  agents?: AgentDef[];
}

export function listInstalled(
  registryRoot: string,
  opts: ListInstalledOptions = {},
): InstalledSkill[] {
  const index = opts.index ?? buildRegistryIndex(registryRoot);
  const entriesByPath = new Map<string, RegistryEntry>();
  for (const e of index.entries) {
    entriesByPath.set(path.resolve(registryRoot, e.path), e);
  }
  // Anything under <registryRoot>/skills/ is "ours" even if not in the
  // index — meaning a stale or missing index can never make a migrated
  // skill look unmigrated.
  const ownedRoot = path.resolve(registryRoot, "skills") + path.sep;

  const agents = opts.agents ?? AGENTS;
  const out: InstalledSkill[] = [];
  for (const agent of agents) {
    const skillsDir = getAgentSkillsDir(agent);
    if (!fs.existsSync(skillsDir)) continue;
    let names: string[];
    try {
      names = fs.readdirSync(skillsDir);
    } catch {
      continue;
    }
    for (const name of names) {
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
        const isUnderRegistry = (resolved + path.sep).startsWith(ownedRoot);
        let kind: InstalledKind;
        if (!exists) kind = "broken-symlink";
        else if (ourEntry || isUnderRegistry) kind = "ours";
        else kind = "foreign-symlink";
        out.push({
          name,
          agent: agent.id,
          linkPath,
          target: resolved,
          kind,
          ...(ourEntry ? { registryEntry: ourEntry } : {}),
        });
      } else if (stat.isDirectory()) {
        out.push({
          name,
          agent: agent.id,
          linkPath,
          target: null,
          kind: "real-directory",
        });
      }
    }
  }
  // Sort by name then agent for stable ordering.
  return out.sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.agent.localeCompare(b.agent),
  );
}
