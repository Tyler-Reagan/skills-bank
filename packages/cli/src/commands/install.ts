import pc from "picocolors";
import { getAgent, installSkill, resolveRegistryRoot } from "@skills-bank/core";

interface InstallCmdOptions {
  force?: boolean;
  root?: string;
}

export function installCommand(name: string, opts: InstallCmdOptions): void {
  const root = resolveRegistryRoot(opts.root);
  const result = installSkill(name, {
    registryRoot: root,
    force: opts.force ?? false,
  });
  if (result.installs.length === 0) {
    console.log(
      `${pc.yellow("!")} ${name} — no agent dirs available to install into.`,
    );
  } else {
    for (const r of result.installs) {
      const label = getAgent(r.agent).label;
      const sigil = r.alreadyInstalled ? pc.dim("=") : pc.green("+");
      const verb = r.alreadyInstalled ? "already installed" : "installed";
      console.log(`${sigil} ${verb} ${pc.bold(name)} → ${label}`);
    }
  }
  for (const e of result.errors) {
    console.log(`${pc.red("x")} ${getAgent(e.agent).label}: ${e.message}`);
  }
}
