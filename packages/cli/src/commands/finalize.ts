import readline from "node:readline";
import pc from "picocolors";
import {
  finalizeSkillsDir,
  getAgent,
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

  if (report.topLevelSymlinks.length === 0) {
    console.log(
      "No agent skills directories are top-level symlinks; nothing to finalize.",
    );
    return;
  }

  // Process each agent dir whose top-level is a symlink. The CLI loops
  // through them; the user confirms once to apply all.
  console.log(pc.bold("Finalize agent skills directories"));
  for (const tls of report.topLevelSymlinks) {
    const dir = report.agentDirs[tls.agent];
    console.log(
      `  ${getAgent(tls.agent).label}: ${dir} → ${tls.resolvedTarget}`,
    );
  }
  console.log();

  const unregistered = report.entries.filter((e) => e.kind === "real-directory");
  if (unregistered.length > 0) {
    console.log(
      pc.red(
        `Cannot finalize: ${unregistered.length} entr${
          unregistered.length === 1 ? "y is" : "ies are"
        } still real director${unregistered.length === 1 ? "y" : "ies"}.`,
      ),
    );
    for (const e of unregistered)
      console.log(`    - ${e.name} (${getAgent(e.agent).label})`);
    console.log();
    console.log(pc.dim("Run `skills-bank import` first to adopt them."));
    process.exit(1);
  }

  if (!opts.yes) {
    const ok = await prompt(
      `Apply finalize to ${report.topLevelSymlinks.length} agent dir(s)? [y/N] `,
    );
    if (!/^y(es)?$/i.test(ok.trim())) {
      console.log(pc.dim("aborted"));
      return;
    }
  }

  let failed = false;
  for (const tls of report.topLevelSymlinks) {
    const result = finalizeSkillsDir({
      registryRoot: root,
      agent: tls.agent,
      confirmDestructive: true,
    });
    const label = getAgent(tls.agent).label;
    if (result.ok) {
      console.log(pc.green("✓ ") + `${label}: ${result.message}`);
    } else {
      failed = true;
      console.error(pc.red("✖ ") + `${label}: ${result.message}`);
      if (result.blockingEntries) {
        for (const n of result.blockingEntries) console.error(`    - ${n}`);
      }
    }
  }
  if (failed) process.exit(1);
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
