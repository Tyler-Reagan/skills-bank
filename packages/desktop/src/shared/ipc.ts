import type {
  ExportInfo,
  ExportResult,
  FinalizeResult,
  InstalledSkill,
  MigrationAction,
  MigrationResult,
  RegistryEntry,
  ScanReport,
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
} as const;

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
}

declare global {
  interface Window {
    skillsBank: SkillsBankAPI;
  }
}
