import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AGENTS, getAgentSkillsDir, type AgentId } from "../shared/agents.js";
import { type AppError, fromCaught, makeAppError } from "../shared/errors.js";
import { readLiveManifest, writeLiveManifest } from "../manifest/manifest.js";
import { removeRuntimeEntry } from "../registry/runtime-map.js";
import type { RegistryEntry } from "../shared/types.js";
import type { UnlinkTargetResult } from "./install.js";
import { buildRegistryIndex } from "../registry/build.js";

/** Drop a skill's manifest row + runtime entry — the reciprocal of
 *  `reconcileFoldersToManifest`'s add, called whenever a skill's
 *  registry entry is removed for good. */
function removeManifestRow(registryRoot: string, name: string): void {
  const manifest = readLiveManifest(registryRoot);
  const next = manifest.skills.filter((s) => s.name !== name);
  if (next.length !== manifest.skills.length) {
    writeLiveManifest(registryRoot, { ...manifest, skills: next });
  }
  removeRuntimeEntry(registryRoot, name);
}

export interface UnregisterOptions {
  registryRoot: string;
  /**
   * Where to move the skill's files. The user-facing setting is
   * `settings.unregisterDestinationAgent` (default `"agents"` →
   * `~/.agents/skills/<name>`).
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
  /** Where the files ended up. */
  destinationPath?: string;
  /** Symlinks rewritten to point at the new location. */
  rewrites: UnlinkTargetResult[];
  /** Per-row failures, structured. */
  errors: AppError[];
  /** Top-level error when `ok=false`. */
  error?: AppError;
}

/**
 * Mid-tier destructive action: move a registered skill's files out of
 * the bank. Moves `<registryRoot>/skills/<name>` → `<destination>/<name>`
 * (e.g. the shared `~/.agents/skills/`), repoints every agent-dir symlink
 * that pointed at the bank copy to the new location, and drops the
 * manifest row. Register's inverse (ADR-0022).
 *
 * Distinct from:
 *   - uninstallSkill (Remove from agents): files untouched, symlinks
 *     removed. Reinstall puts symlinks back.
 *   - deleteUnregisteredSkill (Delete from this machine): files deleted.
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
      rewrites: [],
      errors: [error],
      error,
    };
  }
  return moveOutOfBank(entry, name, opts);
}

function moveOutOfBank(
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
      rewrites: [],
      errors: [error],
      error,
    };
  }
  if (!fs.existsSync(sourceDir)) {
    // Files already gone — registry-folder-missing heal state. Drop the
    // manifest row anyway so the user can re-register from another
    // location if needed.
    const idxPath = path.join(opts.registryRoot, "index.json");
    if (fs.existsSync(idxPath)) {
      buildRegistryIndex(opts.registryRoot, {
        includeGitInfo: true,
        writeFile: true,
      });
    }
    removeManifestRow(opts.registryRoot, name);
    return {
      ok: true,
      name,
      message: `removed ${name} from the registry (files were already missing)`,
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
      rewrites: [],
      errors: [error],
      error,
    };
  }

  // If `destDir` is itself a symlink that points at the source we're
  // about to move (typical install→register→unregister: the file
  // originated in agent dir, got registered into the bank, and the agent
  // dir kept a symlink to the bank copy), unlink it now. The move
  // would otherwise see "destination exists" and refuse, surfacing a
  // spurious collision on the happy path.
  try {
    const stat = fs.lstatSync(destDir);
    if (stat.isSymbolicLink()) {
      const resolved = (() => {
        try {
          return fs.realpathSync(destDir);
        } catch {
          return "";
        }
      })();
      if (resolved === sourceDir) {
        try {
          fs.unlinkSync(destDir);
        } catch {
          // Fall through — the existsSync check below will catch it
          // and surface a proper collision error.
        }
      }
    }
  } catch {
    // destDir doesn't exist — nothing to clean up.
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
            label: "Pick another destination",
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
        rewrites: [],
        errors: [error],
        error,
      };
    }
  }

  // Sweep agent dirs and repoint symlinks that pointed at the old
  // sourceDir to the new destDir. Real-directory entries are left
  // alone (they may be unrelated content).
  const rewrites: UnlinkTargetResult[] = [];
  for (const agent of AGENTS) {
    const linkPath = path.join(getAgentSkillsDir(agent), name);
    let stat: fs.Stats | null = null;
    try {
      stat = fs.lstatSync(linkPath);
    } catch {
      continue; // doesn't exist
    }
    if (!stat.isSymbolicLink()) continue;
    // Resolve the symlink's raw target ourselves rather than via
    // fs.realpathSync: the move above already deleted sourceDir, so
    // realpathSync would throw for any link still pointing at it and
    // we'd never detect (or repoint) exactly the links we're here to fix.
    let target: string;
    try {
      target = path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
    } catch {
      continue; // link vanished or unreadable between lstat and readlink — skip
    }
    if (target === sourceDir || target === destDir) {
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

  removeManifestRow(opts.registryRoot, name);
  // Rebuild the index so the now-unregistered skill drops out.
  buildRegistryIndex(opts.registryRoot, {
    includeGitInfo: true,
    writeFile: true,
  });

  return {
    ok: true,
    name,
    message: `unregistered ${name}; files moved to ${tildeify(destDir)}`,
    destinationPath: destDir,
    rewrites,
    errors,
  };
}

function tildeify(p: string): string {
  const home = os.homedir();
  return p.startsWith(home + path.sep) ? "~" + p.slice(home.length) : p;
}
