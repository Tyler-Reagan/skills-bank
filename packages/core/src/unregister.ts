import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AGENTS,
  getAgentSkillsDir,
  type AgentId,
} from "./agents.js";
import { invalidateCanonCache } from "./canon.js";
import {
  readExternalRegistry,
  removeExternalRegistryEntry,
} from "./external.js";
import type { RegistryEntry } from "./types.js";
import type { UninstallTargetResult } from "./install.js";
import { buildRegistryIndex } from "./build.js";

export interface UnregisterOptions {
  registryRoot: string;
  /**
   * Where to move an adopted skill's files. The user-facing setting
   * is `settings.unregisterDestinationAgent` (default `"agents"` →
   * `~/.agents/skills/<name>`). Non-adopted skills ignore this — their
   * origin files are untouched.
   */
  destination: AgentId;
}

export interface UnregisterResult {
  ok: boolean;
  name: string;
  message: string;
  /** Where the files ended up (adopted skills only). */
  destinationPath?: string;
  /** Whether the entry was adopted before unregister. */
  wasAdopted: boolean;
  /** Symlinks rewritten to point at the new location (adopted). */
  rewrites: UninstallTargetResult[];
  /** Aggregate errors from the operation. */
  errors: Array<{ agent?: AgentId; message: string }>;
}

/**
 * Mid-tier destructive action (M4). For adopted skills: moves
 * `<registryRoot>/skills/<name>` → `<destination>/<name>` (e.g. the
 * shared `~/.agents/skills/`), updates every agent-dir symlink that
 * pointed at the bank copy to point at the new location instead, and
 * removes the registry index entry. For non-adopted skills: removes
 * the registry index entry only — origin files are untouched and any
 * symlinks pointing at origin keep working.
 *
 * Distinct from:
 *   - uninstallSkill (Remove from agents): files untouched, symlinks
 *     removed. Reinstall puts symlinks back.
 *   - deleteFromBankSkill (Delete from Skills Bank): files deleted,
 *     symlinks removed. Canon: re-pull. Non-canon: gone.
 */
export function unregisterSkill(
  name: string,
  opts: UnregisterOptions,
): UnregisterResult {
  const index = buildRegistryIndex(opts.registryRoot);
  const entry = index.entries.find((e) => e.name === name);
  if (!entry) {
    return {
      ok: false,
      name,
      message: `${name} is not in the registry`,
      wasAdopted: false,
      rewrites: [],
      errors: [{ message: `${name} is not in the registry` }],
    };
  }
  const wasAdopted = entry.adopted !== false;
  return wasAdopted
    ? unregisterAdopted(entry, name, opts)
    : unregisterExternal(name, opts);
}

function unregisterAdopted(
  entry: RegistryEntry,
  name: string,
  opts: UnregisterOptions,
): UnregisterResult {
  const skillsRoot = path.resolve(opts.registryRoot, "skills");
  const sourceDir = path.resolve(opts.registryRoot, entry.path);
  // Guard: source must live under registryRoot/skills.
  const rel = path.relative(skillsRoot, sourceDir);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel === "") {
    return {
      ok: false,
      name,
      message: `refusing to unregister: source ${sourceDir} is outside ${skillsRoot}`,
      wasAdopted: true,
      rewrites: [],
      errors: [{ message: `source outside skills root` }],
    };
  }
  if (!fs.existsSync(sourceDir)) {
    // Files already gone — registry-folder-missing heal state (M6).
    // For M4 we still drop the index entry so the user can re-register
    // from another location if needed.
    const idxPath = path.join(opts.registryRoot, "index.json");
    if (fs.existsSync(idxPath)) {
      buildRegistryIndex(opts.registryRoot, {
        includeGitInfo: true,
        writeFile: true,
      });
    }
    invalidateCanonCache(opts.registryRoot);
    return {
      ok: true,
      name,
      message: `removed ${name} from the registry (files were already missing)`,
      wasAdopted: true,
      rewrites: [],
      errors: [],
    };
  }

  const destBase = getAgentSkillsDir(opts.destination);
  const destDir = path.join(destBase, name);
  const errors: Array<{ agent?: AgentId; message: string }> = [];

  try {
    fs.mkdirSync(destBase, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      name,
      message: `cannot create destination ${destBase}: ${(err as Error).message}`,
      wasAdopted: true,
      rewrites: [],
      errors: [{ message: (err as Error).message }],
    };
  }

  // If the destination already has a folder by this name, refuse —
  // the user has a name collision with something already at the
  // shared agents dir. They can resolve manually.
  if (fs.existsSync(destDir)) {
    return {
      ok: false,
      name,
      message: `destination ${destDir} already exists; resolve manually before unregistering`,
      wasAdopted: true,
      rewrites: [],
      errors: [{ message: `destination collision: ${destDir}` }],
    };
  }

  // Cross-device fallback: rename fails with EXDEV if dest is on a
  // different filesystem from the bank. Copy + remove in that case.
  try {
    fs.renameSync(sourceDir, destDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EXDEV") {
      fs.cpSync(sourceDir, destDir, { recursive: true });
      fs.rmSync(sourceDir, { recursive: true, force: true });
    } else {
      return {
        ok: false,
        name,
        message: `move failed: ${(err as Error).message}`,
        wasAdopted: true,
        rewrites: [],
        errors: [{ message: (err as Error).message }],
      };
    }
  }

  // Sweep agent dirs and repoint symlinks that pointed at the old
  // sourceDir to the new destDir. Real-directory entries are left
  // alone (they may be unrelated content).
  const rewrites: UninstallTargetResult[] = [];
  for (const agent of AGENTS) {
    const linkPath = path.join(getAgentSkillsDir(agent), name);
    let stat: fs.Stats | null = null;
    try {
      stat = fs.lstatSync(linkPath);
    } catch {
      continue; // doesn't exist
    }
    if (!stat.isSymbolicLink()) continue;
    let realTarget = "";
    try {
      realTarget = fs.realpathSync(linkPath);
    } catch {
      // Broken link — repointing won't help if dest doesn't exist either.
    }
    if (realTarget === sourceDir || realTarget === destDir) {
      try {
        fs.unlinkSync(linkPath);
        // Don't recreate a symlink if destDir === linkPath (the dest
        // is the same agent dir — would create a self-loop).
        if (path.resolve(destDir) !== path.resolve(linkPath)) {
          fs.symlinkSync(destDir, linkPath, "dir");
        }
        rewrites.push({ agent: agent.id, linkPath, removed: true });
      } catch (err) {
        errors.push({ agent: agent.id, message: (err as Error).message });
      }
    }
  }

  // Rebuild the index so the now-unregistered skill drops out.
  buildRegistryIndex(opts.registryRoot, {
    includeGitInfo: true,
    writeFile: true,
  });
  invalidateCanonCache(opts.registryRoot);

  return {
    ok: true,
    name,
    message: `unregistered ${name}; files moved to ${tildeify(destDir)}`,
    destinationPath: destDir,
    wasAdopted: true,
    rewrites,
    errors,
  };
}

function unregisterExternal(
  name: string,
  opts: UnregisterOptions,
): UnregisterResult {
  const entries = readExternalRegistry(opts.registryRoot);
  if (!entries.find((e) => e.name === name)) {
    return {
      ok: false,
      name,
      message: `no external entry for ${name}`,
      wasAdopted: false,
      rewrites: [],
      errors: [{ message: `no external entry for ${name}` }],
    };
  }
  removeExternalRegistryEntry(opts.registryRoot, name);
  buildRegistryIndex(opts.registryRoot, {
    includeGitInfo: true,
    writeFile: true,
  });
  invalidateCanonCache(opts.registryRoot);
  return {
    ok: true,
    name,
    message: `unregistered ${name} (symlink-mode entry removed; origin files untouched)`,
    wasAdopted: false,
    rewrites: [],
    errors: [],
  };
}

function tildeify(p: string): string {
  const home = os.homedir();
  return p.startsWith(home + path.sep) ? "~" + p.slice(home.length) : p;
}
