import fs from "node:fs";
import path from "node:path";
import { getClaudeSkillsDir, getStateDir } from "./paths.js";
import { listInstalled } from "./installed.js";
import { readSkillMeta } from "./registry.js";
import type {
  FinalizeResult,
  InstalledSkill,
  MigrationAction,
  MigrationResult,
  ScanReport,
  TopLevelSymlinkInfo,
} from "./types.js";

export function scanExistingInstalls(registryRoot: string): ScanReport {
  const claudeSkillsDir = getClaudeSkillsDir();
  return {
    claudeSkillsDir,
    registryRoot,
    entries: listInstalled(registryRoot),
    topLevelSymlink: detectTopLevelSymlink(claudeSkillsDir),
  };
}

function detectTopLevelSymlink(skillsDir: string): TopLevelSymlinkInfo | null {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(skillsDir);
  } catch {
    return null;
  }
  if (!stat.isSymbolicLink()) return null;
  let resolvedTarget: string;
  try {
    resolvedTarget = fs.realpathSync(skillsDir);
  } catch {
    // Broken symlink at the top level — read the link target verbatim.
    const raw = fs.readlinkSync(skillsDir);
    return {
      resolvedTarget: path.resolve(path.dirname(skillsDir), raw),
      exists: false,
    };
  }
  const exists = fs.existsSync(resolvedTarget);
  return { resolvedTarget, exists };
}

export interface MigrateOptions {
  registryRoot: string;
  /** Required to delete real directories or overwrite existing in-repo skill folders. */
  confirmDestructive?: boolean;
}

export function applyMigration(
  entry: InstalledSkill,
  action: MigrationAction,
  opts: MigrateOptions,
): MigrationResult {
  try {
    switch (action.type) {
      case "skip":
        return { action, ok: true, message: `skipped ${entry.name}` };

      case "remove": {
        if (entry.kind !== "broken-symlink" && !opts.confirmDestructive) {
          return {
            action,
            ok: false,
            message: `refusing to remove ${entry.name}: not a broken symlink (set confirmDestructive)`,
          };
        }
        fs.unlinkSync(entry.linkPath);
        return { action, ok: true, message: `removed ${entry.linkPath}` };
      }

      case "register-external": {
        if (entry.kind !== "foreign-symlink" || !entry.target) {
          return {
            action,
            ok: false,
            message: `cannot register-external: ${entry.name} is ${entry.kind}`,
          };
        }
        registerExternal(opts.registryRoot, entry.name, entry.target);
        return {
          action,
          ok: true,
          message: `registered ${entry.name} as external (${entry.target})`,
        };
      }

      case "adopt": {
        return adoptIntoRegistry(entry, action.category, opts);
      }
    }
  } catch (err) {
    return { action, ok: false, message: String(err instanceof Error ? err.message : err) };
  }
}

function adoptIntoRegistry(
  entry: InstalledSkill,
  category: string,
  opts: MigrateOptions,
): MigrationResult {
  const sourcePath =
    entry.kind === "real-directory" ? entry.linkPath : entry.target;
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return {
      action: { type: "adopt", name: entry.name, category },
      ok: false,
      message: `source path missing for ${entry.name}`,
    };
  }

  const destDir = path.join(opts.registryRoot, "skills", category, entry.name);
  if (fs.existsSync(destDir) && !opts.confirmDestructive) {
    return {
      action: { type: "adopt", name: entry.name, category },
      ok: false,
      message: `${destDir} already exists; pass confirmDestructive to overwrite`,
    };
  }

  fs.mkdirSync(path.dirname(destDir), { recursive: true });

  // For real-directory: move the folder. For foreign symlink: copy contents.
  if (entry.kind === "real-directory") {
    if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
    fs.renameSync(sourcePath, destDir);
  } else {
    if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
    copyDir(sourcePath, destDir);
  }

  // If meta.json missing, synthesize a minimal one from SKILL.md or fallback.
  const metaPath = path.join(destDir, "meta.json");
  if (!fs.existsSync(metaPath)) {
    const meta = readSkillMeta(destDir) ?? {
      name: entry.name,
      description: "(adopted via skills-bank import; description missing)",
    };
    fs.writeFileSync(
      metaPath,
      JSON.stringify(
        { ...meta, name: entry.name, domain: meta.domain ?? category },
        null,
        2,
      ) + "\n",
    );
  }

  // Replace the original ~/.claude/skills/<name> with a symlink to destDir.
  // (For foreign-symlink the original symlink path still exists; replace it.)
  if (fs.existsSync(entry.linkPath) || isSymlink(entry.linkPath)) {
    const stat = fs.lstatSync(entry.linkPath);
    if (stat.isSymbolicLink() || stat.isFile()) {
      fs.unlinkSync(entry.linkPath);
    } else if (stat.isDirectory()) {
      // The directory was renamed away; this branch shouldn't normally hit.
      fs.rmSync(entry.linkPath, { recursive: true, force: true });
    }
  }
  fs.symlinkSync(destDir, entry.linkPath, "dir");

  recordMigration(opts.registryRoot, {
    timestamp: new Date().toISOString(),
    name: entry.name,
    category,
    sourceKind: entry.kind,
    sourcePath,
    destPath: destDir,
    linkPath: entry.linkPath,
  });

  return {
    action: { type: "adopt", name: entry.name, category },
    ok: true,
    message: `adopted ${entry.name} → ${path.relative(opts.registryRoot, destDir)}`,
  };
}

function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else if (ent.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(s), d);
    } else fs.copyFileSync(s, d);
  }
}

function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

interface ExternalEntry {
  name: string;
  target: string;
  registeredAt: string;
}

function externalRegistryPath(registryRoot: string): string {
  return path.join(getStateDir(registryRoot), "external.json");
}

function registerExternal(
  registryRoot: string,
  name: string,
  target: string,
): void {
  const p = externalRegistryPath(registryRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let list: ExternalEntry[] = [];
  if (fs.existsSync(p)) {
    try {
      list = JSON.parse(fs.readFileSync(p, "utf8")) as ExternalEntry[];
    } catch {
      list = [];
    }
  }
  const filtered = list.filter((e) => e.name !== name);
  filtered.push({ name, target, registeredAt: new Date().toISOString() });
  fs.writeFileSync(p, JSON.stringify(filtered, null, 2) + "\n");
}

interface MigrationLogEntry {
  timestamp: string;
  name: string;
  category: string;
  sourceKind: string;
  sourcePath: string;
  destPath: string;
  linkPath: string;
}

function recordMigration(registryRoot: string, entry: MigrationLogEntry): void {
  const dir = getStateDir(registryRoot);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `migration-${entry.timestamp.replace(/[:.]/g, "-")}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(entry, null, 2) + "\n");
}

export interface FinalizeOptions {
  registryRoot: string;
  /** Required to actually swap the top-level symlink for a real directory. */
  confirmDestructive?: boolean;
}

/**
 * Replace a symlinked `~/.claude/skills` with a real directory containing the
 * same per-skill symlinks, eliminating the double-hop indirection that
 * remains after adopting skills from a parent like `~/.agents/skills/`.
 *
 * Refuses to run unless every entry in the resolved directory is already a
 * symlink (i.e. all real-directory entries have been adopted via
 * applyMigration first). The original top-level symlink is renamed to a
 * timestamped backup rather than deleted.
 */
export function finalizeSkillsDir(opts: FinalizeOptions): FinalizeResult {
  const skillsDir = getClaudeSkillsDir();

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(skillsDir);
  } catch {
    return { ok: false, message: `${skillsDir} does not exist` };
  }
  if (!stat.isSymbolicLink()) {
    return {
      ok: false,
      message: `${skillsDir} is already a real directory; nothing to finalize`,
    };
  }

  let resolved: string;
  try {
    resolved = fs.realpathSync(skillsDir);
  } catch (err) {
    return {
      ok: false,
      message: `cannot resolve target of ${skillsDir}: ${(err as Error).message}`,
    };
  }

  // Snapshot every entry so we can recreate them in the new real directory.
  interface EntrySnapshot {
    name: string;
    isSymlink: boolean;
    target?: string;
  }
  const snapshot: EntrySnapshot[] = [];
  const blocking: string[] = [];
  for (const name of fs.readdirSync(resolved)) {
    const p = path.join(resolved, name);
    let s: fs.Stats;
    try {
      s = fs.lstatSync(p);
    } catch {
      continue;
    }
    if (s.isSymbolicLink()) {
      const raw = fs.readlinkSync(p);
      snapshot.push({
        name,
        isSymlink: true,
        target: path.resolve(resolved, raw),
      });
    } else if (s.isDirectory()) {
      snapshot.push({ name, isSymlink: false });
      blocking.push(name);
    }
  }

  if (blocking.length > 0) {
    return {
      ok: false,
      message: `Cannot finalize: ${blocking.length} entr${
        blocking.length === 1 ? "y is" : "ies are"
      } still real director${
        blocking.length === 1 ? "y" : "ies"
      }. Migrate them first.`,
      blockingEntries: blocking,
    };
  }

  if (!opts.confirmDestructive) {
    return {
      ok: false,
      message: "set confirmDestructive to perform the rename + rebuild",
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${skillsDir}.bak.${stamp}`;

  // Step 1: move the top-level symlink to a backup name (renames the
  // symlink itself, not its target, since fs.renameSync doesn't follow the
  // trailing component).
  fs.renameSync(skillsDir, backupPath);

  // Step 2: create a fresh real directory at the original path.
  try {
    fs.mkdirSync(skillsDir, { recursive: true });
    // Step 3: recreate each per-skill symlink pointing directly at its
    // (now absolute) target — no more double-hop.
    for (const e of snapshot) {
      if (e.isSymlink && e.target) {
        fs.symlinkSync(e.target, path.join(skillsDir, e.name), "dir");
      }
    }
  } catch (err) {
    // Best-effort rollback: restore the original symlink.
    try {
      fs.rmSync(skillsDir, { recursive: true, force: true });
      fs.renameSync(backupPath, skillsDir);
    } catch {
      // Swallow — surface the original error.
    }
    return {
      ok: false,
      message: `finalize failed during rebuild; restored original symlink. (${
        (err as Error).message
      })`,
    };
  }

  recordFinalize(opts.registryRoot, {
    timestamp: new Date().toISOString(),
    skillsDir,
    backupPath,
    originalTarget: resolved,
    entries: snapshot,
  });

  return {
    ok: true,
    message: `${skillsDir} is now a real directory; original symlink saved at ${backupPath}`,
    backupPath,
  };
}

interface FinalizeLogEntry {
  timestamp: string;
  skillsDir: string;
  backupPath: string;
  originalTarget: string;
  entries: Array<{ name: string; isSymlink: boolean; target?: string }>;
}

function recordFinalize(registryRoot: string, entry: FinalizeLogEntry): void {
  const dir = getStateDir(registryRoot);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `finalize-${entry.timestamp.replace(/[:.]/g, "-")}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(entry, null, 2) + "\n");
}
