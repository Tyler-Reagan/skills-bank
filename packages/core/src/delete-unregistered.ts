import fs from "node:fs";
import type { AgentId } from "./shared/agents.js";
import { buildRegistryIndex } from "./registry/build.js";
import { listInstalled } from "./installed.js";
import type { InstalledSkill } from "./shared/types.js";

export interface DeleteUnregisteredResult {
  ok: boolean;
  name: string;
  message: string;
  /** Real-directory paths fs.rmSync'd. */
  removedDirs: string[];
  /** Symlink paths fs.unlinkSync'd (agent-dir links; targets untouched). */
  removedSymlinks: string[];
  errors: Array<{ agent: AgentId; path: string; message: string }>;
}

/**
 * M9b: delete an unregistered skill's on-disk presence. The user
 * reaches this from the inline Delete button on Unregistered cards
 * in the InstalledTab — registered skills can't be deleted directly;
 * they must be unregistered first (which moves files to the
 * configured agents dir, where they then surface as unregistered).
 *
 * Semantics — intentionally conservative per the M9 plan:
 *   - kind "real-directory" → fs.rmSync recursive force. The bank
 *     considers these the skill's actual content in that agent dir.
 *   - kind "foreign-symlink" / "ours" / "broken-symlink" → fs.unlink
 *     on the link path only. The symlink's target (typically the
 *     user's own repo or a tool's source dir) is user-owned and
 *     left alone.
 *
 * Refuses if the name is currently in the registry — caller must
 * unregister first. This guarantees Delete is the last step of the
 * destructive ladder, not a registered-skill shortcut.
 */
export function deleteUnregisteredSkill(
  registryRoot: string,
  name: string,
): DeleteUnregisteredResult {
  const index = buildRegistryIndex(registryRoot);
  if (index.entries.find((e) => e.name === name)) {
    return {
      ok: false,
      name,
      message: `${name} is still registered — unregister it first`,
      removedDirs: [],
      removedSymlinks: [],
      errors: [],
    };
  }

  const installed = listInstalled(registryRoot, { index });
  const mine = installed.filter((i) => i.name === name);
  if (mine.length === 0) {
    return {
      ok: false,
      name,
      message: `${name} not found in any agent directory`,
      removedDirs: [],
      removedSymlinks: [],
      errors: [],
    };
  }

  const removedDirs: string[] = [];
  const removedSymlinks: string[] = [];
  const errors: DeleteUnregisteredResult["errors"] = [];

  for (const i of mine) {
    try {
      if (i.kind === "real-directory") {
        fs.rmSync(i.linkPath, { recursive: true, force: true });
        removedDirs.push(i.linkPath);
      } else {
        // ours / foreign-symlink / broken-symlink — unlink the
        // symlink only. We never follow into the target dir; that
        // belongs to the user, not the bank.
        fs.unlinkSync(i.linkPath);
        removedSymlinks.push(i.linkPath);
      }
    } catch (err) {
      errors.push({
        agent: i.agent,
        path: i.linkPath,
        message: (err as Error).message,
      });
    }
  }

  return {
    ok: errors.length === 0,
    name,
    message: summarize(name, removedDirs, removedSymlinks, errors),
    removedDirs,
    removedSymlinks,
    errors,
  };
}

/**
 * Build a preview of what `deleteUnregisteredSkill(name)` would do
 * without doing it. Used by the renderer's confirmation modal to
 * show the user exactly which paths will be removed.
 */
export interface DeletePreview {
  /** Real-directory installations that would be deleted (rm -rf). */
  willRemoveDirs: InstalledSkill[];
  /**
   * Symlink installations that would be unlinked. Target paths are
   * preserved so the modal can show "external target NOT touched".
   */
  willUnlinkSymlinks: InstalledSkill[];
}

/** @deprecated since v1.20.3 — no callers anywhere in the repo; removal target: next minor (post-1.0 convention: one deprecation cycle). */
export function previewDeleteUnregistered(
  registryRoot: string,
  name: string,
): DeletePreview {
  const installed = listInstalled(registryRoot);
  const mine = installed.filter((i) => i.name === name);
  return {
    willRemoveDirs: mine.filter((i) => i.kind === "real-directory"),
    willUnlinkSymlinks: mine.filter((i) => i.kind !== "real-directory"),
  };
}

function summarize(
  name: string,
  dirs: string[],
  links: string[],
  errors: DeleteUnregisteredResult["errors"],
): string {
  const parts: string[] = [];
  if (dirs.length > 0)
    parts.push(`${dirs.length} folder${dirs.length === 1 ? "" : "s"} deleted`);
  if (links.length > 0)
    parts.push(
      `${links.length} symlink${links.length === 1 ? "" : "s"} removed`,
    );
  if (errors.length > 0)
    parts.push(`${errors.length} error${errors.length === 1 ? "" : "s"}`);
  return parts.length > 0
    ? `${name}: ${parts.join(", ")}`
    : `${name}: nothing to delete`;
}
