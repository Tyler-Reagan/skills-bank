import fs from "node:fs";
import path from "node:path";
import { AGENTS, getAgentSkillsDir, type AgentId } from "./agents.js";

/**
 * Canonicalize a skill-folder path for comparison without requiring the
 * folder itself to exist. We can't `realpathSync` the folder — by the
 * time we compare, the moved-away source is already gone — but its
 * PARENT (`skills/<bucket>/`, an agent dir) still exists, so we resolve
 * that and rejoin the basename. This collapses `/var` vs `/private/var`
 * (macOS) and any other symlinked-ancestor differences, which is what a
 * raw string compare of a stored symlink target against a
 * `path.resolve`d dir would otherwise miss.
 */
function canonicalizeFolder(p: string): string {
  try {
    return path.join(fs.realpathSync(path.dirname(p)), path.basename(p));
  } catch {
    return path.resolve(p);
  }
}

export interface AgentLinkRepoint {
  agent: AgentId;
  linkPath: string;
}

export interface RepointAgentLinksResult {
  /** One entry per agent-dir symlink that was rewritten. */
  relinked: AgentLinkRepoint[];
  /** Per-agent failures; the sweep continues past a failing link. */
  errors: Array<{ agent: AgentId; message: string }>;
}

/**
 * Repoint every agent-dir symlink named `name` that currently resolves
 * to `oldDir` so it points at `newDir` instead. Call this AFTER moving
 * the skill folder (`oldDir` → `newDir`).
 *
 * The link's raw target is read with `fs.readlinkSync` — deliberately
 * NOT `fs.realpathSync` — because `oldDir` no longer exists once the
 * move has happened, and `realpathSync` throws for exactly the links
 * this function must fix, leaving them dangling (issue #167, commit
 * 01a7f0a). `readlinkSync` reads the stored target without requiring it
 * to resolve on disk.
 *
 * Only symlinks resolving to `oldDir` are touched; links pointing
 * elsewhere and real directories are left alone. Never creates a
 * self-referential link (`linkPath === newDir`).
 *
 * This is the relocation primitive shared by `moveSkillBucket`
 * (bucket → bucket) and `unregisterSkill` (bank → agents dir).
 * `register.ts` intentionally does NOT use it — see the note on its own
 * sweep for why its converge-to-destination semantic differs.
 */
export function repointAgentLinks(
  name: string,
  oldDir: string,
  newDir: string,
): RepointAgentLinksResult {
  const relinked: AgentLinkRepoint[] = [];
  const errors: Array<{ agent: AgentId; message: string }> = [];
  const oldCanon = canonicalizeFolder(oldDir);
  const newCanon = canonicalizeFolder(newDir);

  for (const agent of AGENTS) {
    const linkPath = path.join(getAgentSkillsDir(agent), name);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(linkPath);
    } catch {
      continue; // nothing at this agent dir
    }
    if (!stat.isSymbolicLink()) continue;

    let target: string;
    try {
      target = path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
    } catch {
      continue; // link vanished or unreadable between lstat and readlink
    }
    if (canonicalizeFolder(target) !== oldCanon) continue;
    if (canonicalizeFolder(linkPath) === newCanon) continue;

    try {
      fs.unlinkSync(linkPath);
      fs.symlinkSync(newDir, linkPath, "dir");
      relinked.push({ agent: agent.id, linkPath });
    } catch (err) {
      errors.push({ agent: agent.id, message: (err as Error).message });
    }
  }

  return { relinked, errors };
}
