import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import pc from "picocolors";
import {
  buildRegistryIndex,
  installSkill,
  listInstalled,
  resolveRegistryRoot,
  uninstallSkill,
  type InstalledSkill,
  type RegistryEntry,
} from "@skills-bank/core";

interface SyncCmdOptions {
  dryRun?: boolean;
  yes?: boolean;
  root?: string;
}

interface SwapPlan {
  name: string;
  fromTarget: string;
  toRegistryEntry: RegistryEntry;
}

interface AuditRecord {
  timestamp: string;
  registryRoot: string;
  swaps: Array<{
    name: string;
    previousTarget: string;
    newTarget: string;
    ok: boolean;
    message: string;
  }>;
  realDirectories: string[];
  brokenSymlinks: string[];
}

export async function syncInstalledCommand(opts: SyncCmdOptions): Promise<void> {
  const root = resolveRegistryRoot(opts.root);
  const index = buildRegistryIndex(root);
  const registryByName = new Map<string, RegistryEntry>();
  for (const e of index.entries) registryByName.set(e.name, e);

  const installed = listInstalled(root, { index });

  const swaps: SwapPlan[] = [];
  const realDirs: InstalledSkill[] = [];
  const broken: InstalledSkill[] = [];
  const skippedExternal: InstalledSkill[] = [];

  for (const entry of installed) {
    if (entry.kind === "ours") continue;
    if (entry.kind === "broken-symlink") {
      broken.push(entry);
      continue;
    }
    if (entry.kind === "real-directory") {
      realDirs.push(entry);
      continue;
    }
    // foreign-symlink
    const registryEntry = registryByName.get(entry.name);
    if (registryEntry) {
      swaps.push({
        name: entry.name,
        fromTarget: entry.target ?? "(unknown)",
        toRegistryEntry: registryEntry,
      });
    } else {
      skippedExternal.push(entry);
    }
  }

  console.log(pc.bold("sync-installed"));
  console.log(`  registry: ${root}`);
  console.log(`  registry skills: ${index.entries.length}`);
  console.log(`  installed entries: ${installed.length}`);
  console.log();

  if (swaps.length === 0) {
    console.log(pc.dim("No foreign symlinks match registry entries — nothing to swap."));
  } else {
    console.log(pc.bold(`Plan (${swaps.length} swap${swaps.length === 1 ? "" : "s"}):`));
    for (const s of swaps) {
      const newTarget = path.resolve(root, s.toRegistryEntry.path);
      console.log(
        `  ${pc.cyan("⇄")} ${pc.bold(s.name)}`,
      );
      console.log(`      ${pc.dim("from")} ${s.fromTarget}`);
      console.log(`      ${pc.dim("to")}   ${newTarget}`);
    }
  }

  if (realDirs.length > 0) {
    console.log();
    console.log(
      pc.yellow(
        `Real directories (not auto-handled — run \`skills-bank import\` to adopt):`,
      ),
    );
    for (const e of realDirs) console.log(`    - ${e.name}`);
  }
  if (broken.length > 0) {
    console.log();
    console.log(
      pc.red(`Broken symlinks (not auto-handled — run \`skills-bank import\`):`),
    );
    for (const e of broken) console.log(`    - ${e.name} → ${e.target}`);
  }
  if (skippedExternal.length > 0) {
    console.log();
    console.log(
      pc.dim(
        `External (no registry match — left alone, ${skippedExternal.length} entr${
          skippedExternal.length === 1 ? "y" : "ies"
        }):`,
      ),
    );
    for (const e of skippedExternal) {
      console.log(`    - ${e.name} → ${e.target}`);
    }
  }

  if (opts.dryRun) {
    console.log();
    console.log(pc.dim("--dry-run: no changes made."));
    return;
  }

  if (swaps.length === 0) return;

  if (!opts.yes) {
    const ok = await prompt("\nProceed with the swaps above? [y/N] ");
    if (!/^y(es)?$/i.test(ok.trim())) {
      console.log(pc.dim("aborted"));
      return;
    }
  }

  const audit: AuditRecord = {
    timestamp: new Date().toISOString(),
    registryRoot: root,
    swaps: [],
    realDirectories: realDirs.map((e) => e.name),
    brokenSymlinks: broken.map((e) => e.name),
  };

  console.log();
  for (const s of swaps) {
    const newTarget = path.resolve(root, s.toRegistryEntry.path);
    try {
      uninstallSkill(s.name);
      const r = installSkill(s.name, { registryRoot: root, force: false });
      audit.swaps.push({
        name: s.name,
        previousTarget: s.fromTarget,
        newTarget: r.target,
        ok: true,
        message: r.alreadyInstalled
          ? `already pointed at registry`
          : `swapped → ${r.target}`,
      });
      console.log(
        `  ${pc.green("✓")} ${pc.bold(s.name)} → ${r.target}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      audit.swaps.push({
        name: s.name,
        previousTarget: s.fromTarget,
        newTarget,
        ok: false,
        message,
      });
      console.log(`  ${pc.red("✗")} ${pc.bold(s.name)}: ${message}`);
    }
  }

  // Persist the audit log alongside other migration logs.
  const stateDir = path.join(root, ".skills-bank");
  fs.mkdirSync(stateDir, { recursive: true });
  const stamp = audit.timestamp.replace(/[:.]/g, "-");
  const auditPath = path.join(stateDir, `sync-${stamp}.json`);
  fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2) + "\n");

  const ok = audit.swaps.filter((s) => s.ok).length;
  console.log();
  console.log(
    `Done: ${ok}/${audit.swaps.length} swap${
      audit.swaps.length === 1 ? "" : "s"
    } succeeded. Audit: ${path.relative(root, auditPath)}`,
  );
  if (realDirs.length > 0 || broken.length > 0) {
    console.log(
      pc.dim(
        `Run \`skills-bank import\` to handle ${realDirs.length} real-director${
          realDirs.length === 1 ? "y" : "ies"
        } and ${broken.length} broken symlink${
          broken.length === 1 ? "" : "s"
        }.`,
      ),
    );
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
