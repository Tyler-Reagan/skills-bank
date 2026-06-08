/**
 * Renderer-safe agent metadata. Lives in its own module (no node
 * imports) so renderers can value-import the constant without dragging
 * fs/os/path through Vite's browser-externalization.
 *
 * Re-exported from `./agents.js` for main-process use; renderers import
 * directly from `@skills-bank/core/agents-data`.
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
 * Order is significant: it's the order shown in UI listings.
 * "claude" first because it's the canonical "all agents" path on most
 * machines and what install operations default to when no agent dir
 * exists yet.
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
