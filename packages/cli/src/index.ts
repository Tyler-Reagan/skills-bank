#!/usr/bin/env node
import { Command } from "commander";
import { listCommand } from "./commands/list.js";
import { installedCommand } from "./commands/installed.js";
import { installCommand } from "./commands/install.js";
import { uninstallCommand } from "./commands/uninstall.js";
import { importCommand } from "./commands/import.js";

const program = new Command();

program
  .name("skills-bank")
  .description("CLI for the skills-bank Claude Code skill registry")
  .version("0.1.0");

program
  .command("list")
  .description("List skills available in the registry")
  .option("--json", "Output JSON")
  .option("--root <path>", "Path to skills-bank registry root")
  .action(listCommand);

program
  .command("installed")
  .description("List skills currently installed under ~/.claude/skills")
  .option("--json", "Output JSON")
  .option("--root <path>", "Path to skills-bank registry root")
  .action(installedCommand);

program
  .command("install <name>")
  .description("Install a registry skill (creates a symlink in ~/.claude/skills)")
  .option("--force", "Replace an existing symlink at the target")
  .option("--root <path>", "Path to skills-bank registry root")
  .action(installCommand);

program
  .command("uninstall <name>")
  .description("Remove a skill symlink from ~/.claude/skills")
  .action(uninstallCommand);

program
  .command("import")
  .description(
    "Scan ~/.claude/skills for pre-existing entries and migrate them into skills-bank",
  )
  .option("--dry-run", "Report what would change; make no filesystem changes")
  .option("--adopt-all", "Adopt every real-directory and copy foreign symlinks")
  .option("--yes", "Skip confirmation prompts")
  .option("--root <path>", "Path to skills-bank registry root")
  .action(importCommand);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
