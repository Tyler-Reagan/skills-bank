import { AGENTS, type AgentDef, type AgentId } from "@skills-bank/core/agents-data";

/** Display label for each agent id. */
export const AGENT_LABELS: Record<AgentId, string> = Object.fromEntries(
  AGENTS.map((a) => [a.id, a.label]),
) as Record<AgentId, string>;

/** Home-relative agent root (`~/.claude`, etc.) — drops the trailing `/skills`. */
export const AGENT_PATHS: Record<AgentId, string> = Object.fromEntries(
  AGENTS.map((a) => [a.id, "~/" + a.relativePath.replace(/\/skills$/, "")]),
) as Record<AgentId, string>;

/** Home-relative skills dir (`~/.claude/skills`, etc.). */
export const AGENT_SKILLS_PATHS: Record<AgentId, string> = Object.fromEntries(
  AGENTS.map((a) => [a.id, "~/" + a.relativePath]),
) as Record<AgentId, string>;

/** Ordered list of agent ids matching the canonical AGENTS order. */
export const ALL_AGENT_IDS: readonly AgentId[] = AGENTS.map((a) => a.id);

/** Full agent records — re-exported so callers needn't reach into core. */
export { AGENTS };
export type { AgentDef, AgentId };
