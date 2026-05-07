import readline from "node:readline";
import pc from "picocolors";
import {
  applyMigration,
  resolveRegistryRoot,
  scanExistingInstalls,
  type InstalledSkill,
  type RegistrationAction,
} from "@skills-bank/core";

interface ImportOptions {
  dryRun?: boolean;
  adoptAll?: boolean;
  yes?: boolean;
  root?: string;
}

export async function importCommand(opts: ImportOptions): Promise<void> {
  const root = resolveRegistryRoot(opts.root);
  const report = scanExistingInstalls(root);

  console.log(pc.bold("Scan:"));
  console.log(`  registry: ${root}`);
  console.log(`  skills dir: ${report.claudeSkillsDir}`);
  console.log(`  entries: ${report.entries.length}`);
  console.log();

  if (report.entries.length === 0) {
    console.log(pc.dim("Nothing to migrate."));
    return;
  }

  const planned: Array<{ entry: InstalledSkill; action: RegistrationAction }> =
    [];

  for (const entry of report.entries) {
    const action = await chooseAction(entry, opts);
    planned.push({ entry, action });
  }

  console.log();
  console.log(pc.bold("Plan:"));
  for (const { entry, action } of planned) {
    console.log(`  ${entry.name} (${entry.kind}) → ${describe(action)}`);
  }

  if (opts.dryRun) {
    console.log();
    console.log(pc.dim("--dry-run: no changes made."));
    return;
  }

  if (!opts.yes) {
    const ok = await prompt("\nApply this plan? [y/N] ");
    if (!/^y(es)?$/i.test(ok.trim())) {
      console.log(pc.dim("aborted"));
      return;
    }
  }

  console.log();
  for (const { entry, action } of planned) {
    const result = applyMigration(entry, action, {
      registryRoot: root,
      confirmDestructive: true,
    });
    const tag = result.ok ? pc.green("ok") : pc.red("fail");
    console.log(`  [${tag}] ${result.message}`);
  }

  // index.json is generated on demand on every CLI / desktop call, so no
  // manual rebuild step is needed after adopting new skills.
}

async function chooseAction(
  entry: InstalledSkill,
  opts: ImportOptions,
): Promise<RegistrationAction> {
  if (opts.adoptAll) {
    if (entry.kind === "ours") return { type: "skip", name: entry.name };
    if (entry.kind === "broken-symlink")
      return { type: "remove", name: entry.name };
    return { type: "adopt", name: entry.name };
  }

  if (opts.yes) {
    // Conservative defaults under --yes without --adopt-all
    if (entry.kind === "broken-symlink")
      return { type: "remove", name: entry.name };
    return { type: "skip", name: entry.name };
  }

  const choices: Record<string, RegistrationAction> = {};
  console.log();
  console.log(`${pc.bold(entry.name)} ${pc.dim(`(${entry.kind})`)}`);
  if (entry.target) console.log(`  target: ${entry.target}`);

  const offer: Array<[string, string, () => RegistrationAction]> = [];
  if (entry.kind === "ours") {
    offer.push([
      "s",
      "skip (already integrated)",
      () => ({ type: "skip", name: entry.name }),
    ]);
  } else if (entry.kind === "broken-symlink") {
    offer.push([
      "r",
      "remove broken symlink",
      () => ({ type: "remove", name: entry.name }),
    ]);
    offer.push(["s", "skip", () => ({ type: "skip", name: entry.name })]);
  } else if (entry.kind === "foreign-symlink") {
    offer.push([
      "a",
      "adopt into registry (copy)",
      () => ({ type: "adopt", name: entry.name }),
    ]);
    offer.push([
      "e",
      "register as external (no copy)",
      () => ({ type: "register-external", name: entry.name }),
    ]);
    offer.push(["s", "skip", () => ({ type: "skip", name: entry.name })]);
  } else {
    offer.push([
      "a",
      "adopt into registry (move)",
      () => ({ type: "adopt", name: entry.name }),
    ]);
    offer.push(["s", "skip", () => ({ type: "skip", name: entry.name })]);
  }

  for (const [k, label] of offer) {
    console.log(`  [${k}] ${label}`);
    choices[k] = offer.find(([key]) => key === k)![2]();
  }
  const def = offer[0]![0];
  const ans = (await prompt(`  choose [${def}] `)).trim() || def;
  return choices[ans] ?? choices[def] ?? { type: "skip", name: entry.name };
}

function describe(a: RegistrationAction): string {
  switch (a.type) {
    case "skip":
      return pc.dim("skip");
    case "remove":
      return pc.red("remove symlink");
    case "register-external":
      return pc.yellow("register as external");
    case "adopt":
      return pc.green(`adopt → skills/${a.name}`);
    case "setAgents":
      return pc.cyan(`set-agents → ${a.agents.length} agent(s)`);
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
