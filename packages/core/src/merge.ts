import fs from "node:fs";
import path from "node:path";
import { invalidateCanonCache } from "./canon.js";
import { hashSkillFolder, writeSyncedHash } from "./heal.js";
import {
  readSkillSource,
  writeSkillSource,
  type SkillSource,
} from "./source.js";
import type { ConflictEntry, SyncDecisions } from "./sync.js";

/**
 * Result of a merge-import. Mirrors SyncReport's shape so callers can
 * surface progress / conflicts using the same UI (ConflictResolutionModal).
 */
export interface MergeImportReport {
  /** Skill names successfully copied into the active registry. */
  imported: string[];
  /** Name collisions queued for the user. Empty when fully resolved. */
  conflicts: ConflictEntry[];
  /**
   * Names skipped because the user chose keep-mine; included so the
   * caller can surface "5 imported, 3 kept yours."
   */
  keptMine: string[];
  /** Names whose local version was renamed `<name>-local-…`. */
  renamed: { name: string; renamedTo: string }[];
}

function resolveRenameTarget(skillsDir: string, name: string): string {
  const base = `${name}-local`;
  if (!fs.existsSync(path.join(skillsDir, base))) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!fs.existsSync(path.join(skillsDir, candidate))) return candidate;
  }
  throw new Error(`no available rename target for ${name}`);
}

/**
 * M8: merge skills from `sourceRoot/skills/` into the active
 * registry. Adds non-colliding names, queues collisions for user
 * decision. Distinct from sync: this is user-initiated, additive,
 * and the imported skills are marked `source: imported` rather than
 * `canonical` — they don't become canon under the active linked
 * registry.
 *
 * Decision shape reuses SyncDecisions so the renderer can route
 * collisions through the existing ConflictResolutionModal. Default
 * (no decisions) returns the collisions in the report; a second call
 * with decisions resolves them.
 */
export function mergeImportRegistry(
  activeRegistryRoot: string,
  sourceRoot: string,
  decisions: SyncDecisions = {},
): MergeImportReport {
  const sourceSkillsDir = path.join(sourceRoot, "skills");
  if (!fs.existsSync(sourceSkillsDir)) {
    throw new Error(`source has no skills/ directory: ${sourceSkillsDir}`);
  }
  const localSkillsDir = path.join(activeRegistryRoot, "skills");
  fs.mkdirSync(localSkillsDir, { recursive: true });

  const imported: string[] = [];
  const conflicts: ConflictEntry[] = [];
  const keptMine: string[] = [];
  const renamed: { name: string; renamedTo: string }[] = [];
  const importedAt = new Date().toISOString();

  for (const ent of fs.readdirSync(sourceSkillsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const name = ent.name;
    const sourcePath = path.join(sourceSkillsDir, name);
    const localPath = path.join(localSkillsDir, name);

    if (!fs.existsSync(localPath)) {
      // No collision: copy in, mark imported.
      fs.cpSync(sourcePath, localPath, { recursive: true });
      writeSkillSource(localPath, {
        source: "imported",
        syncedAt: importedAt,
      });
      const h = hashSkillFolder(localPath);
      if (h) writeSyncedHash(localPath, h);
      imported.push(name);
      continue;
    }

    // Collision. Apply the user's decision or queue.
    const decision = decisions[name];
    if (!decision) {
      const localSource: SkillSource = readSkillSource(localPath);
      conflicts.push({ name, localSource, canonicalPath: sourcePath });
      continue;
    }
    if (decision.action === "keep-mine") {
      keptMine.push(name);
      continue;
    }
    if (decision.action === "rename-mine") {
      const target = resolveRenameTarget(localSkillsDir, name);
      fs.renameSync(localPath, path.join(localSkillsDir, target));
      renamed.push({ name, renamedTo: target });
      fs.cpSync(sourcePath, localPath, { recursive: true });
      writeSkillSource(localPath, {
        source: "imported",
        syncedAt: importedAt,
      });
      const h = hashSkillFolder(localPath);
      if (h) writeSyncedHash(localPath, h);
      imported.push(name);
      continue;
    }
    if (decision.action === "use-canonical") {
      fs.rmSync(localPath, { recursive: true, force: true });
      fs.cpSync(sourcePath, localPath, { recursive: true });
      writeSkillSource(localPath, {
        source: "imported",
        syncedAt: importedAt,
      });
      const h = hashSkillFolder(localPath);
      if (h) writeSyncedHash(localPath, h);
      imported.push(name);
    }
  }

  // Canon set may shift if imported names happen to be canon under
  // the active registry's upstream. Drop the cache so the next index
  // build re-evaluates.
  invalidateCanonCache(activeRegistryRoot);

  return { imported, conflicts, keptMine, renamed };
}
