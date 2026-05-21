import pc from "picocolors";
import { getAgent, uninstallSkill, type AgentId } from "@skills-bank/core";

interface UninstallCmdOptions {
  agent?: string;
}

export function uninstallCommand(
  name: string,
  opts: UninstallCmdOptions,
): void {
  const result = uninstallSkill(name, {
    ...(opts.agent ? { agents: [opts.agent as AgentId] } : {}),
  });
  if (!result.removed) {
    console.log(`${pc.dim("=")} ${name} was not installed`);
    return;
  }
  for (const r of result.removals) {
    if (!r.removed) continue;
    const label = getAgent(r.agent).label;
    console.log(`${pc.red("-")} removed ${pc.bold(name)} from ${label}`);
  }
  for (const e of result.errors) {
    console.log(`${pc.red("x")} ${getAgent(e.agent).label}: ${e.message}`);
  }
}
