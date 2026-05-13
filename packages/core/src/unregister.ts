import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AGENTS, getAgentSkillsDir, type AgentId } from "./agents.js";
import { invalidateCanonCache } from "./canon.js";
import { type AppError, fromCaught, makeAppError } from "./errors.js";
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

export interface UnregisterOpOptions extends UnregisterOptions {
  /**
   * When true, an existing folder at the destination is removed
   * before the move. Routes through the `unregister.destination-collision`
   * suggestedAction path; default `false` preserves the safer "refuse
   * and surface a collision error" behavior.
   */
  force?: boolean;
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
  /** Per-row failures, structured. */
  errors: AppError[];
  /** Top-level error when `ok=false`. */
  error?: AppError;
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
  opts: UnregisterOpOptions,
): UnregisterResult {
  const index = buildRegistryIndex(opts.registryRoot);
  const entry = index.entries.find((e) => e.name === name);
  if (!entry) {
    const error = makeAppError({
      code: "unregister.not-in-registry",
      message: `${name} is not in the registry`,
      copyableDetails: { name },
    });
    return {
      ok: false,
      name,
      message: error.message,
      wasAdopted: false,
      rewrites: [],
      errors: [error],
      error,
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
  opts: UnregisterOpOptions,
): UnregisterResult {
  const skillsRoot = path.resolve(opts.registryRoot, "skills");
  const sourceDir = path.resolve(opts.registryRoot, entry.path);
  // Guard: source must live under registryRoot/skills.
  const rel = path.relative(skillsRoot, sourceDir);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel === "") {
    const error = makeAppError({
      code: "unregister.source-outside-skills-root",
      message: `refusing to unregister: source ${sourceDir} is outside ${skillsRoot}`,
      copyableDetails: { sourceDir, skillsRoot },
    });
    return {
      ok: false,
      name,
      message: error.message,
      wasAdopted: true,
      rewrites: [],
      errors: [error],
      error,
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
  const errors: AppError[] = [];

  try {
    fs.mkdirSync(destBase, { recursive: true });
  } catch (err) {
    const error = makeAppError({
      code: "unregister.cannot-create-destination",
      message: `cannot create destination ${destBase}: ${(err as Error).message}`,
      copyableDetails: { destBase, stack: (err as Error).stack ?? "" },
    });
    return {
      ok: false,
      name,
      message: error.message,
      wasAdopted: true,
      rewrites: [],
      errors: [error],
      error,
    };
  }

  // If the destination already has a folder by this name, refuse —
  // the user has a name collision with something already at the
  // shared agents dir. With `force: true`, wipe the existing folder
  // first (Bundle C's overwrite affordance). Otherwise return a
  // structured collision error so the renderer can offer the
  // pick-another-destination flow.
  if (fs.existsSync(destDir)) {
    if (opts.force) {
      try {
        fs.rmSync(destDir, { recursive: true, force: true });
      } catch (err) {
        const error = makeAppError({
          code: "unregister.force-overwrite-failed",
          message: `failed to remove existing folder at ${destDir}: ${(err as Error).message}`,
          copyableDetails: { destDir, stack: (err as Error).stack ?? "" },
        });
        return {
          ok: false,
          name,
          message: error.message,
          wasAdopted: true,
          rewrites: [],
          errors: [error],
          error,
        };
      }
    } else {
      const error = makeAppError({
        code: "unregister.destination-collision",
        message: `Can't move ${name} to ${destDir} — a folder already exists there.`,
        suggestedActions: [
          {
            kind: "open-unregister-destination-settings",
            label: "Pick another destination…",
            tone: "primary",
          },
          {
            kind: "unregister-force-overwrite",
            label: "Overwrite existing",
            tone: "danger",
          },
        ],
        copyableDetails: { name, destDir, destination: opts.destination },
      });
      return {
        ok: false,
        name,
        message: error.message,
        wasAdopted: true,
        rewrites: [],
        errors: [error],
        error,
      };
    }
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
      const error = fromCaught("unregister.move-failed", err);
      return {
        ok: false,
        name,
        message: `move failed: ${error.message}`,
        wasAdopted: true,
        rewrites: [],
        errors: [error],
        error,
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
        errors.push(
          makeAppError({
            code: "unregister.rewrite-failed",
            message: `${agent.id}: ${(err as Error).message}`,
            copyableDetails: { agent: agent.id, linkPath },
          }),
        );
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
  opts: UnregisterOpOptions,
): UnregisterResult {
  const entries = readExternalRegistry(opts.registryRoot);
  if (!entries.find((e) => e.name === name)) {
    const error = makeAppError({
      code: "unregister.no-external-entry",
      message: `no external entry for ${name}`,
      copyableDetails: { name },
    });
    return {
      ok: false,
      name,
      message: error.message,
      wasAdopted: false,
      rewrites: [],
      errors: [error],
      error,
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
