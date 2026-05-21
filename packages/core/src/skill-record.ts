import {
  readSkillSource,
  writeSkillSource,
  type SkillSource,
} from "./source.js";
import {
  readSyncedHash,
  writeSyncedHash,
  readRuntimeState,
  writeRuntimeState,
  type RuntimeState,
} from "./heal.js";

/**
 * v0.11.9 M1: unified Skill record API.
 *
 * The three on-disk sidecars (`.skills-bank.json`, `.skills-bank-hash`,
 * `.skills-bank-runtime.json` — see ADR-0002) keep their per-axis
 * homes in `source.ts` and `heal.ts` so each constant and helper
 * stays adjacent to its sidecar logic. This module is the
 * consolidated surface consumers reach for when they want a
 * unified read or write.
 *
 * Most call sites today still need only ONE axis at a time
 * (build.ts wants source + fetchedAt; sync.ts writes source + hash).
 * Importing through this module gives them a single point of
 * vocabulary and a clear migration target if/when a future refactor
 * collapses the sidecars themselves — at that point only this file
 * changes.
 */

/** Per-skill state as it lives on disk. Composed from three sidecars. */
export interface SkillRecord {
  /** `.skills-bank.json` — committed marker (source axis + upstream pointer). */
  source: SkillSource;
  /** `.skills-bank-hash` — gitignored content-baseline hash, or null when never synced. */
  syncedHash: string | null;
  /** `.skills-bank-runtime.json` — gitignored runtime state (fetchedAt etc.). */
  runtime: RuntimeState;
}

/** Single-shot read of all three sidecars for a skill. */
export function readSkillRecord(skillDir: string): SkillRecord {
  return {
    source: readSkillSource(skillDir),
    syncedHash: readSyncedHash(skillDir),
    runtime: readRuntimeState(skillDir),
  };
}

/**
 * Single-shot write — useful for migration tooling and tests that
 * want to materialize an entire SkillRecord at once. Most production
 * call sites still write a single axis via the lower-level helpers,
 * which makes the intent clearer (e.g. "I'm only updating the
 * runtime sidecar" reads better than "I'm writing the whole record
 * but only changed runtime").
 */
export function writeSkillRecord(skillDir: string, record: SkillRecord): void {
  writeSkillSource(skillDir, record.source);
  if (record.syncedHash !== null) {
    writeSyncedHash(skillDir, record.syncedHash);
  }
  writeRuntimeState(skillDir, record.runtime);
}

// Re-export the per-axis helpers under this module's namespace so
// callers that have a single concern can import from here without
// having to reach into the per-sidecar modules.
export {
  readSkillSource,
  writeSkillSource,
  readSyncedHash,
  writeSyncedHash,
  readRuntimeState,
  writeRuntimeState,
};
export type { SkillSource, RuntimeState };
