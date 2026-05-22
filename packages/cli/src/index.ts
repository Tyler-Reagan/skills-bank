#!/usr/bin/env node
import { Command } from "commander";
import { listCommand } from "./commands/list.js";
import { installedCommand } from "./commands/installed.js";
import { installCommand } from "./commands/install.js";
import { uninstallCommand } from "./commands/uninstall.js";
import { pathCommand } from "./commands/path.js";

const program = new Command();

program
  .name("skills-bank")
  .description(
    "Scripting surface for Skills Bank. Interactive flows (discover, heal, register, sync) live in the desktop app.",
  )
  .version("0.1.0");

program
  .command("list")
  .description("List skills available in the registry")
  .option("--json", "Output JSON (array of registry entries)")
  .option("--root <path>", "Path to skills-bank registry root")
  .action(listCommand);

program
  .command("installed")
  .description("List skills currently wired into agent dirs")
  .option("--json", "Output JSON (one entry per (skill, agent) installation)")
  .option("--root <path>", "Path to skills-bank registry root")
  .action(installedCommand);

program
  .command("install <name>")
  .description(
    "Install a registry skill. Broadcasts to every existing agent dir unless --agent scopes it.",
  )
  .option(
    "--agent <id>",
    "Install only into this agent (claude, cursor, gemini, copilot, continue, cline, codex, agents)",
  )
  .option("--force", "Replace an existing symlink at the target")
  .option("--root <path>", "Path to skills-bank registry root")
  .action(installCommand);

program
  .command("uninstall <name>")
  .description("Remove a skill symlink. Broadcasts unless --agent scopes it.")
  .option(
    "--agent <id>",
    "Uninstall only from this agent (claude, cursor, gemini, copilot, continue, cline, codex, agents)",
  )
  .action(uninstallCommand);

program
  .command("path <name>")
  .description(
    "Print the absolute path to a registered skill. Enables `cd $(skills-bank path foo)` and `$EDITOR $(skills-bank path foo)/SKILL.md`.",
  )
  .option("--root <path>", "Path to skills-bank registry root")
  .action(pathCommand);

// Redirect-and-exit stubs for commands removed in v1.6. The CLI is now
// the scripting surface; interactive / bulk flows live in the desktop
// app. Keeping these registered (rather than letting commander emit
// "unknown command") gives scripts a one-line pointer to the in-app
// equivalent.
const removed: Array<{ name: string; replacement: string }> = [
  {
    name: "import",
    replacement:
      "Use Register existing skills in the desktop app (or Account → Import a registry for a manifest).",
  },
  {
    name: "export",
    replacement: "Use Account → Export current registry in the desktop app.",
  },
  {
    name: "finalize",
    replacement:
      "Use Settings → Collapse symlinked agent dirs in the desktop app.",
  },
  {
    name: "sync-installed",
    replacement:
      "The desktop app rewires installations automatically; no CLI equivalent.",
  },
];
for (const { name, replacement } of removed) {
  program
    .command(name, { hidden: true })
    .description(`(removed) ${replacement}`)
    .action(() => {
      console.error(
        `\`skills-bank ${name}\` was removed in v1.6. ${replacement}`,
      );
      process.exit(2);
    });
}

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
