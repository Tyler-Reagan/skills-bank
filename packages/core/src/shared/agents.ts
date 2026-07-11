import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AGENTS,
  type AgentDef,
  type AgentId,
  getAgent,
} from "./agents-data.js";

export { AGENTS, getAgent };
export type { AgentDef, AgentId };

export function getAgentSkillsDir(agent: AgentDef | AgentId): string {
  const def = typeof agent === "string" ? getAgent(agent) : agent;
  const home = process.env.SKILLS_BANK_HOME_OVERRIDE ?? os.homedir();
  return path.join(home, def.relativePath);
}

/** Agent dirs that already exist on disk. */
export function getExistingAgents(): AgentDef[] {
  return AGENTS.filter((a) => {
    try {
      return fs.statSync(getAgentSkillsDir(a)).isDirectory();
    } catch {
      return false;
    }
  });
}

/**
 * Default install targets: every existing agent dir, plus Claude as a
 * fallback when no dirs exist (the "fresh-install user" case). The
 * fallback dir is created at install time by linkSkillToAgents itself.
 *
 * The shared-agents dir (`.agents/skills/`) is excluded from the default
 * fan-out: it's the `npx skills` CLI's canonical store, and writing our
 * symlinks into it fights npx over its own turf — hard-erroring on the
 * real dirs npx owns and polluting its `list`/`update` view. It stays
 * available for an explicit opt-in install (via `opts.agents`), just not
 * by default. skills-bank complements npx; it doesn't seize its store.
 */
export function getDefaultInstallAgents(): AgentDef[] {
  const existing = getExistingAgents().filter((a) => a.id !== "agents");
  if (existing.length > 0) return existing;
  return [getAgent("claude")];
}
