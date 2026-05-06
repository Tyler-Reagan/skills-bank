import readline from "node:readline";
import pc from "picocolors";
import {
  finalizeSkillsDir,
  resolveRegistryRoot,
  scanExistingInstalls,
} from "@skills-bank/core";

interface FinalizeCmdOptions {
  yes?: boolean;
  root?: string;
}

export async function finalizeCommand(opts: FinalizeCmdOptions): Promise<void> {
  const root = resolveRegistryRoot(opts.root);
  const report = scanExistingInstalls(root);

  if (!report.topLevelSymlink) {
    console.log(
      `${report.claudeSkillsDir} is already a real directory; nothing to finalize.`,
    );
    return;
  }

  console.log(pc.bold("Finalize ~/.claude/skills"));
  console.log(
    `  current: ${report.claudeSkillsDir} → ${report.topLevelSymlink.resolvedTarget}`,
  );
  console.log(
    `  result:  ${report.claudeSkillsDir} (real dir with per-skill symlinks)`,
  );
  console.log();

  const unmigrated = report.entries.filter((e) => e.kind === "real-directory");
  if (unmigrated.length > 0) {
    console.log(
      pc.red(
        `Cannot finalize: ${unmigrated.length} entr${
          unmigrated.length === 1 ? "y is" : "ies are"
        } still real director${unmigrated.length === 1 ? "y" : "ies"}.`,
      ),
    );
    for (const e of unmigrated) console.log(`    - ${e.name}`);
    console.log();
    console.log(pc.dim("Run `skills-bank import` first to adopt them."));
    process.exit(1);
  }

  if (!opts.yes) {
    const ok = await prompt("Apply finalize? [y/N] ");
    if (!/^y(es)?$/i.test(ok.trim())) {
      console.log(pc.dim("aborted"));
      return;
    }
  }

  const result = finalizeSkillsDir({
    registryRoot: root,
    confirmDestructive: true,
  });
  if (result.ok) {
    console.log(pc.green("✓ ") + result.message);
  } else {
    console.error(pc.red("✖ ") + result.message);
    if (result.blockingEntries) {
      for (const n of result.blockingEntries) console.error(`    - ${n}`);
    }
    process.exit(1);
  }
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
