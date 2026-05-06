import fs from "node:fs";
import path from "node:path";
import { getClaudeSkillsDir } from "./paths.js";
import { findEntry, resolveEntryPath } from "./registry.js";
import { buildRegistryIndex } from "./build.js";

export interface InstallOptions {
  registryRoot: string;
  /** If true, replace an existing symlink/dir at the target. Defaults to false. */
  force?: boolean;
}

export interface InstallResult {
  name: string;
  linkPath: string;
  target: string;
  alreadyInstalled: boolean;
}

export function installSkill(name: string, opts: InstallOptions): InstallResult {
  const index = buildRegistryIndex(opts.registryRoot);
  const entry = findEntry(index, name);
  if (!entry) {
    throw new Error(
      `Skill "${name}" not found. Verify a folder exists at <root>/skills/${name} with a valid meta.json.`,
    );
  }
  const target = resolveEntryPath(opts.registryRoot, entry);
  if (!fs.existsSync(target)) {
    throw new Error(`Registry skill folder missing on disk: ${target}`);
  }

  const skillsDir = getClaudeSkillsDir();
  fs.mkdirSync(skillsDir, { recursive: true });
  const linkPath = path.join(skillsDir, name);

  if (fs.existsSync(linkPath) || isSymlink(linkPath)) {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      const current = fs.readlinkSync(linkPath);
      const resolved = path.resolve(skillsDir, current);
      if (resolved === target) {
        return { name, linkPath, target, alreadyInstalled: true };
      }
      if (!opts.force) {
        throw new Error(
          `${linkPath} is a symlink to ${resolved}; refusing to overwrite without force.`,
        );
      }
      fs.unlinkSync(linkPath);
    } else {
      throw new Error(
        `${linkPath} exists and is not a symlink. Use \`skills-bank import\` to migrate.`,
      );
    }
  }

  fs.symlinkSync(target, linkPath, "dir");
  return { name, linkPath, target, alreadyInstalled: false };
}

export function uninstallSkill(name: string): { removed: boolean; linkPath: string } {
  const linkPath = path.join(getClaudeSkillsDir(), name);
  if (!isSymlink(linkPath)) {
    if (fs.existsSync(linkPath)) {
      throw new Error(
        `${linkPath} is a real directory, not a symlink. Refusing to delete.`,
      );
    }
    return { removed: false, linkPath };
  }
  fs.unlinkSync(linkPath);
  return { removed: true, linkPath };
}

function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
