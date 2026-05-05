import fs from "node:fs";
import path from "node:path";
import { getClaudeSkillsDir, getStateDir } from "./paths.js";
import { listInstalled } from "./installed.js";
import { readSkillMeta } from "./registry.js";
import type {
  InstalledSkill,
  MigrationAction,
  MigrationResult,
  ScanReport,
} from "./types.js";

export function scanExistingInstalls(registryRoot: string): ScanReport {
  return {
    claudeSkillsDir: getClaudeSkillsDir(),
    registryRoot,
    entries: listInstalled(registryRoot),
  };
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
