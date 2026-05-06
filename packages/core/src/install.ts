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

export interface InstallOptions {
  registryRoot: string;
  /**
   * Agents to install for. Default: every agent dir that already exists
   * on disk (or just Claude Code if none exist yet — we create the
   * directory in that case).
   */
  agents?: AgentId[];
  /** If true, replace an existing symlink at the target. Defaults to false. */
  force?: boolean;
}

export interface InstallTargetResult {
  agent: AgentId;
  linkPath: string;
  target: string;
  alreadyInstalled: boolean;
}

export interface InstallResult {
  name: string;
  /** One result per agent dir we wrote (or attempted to write). */
  installs: InstallTargetResult[];
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
 * Symlink the registry skill into one or more agent directories.
 * Default behavior installs to every agent dir that exists on disk so
 * the same skill is available wherever the user runs an AI tool.
 * Failures on any single target are collected and returned; we don't
 * abort partial successes.
 */
export function installSkill(
  name: string,
  opts: InstallOptions,
): InstallResult {
  const index = buildRegistryIndex(opts.registryRoot);
  const entry = findEntry(index, name);
  if (!entry) {
    throw new Error(
      `Skill "${name}" not found. Verify a folder exists at <root>/skills/${name} with a valid meta.json.`,
    );
  }
  const target = resolveEntryPath(opts.registryRoot, entry);
  if (!fs.existsSync(target)) {
    throw new Error(`Registry skill folder missing on disk: ${target}`);
  }

  const targets: AgentDef[] = opts.agents
    ? opts.agents.map(getAgent)
    : getDefaultInstallAgents();

  const installs: InstallTargetResult[] = [];
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
        if (!opts.force) {
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
          message: `${linkPath} exists and is not a symlink. Use \`skills-bank import\` to migrate.`,
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

export interface UninstallTargetResult {
  agent: AgentId;
  linkPath: string;
  removed: boolean;
}

export interface UninstallResult {
  name: string;
  removals: UninstallTargetResult[];
  errors: Array<{ agent: AgentId; message: string }>;
  /** Convenience: true if any agent dir actually had a symlink to remove. */
  removed: boolean;
  /** Backward-compat shim: the linkPath of the first removal (or first scanned dir). */
  linkPath: string;
}

export function uninstallSkill(
  name: string,
  opts: { agents?: AgentId[] } = {},
): UninstallResult {
  const targets: AgentDef[] = opts.agents
    ? opts.agents.map(getAgent)
    : getDefaultInstallAgents();
  // Even if a target dir doesn't exist, we don't error — uninstalling
  // from a never-existing agent is a no-op.

  const removals: UninstallTargetResult[] = [];
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
