import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAgentSkillsDir, type AgentId } from "../shared/agents.js";
import { repointAgentLinks } from "../shared/agent-links.js";
import { type AppError, fromCaught, makeAppError } from "../shared/errors.js";
import type { RegistryEntry } from "../shared/types.js";
import type { UnlinkTargetResult } from "./install.js";
import { buildRegistryIndex } from "../registry/build.js";
import { reconcileFoldersToManifest } from "../registry/reconcile-folders.js";
import { setRuntimeEntry } from "../registry/runtime-map.js";
import { findSkillFolder } from "../registry/walk.js";

/**
 * Record that this skill's most recent Unregister attempt failed
 * (issue #211's "Unregister Failure"). Every failure path this marks
 * returns before touching the folder or manifest row, so the row
 * itself is unchanged — this timestamp is the only trace that the
 * attempt happened. Cleared by a successful Unregister (the row and
 * this runtime entry are dropped together by `reconcileFoldersToManifest`)
 * or by `dismissUnregisterFailure`.
 */
function markUnregisterFailed(registryRoot: string, name: string): void {
  setRuntimeEntry(registryRoot, name, {
    unregisterFailedAt: new Date().toISOString(),
  });
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
    // Files already gone — registry-folder-missing heal state. Reconcile
    // drops the now-orphaned manifest row so the user can re-register
    // from another location if needed.
    reconcileFoldersToManifest(opts.registryRoot);
    const idxPath = path.join(opts.registryRoot, "index.json");
    if (fs.existsSync(idxPath)) {
      buildRegistryIndex(opts.registryRoot, {
        includeGitInfo: true,
        writeFile: true,
      });
    }
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
    markUnregisterFailed(opts.registryRoot, name);
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
        markUnregisterFailed(opts.registryRoot, name);
        const error = makeAppError({
          code: "unregister.force-overwrite-failed",
          message: `failed to remove existing folder at ${destDir}: ${(err as Error).message}`,
          suggestedActions: [
            {
              kind: "remove-from-registry",
              label: "Remove from registry instead",
              tone: "danger",
            },
          ],
          copyableDetails: { name, destDir, stack: (err as Error).stack ?? "" },
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
      markUnregisterFailed(opts.registryRoot, name);
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
          {
            kind: "remove-from-registry",
            label: "Remove from registry instead",
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
      markUnregisterFailed(opts.registryRoot, name);
      const caught = fromCaught("unregister.move-failed", err);
      const error = makeAppError({
        code: caught.code,
        message: `move failed: ${caught.message}`,
        suggestedActions: [
          {
            kind: "remove-from-registry",
            label: "Remove from registry instead",
            tone: "danger",
          },
        ],
        copyableDetails: { ...caught.copyableDetails, name },
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

  // Repoint every agent-dir symlink that pointed at the old bank copy
  // to the new destination. Shared with moveSkillBucket — see
  // shared/agent-links.ts for why this reads the raw target rather than
  // realpath (sourceDir is already gone by now).
  const { relinked, errors: repointErrors } = repointAgentLinks(
    name,
    sourceDir,
    destDir,
  );
  const rewrites: UnlinkTargetResult[] = relinked.map((r) => ({
    agent: r.agent,
    linkPath: r.linkPath,
    removed: true,
  }));
  for (const e of repointErrors) {
    errors.push(
      makeAppError({
        code: "unregister.rewrite-failed",
        message: `${e.agent}: ${e.message}`,
        copyableDetails: {
          agent: e.agent,
          linkPath: path.join(getAgentSkillsDir(e.agent), name),
        },
      }),
    );
  }

  reconcileFoldersToManifest(opts.registryRoot);
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

export interface PurgeFromRegistryResult {
  ok: boolean;
  name: string;
  message: string;
  error?: AppError;
}

/**
 * Recovery action for a skill stranded in the registry after an
 * `unregisterSkill` call couldn't complete (e.g. a destination
 * collision the user doesn't want to resolve by picking another
 * destination or overwriting). Deletes the skill's on-disk folder
 * from the registry — no move, no destination — and reconciles the
 * manifest, which drops its now-orphaned row. Any agent-dir symlinks
 * still pointing at the old
 * registry copy are left as broken links for the existing
 * broken-symlink repair flow to pick up, same as any other
 * registry-copy removal.
 */
export function purgeSkillFromRegistry(
  registryRoot: string,
  name: string,
): PurgeFromRegistryResult {
  const folder = findSkillFolder(registryRoot, name);
  if (!folder) {
    const error = makeAppError({
      code: "purge.not-in-registry",
      message: `${name} is not in the registry`,
      copyableDetails: { name },
    });
    return { ok: false, name, message: error.message, error };
  }
  try {
    fs.rmSync(folder.dir, { recursive: true, force: true });
  } catch (err) {
    const error = fromCaught("purge.remove-failed", err);
    return { ok: false, name, message: error.message, error };
  }
  reconcileFoldersToManifest(registryRoot);
  buildRegistryIndex(registryRoot, { includeGitInfo: true, writeFile: true });
  return { ok: true, name, message: `${name} removed from the registry` };
}

/**
 * Clear a skill's Unregister Failure marker without retrying the
 * operation — the "leave it registered, stop reminding me" escape
 * (issue #212). The skill stays exactly as registered as it already
 * was; only the runtime marker is dropped.
 */
export function dismissUnregisterFailure(
  registryRoot: string,
  name: string,
): void {
  setRuntimeEntry(registryRoot, name, { unregisterFailedAt: undefined });
}

function tildeify(p: string): string {
  const home = os.homedir();
  return p.startsWith(home + path.sep) ? "~" + p.slice(home.length) : p;
}
