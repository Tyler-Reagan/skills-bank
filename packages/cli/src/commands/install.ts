import pc from "picocolors";
import { installSkill, resolveRegistryRoot } from "@skills-bank/core";

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
  if (result.alreadyInstalled) {
    console.log(`${pc.dim("=")} ${name} already installed → ${result.target}`);
  } else {
    console.log(
      `${pc.green("+")} installed ${pc.bold(name)} → ${result.target}`,
    );
  }
}
