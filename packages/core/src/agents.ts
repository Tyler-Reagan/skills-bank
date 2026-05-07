import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Stable id for each known agent. Used in IPC payloads, scan reports,
 * and as the value of `installs[].agent` on InstalledSkill. Values are
 * lowercase ASCII; never display these directly — render `label`.
 */
export type AgentId =
  | "claude"
  | "cursor"
  | "gemini"
  | "copilot"
  | "continue"
  | "cline"
  | "codex"
  | "agents";

export interface AgentDef {
  id: AgentId;
  label: string;
  /** Path under $HOME, e.g. ".claude/skills". */
  relativePath: string;
}

/**
 * The skills.sh CLI installs into one of these agent-specific
 * directories, prompting the user to pick at install time. The desktop
 * app scans all of them so a skill installed from any tool surfaces in
 * one place.
 *
 * Order is significant: it's the order shown in UI listings.
 * "claude" first because it's the canonical "all agents" path on most
 * machines and it's what install operations default to when no agent
 * dir exists yet.
 */
export const AGENTS: readonly AgentDef[] = [
  { id: "claude", label: "Claude Code", relativePath: ".claude/skills" },
  { id: "cursor", label: "Cursor", relativePath: ".cursor/skills" },
  { id: "gemini", label: "Gemini", relativePath: ".gemini/skills" },
  { id: "copilot", label: "GitHub Copilot", relativePath: ".copilot/skills" },
  { id: "continue", label: "Continue", relativePath: ".continue/skills" },
  { id: "cline", label: "Cline", relativePath: ".cline/skills" },
  { id: "codex", label: "OpenAI Codex", relativePath: ".codex/skills" },
  { id: "agents", label: "Agents (shared)", relativePath: ".agents/skills" },
] as const;

const AGENTS_BY_ID = new Map<AgentId, AgentDef>(AGENTS.map((a) => [a.id, a]));

export function getAgent(id: AgentId): AgentDef {
  const a = AGENTS_BY_ID.get(id);
  if (!a) throw new Error(`unknown agent id: ${id}`);
  return a;
}

export function getAgentSkillsDir(agent: AgentDef | AgentId): string {
  const def = typeof agent === "string" ? getAgent(agent) : agent;
  return path.join(os.homedir(), def.relativePath);
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
 * fallback dir is created at install time by installSkill itself.
 */
export function getDefaultInstallAgents(): AgentDef[] {
  const existing = getExistingAgents();
  if (existing.length > 0) return existing;
  return [getAgent("claude")];
}
