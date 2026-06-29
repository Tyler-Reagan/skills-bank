import { readSkillSource, writeSkillSource } from "./source.js";
import {
  readSyncedHash,
  writeSyncedHash,
  readRuntimeState,
  writeRuntimeState,
} from "./heal.js";
import type { SkillSource } from "./source.js";
import type { RuntimeState } from "./heal.js";

export interface SkillRecord {
  source: SkillSource;
  syncedHash: string | null;
  runtime: RuntimeState;
}

export function readSkillRecord(skillDir: string): SkillRecord {
  return {
    source: readSkillSource(skillDir),
    syncedHash: readSyncedHash(skillDir),
    runtime: readRuntimeState(skillDir),
  };
}

export function writeSkillRecord(
  skillDir: string,
  update: Partial<SkillRecord>,
): void {
  if (update.source !== undefined) writeSkillSource(skillDir, update.source);
  if (update.syncedHash !== undefined && update.syncedHash !== null) {
    writeSyncedHash(skillDir, update.syncedHash);
  }
  if (update.runtime !== undefined) writeRuntimeState(skillDir, update.runtime);
}
