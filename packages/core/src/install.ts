import fs from "node:fs";
import path from "node:path";
import {
  type AgentDef,
  type AgentId,
  getAgent,
  getAgentSkillsDir,
  getDefaultInstallAgents,
} from "./agents.js";
import { buildRegistryIndex } from "./build.js";
import { findEntry, resolveEntryPath } from "./registry.js";

export interface LinkToAgentsOptions {
  /** If true, replace an existing symlink at the target. Defaults to false. */
  force?: boolean;
}

export interface LinkTargetResult {
  agent: AgentId;
  linkPath: string;
  target: string;
  alreadyInstalled: boolean;
}

export interface LinkResult {
  name: string;
  /** One result per agent dir we wrote (or attempted to write). */
  installs: LinkTargetResult[];
  /**
   * Per-agent failures (e.g. existing real-dir without --force). The
   * caller decides whether partial success is acceptable.
   */
  errors: Array<{ agent: AgentId; message: string }>;
  /** Convenience: true when at least one new symlink was written. */
  anyNew: boolean;
  /** Backward-compat shim: the first install's target. */
  target: string;
}

/**
 * Symlink the skill at `skillPath` into one or more agent directories.
 * Default behavior installs to every agent dir that exists on disk so
 * the same skill is available wherever the user runs an AI tool.
 * Failures on any single target are collected and returned; we don't
 * abort partial successes.
 */
export function linkSkillToAgents(
  skillPath: string,
  agents: AgentDef[],
  opts?: LinkToAgentsOptions,
): LinkResult {
  if (!fs.existsSync(skillPath)) {
    throw new Error(`Registry skill folder missing on disk: ${skillPath}`);
  }

  const name = path.basename(skillPath);
  const targets = agents;
  const target = skillPath;

  const installs: LinkTargetResult[] = [];
  const errors: Array<{ agent: AgentId; message: string }> = [];

  for (const agent of targets) {
    const skillsDir = getAgentSkillsDir(agent);
    try {
      fs.mkdirSync(skillsDir, { recursive: true });
    } catch (err) {
      errors.push({ agent: agent.id, message: (err as Error).message });
      continue;
    }
    const linkPath = path.join(skillsDir, name);

    if (fs.existsSync(linkPath) || isSymlink(linkPath)) {
      const stat = fs.lstatSync(linkPath);
      if (stat.isSymbolicLink()) {
        const current = fs.readlinkSync(linkPath);
        const resolved = path.resolve(skillsDir, current);
        if (resolved === target) {
          installs.push({
            agent: agent.id,
            linkPath,
            target,
            alreadyInstalled: true,
          });
          continue;
        }
        if (!opts?.force) {
          errors.push({
            agent: agent.id,
            message: `${linkPath} is a symlink to ${resolved}; refusing to overwrite without force.`,
          });
          continue;
        }
        fs.unlinkSync(linkPath);
      } else {
        errors.push({
          agent: agent.id,
          message: `${linkPath} exists and is not a symlink. Open Register existing skills in the desktop app to adopt it.`,
        });
        continue;
      }
    }

    try {
      fs.symlinkSync(target, linkPath, "dir");
      installs.push({
        agent: agent.id,
        linkPath,
        target,
        alreadyInstalled: false,
      });
    } catch (err) {
      errors.push({ agent: agent.id, message: (err as Error).message });
    }
  }

  if (installs.length === 0 && errors.length > 0) {
    // Hard failure across all targets — surface the first error so
    // single-target callers don't silently see "nothing happened".
    throw new Error(errors[0]!.message);
  }

  return {
    name,
    installs,
    errors,
    anyNew: installs.some((i) => !i.alreadyInstalled),
    target,
  };
}

export interface UnlinkTargetResult {
  agent: AgentId;
  linkPath: string;
  removed: boolean;
}

export interface UnlinkResult {
  name: string;
  removals: UnlinkTargetResult[];
  errors: Array<{ agent: AgentId; message: string }>;
  /** Convenience: true if any agent dir actually had a symlink to remove. */
  removed: boolean;
  /** Backward-compat shim: the linkPath of the first removal (or first scanned dir). */
  linkPath: string;
}

export function unlinkSkillFromAgents(
  name: string,
  opts: { agents?: AgentId[] } = {},
): UnlinkResult {
  const targets: AgentDef[] = opts.agents
    ? opts.agents.map(getAgent)
    : getDefaultInstallAgents();
  // Even if a target dir doesn't exist, we don't error — unlinking
  // from a never-existing agent is a no-op.

  const removals: UnlinkTargetResult[] = [];
  const errors: Array<{ agent: AgentId; message: string }> = [];
  let firstLinkPath = "";

  for (const agent of targets) {
    const skillsDir = getAgentSkillsDir(agent);
    const linkPath = path.join(skillsDir, name);
    if (!firstLinkPath) firstLinkPath = linkPath;

    if (!fs.existsSync(linkPath) && !isSymlink(linkPath)) {
      removals.push({ agent: agent.id, linkPath, removed: false });
      continue;
    }
    if (!isSymlink(linkPath)) {
      errors.push({
        agent: agent.id,
        message: `${linkPath} is a real directory, not a symlink. Refusing to delete.`,
      });
      continue;
    }
    try {
      fs.unlinkSync(linkPath);
      removals.push({ agent: agent.id, linkPath, removed: true });
    } catch (err) {
      errors.push({ agent: agent.id, message: (err as Error).message });
    }
  }

  return {
    name,
    removals,
    errors,
    removed: removals.some((r) => r.removed),
    linkPath: firstLinkPath,
  };
}

function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export interface DeleteFromBankOptions {
  registryRoot: string;
}

export interface DeleteFromBankResult {
  ok: boolean;
  name: string;
  message: string;
  /** Absolute path that was deleted (when ok). */
  deletedPath?: string;
  /** Result of the symlink cleanup pass. */
  symlinkRemovals?: UnlinkTargetResult[];
  /** Aggregate errors from symlink cleanup + delete. */
  errors: Array<{ agent?: AgentId; message: string }>;
}

/**
 * Full destructive removal of a registered skill: deletes the registry
 * copy AND removes every agent-dir symlink pointing at it.
 *
 * @deprecated for renderer flows — the UI no longer exposes a
 * registered-skill Delete affordance. Use `unregisterSkill` to drop
 * the registry entry (adopted: files expel to the configured agents
 * dir; non-adopted: untouched), then `deleteUnregisteredSkill` from
 * the Installed tab's Unregistered section to wipe files. This op
 * stays for CLI / non-UI consumers that still want the original
 * registered-delete semantic.
 *
 * Guards against deleting anything outside `<registryRoot>/skills/` —
 * the resolved path must live inside the canonical skills directory or
 * the operation refuses.
 */
export function deleteFromBankSkill(
  name: string,
  opts: DeleteFromBankOptions,
): DeleteFromBankResult {
  const index = buildRegistryIndex(opts.registryRoot);
  const entry = findEntry(index, name);
  if (!entry) {
    return {
      ok: false,
      name,
      message: `no registry entry for ${name}`,
      errors: [{ message: `no registry entry for ${name}` }],
    };
  }

  const skillDir = resolveEntryPath(opts.registryRoot, entry);
  const skillsRoot = path.resolve(opts.registryRoot, "skills");
  const rel = path.relative(skillsRoot, skillDir);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel === "") {
    return {
      ok: false,
      name,
      message: `refusing to delete ${skillDir}: outside ${skillsRoot}`,
      errors: [
        {
          message: `refusing to delete ${skillDir}: outside ${skillsRoot}`,
        },
      ],
    };
  }

  const uninstall = unlinkSkillFromAgents(name);
  const errors: Array<{ agent?: AgentId; message: string }> = [
    ...uninstall.errors,
  ];

  try {
    fs.rmSync(skillDir, { recursive: true, force: true });
  } catch (err) {
    errors.push({ message: (err as Error).message });
    return {
      ok: false,
      name,
      message: `delete failed: ${(err as Error).message}`,
      symlinkRemovals: uninstall.removals,
      errors,
    };
  }

  // Rewrite index.json so subsequent listRegistry calls don't return the
  // stale entry. Without this the renderer would still see the deleted
  // skill until the next manual rebuild.
  buildRegistryIndex(opts.registryRoot, {
    includeGitInfo: true,
    writeFile: true,
  });

  const removedCount = uninstall.removals.filter(
    (r: UnlinkTargetResult) => r.removed,
  ).length;
  const message =
    removedCount > 0
      ? `Deleted ${name} from Skills Bank and removed ${removedCount} symlink(s).`
      : `Deleted ${name} from Skills Bank.`;

  return {
    ok: true,
    name,
    message,
    deletedPath: skillDir,
    symlinkRemovals: uninstall.removals,
    errors,
  };
}
