import type {
  ConflictEntry,
  ExportInfo,
  ExportResult,
  FinalizeResult,
  InstalledSkill,
  MigrationAction,
  MigrationResult,
  RegistryEntry,
  ScanReport,
  SyncDecisions,
  SyncReport,
} from "@skills-bank/core";

export const IPC = {
  listRegistry: "skills:listRegistry",
  listInstalled: "skills:listInstalled",
  install: "skills:install",
  uninstall: "skills:uninstall",
  scan: "skills:scan",
  migrate: "skills:migrate",
  getRoot: "skills:getRoot",
  rebuildIndex: "skills:rebuildIndex",
  finalize: "skills:finalize",
  exportInfo: "skills:exportInfo",
  exportSkill: "skills:export",
  readSkillMd: "skills:readSkillMd",
  openInFinder: "skills:openInFinder",
  editTags: "skills:editTags",
  getConfig: "skills:getConfig",
  setRegistryRoot: "skills:setRegistryRoot",
  checkForUpdates: "app:checkForUpdates",
  quitAndInstallUpdate: "app:quitAndInstallUpdate",
  updateStatus: "app:updateStatus",
  syncCanonical: "registry:syncCanonical",
  getSyncReport: "registry:getSyncReport",
  syncStatus: "registry:syncStatus",
  getPendingConflicts: "registry:getPendingConflicts",
  resolveConflicts: "registry:resolveConflicts",
} as const;

export type SyncStatus =
  | { kind: "idle" }
  | { kind: "fetching" }
  | { kind: "applying" }
  | {
      kind: "done";
      upserted: number;
      conflicts: number;
      orphaned: number;
      commitSha: string;
    }
  | { kind: "error"; message: string };

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; version: string }
  | { kind: "not-available"; currentVersion: string }
  | { kind: "downloading"; percent: number }
  | { kind: "downloaded"; version: string }
  | { kind: "error"; message: string }
  | { kind: "disabled"; reason: string };

interface SkillsBankAPI {
  listRegistry(): Promise<RegistryEntry[]>;
  listInstalled(): Promise<InstalledSkill[]>;
  install(
    name: string,
    force?: boolean,
  ): Promise<{ ok: boolean; message: string }>;
  uninstall(name: string): Promise<{ ok: boolean; message: string }>;
  scan(): Promise<ScanReport>;
  migrate(
    items: Array<{ name: string; action: MigrationAction }>,
  ): Promise<MigrationResult[]>;
  getRoot(): Promise<string>;
  rebuildIndex(): Promise<{ ok: boolean; message: string; entries: number }>;
  finalize(): Promise<FinalizeResult>;
  exportInfo(name: string): Promise<ExportInfo>;
  exportSkill(
    name: string,
  ): Promise<{ ok: boolean; message: string; result?: ExportResult }>;
  readSkillMd(name: string): Promise<string | null>;
  openInFinder(absolutePath: string): Promise<void>;
  editTags(
    name: string,
    tags: string[],
  ): Promise<{ ok: boolean; message: string }>;
  getConfig(): Promise<{
    registryRoot: string | null;
    configValid: boolean;
    isPackaged: boolean;
  }>;
  setRegistryRoot(): Promise<{
    ok: boolean;
    message: string;
    registryRoot: string | null;
  }>;
  checkForUpdates(): Promise<{ ok: boolean; message: string }>;
  quitAndInstallUpdate(): Promise<void>;
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void;
  syncCanonical(): Promise<{ ok: boolean; message: string }>;
  getSyncReport(): Promise<SyncReport | null>;
  onSyncStatus(cb: (status: SyncStatus) => void): () => void;
  getPendingConflicts(): Promise<{
    syncedAt: string;
    commitSha: string;
    conflicts: ConflictEntry[];
  } | null>;
  resolveConflicts(
    decisions: SyncDecisions,
  ): Promise<{ ok: boolean; message: string }>;
}

declare global {
  interface Window {
    skillsBank: SkillsBankAPI;
  }
}
