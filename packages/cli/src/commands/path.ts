import {
  buildRegistryIndex,
  resolveRegistryRoot,
} from "@skills-bank/core";
import path from "node:path";
import fs from "node:fs";

interface PathCmdOptions {
  root?: string;
}

/**
 * Print the absolute path to a registered skill. Enables shell
 * composition: `cd $(skills-bank path foo)`, `$EDITOR $(skills-bank
 * path foo)/SKILL.md`. Exits non-zero on miss so subshell substitution
 * fails fast instead of silently producing an empty arg.
 */
export function pathCommand(name: string, opts: PathCmdOptions): void {
  const root = resolveRegistryRoot(opts.root);
  const index = buildRegistryIndex(root);
  const entry = index.entries.find((e) => e.name === name);
  if (!entry) {
    console.error(`Skill "${name}" not found in registry.`);
    process.exit(1);
  }
  const abs = path.resolve(root, entry.path);
  if (!fs.existsSync(abs)) {
    console.error(
      `Skill "${name}" is in the registry index but its folder is missing on disk: ${abs}`,
    );
    process.exit(1);
  }
  process.stdout.write(abs + "\n");
}
