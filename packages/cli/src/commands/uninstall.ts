import pc from "picocolors";
import { uninstallSkill } from "@skills-bank/core";

export function uninstallCommand(name: string): void {
  const result = uninstallSkill(name);
  if (result.removed) {
    console.log(`${pc.red("-")} removed ${pc.bold(name)} (${result.linkPath})`);
  } else {
    console.log(`${pc.dim("=")} ${name} was not installed`);
  }
}
