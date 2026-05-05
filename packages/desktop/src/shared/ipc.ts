import type {
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
} as const;

export interface SkillsBankAPI {
  listRegistry(): Promise<RegistryEntry[]>;
  listInstalled(): Promise<InstalledSkill[]>;
  install(name: string, force?: boolean): Promise<{ ok: boolean; message: string }>;
  uninstall(name: string): Promise<{ ok: boolean; message: string }>;
  scan(): Promise<ScanReport>;
  migrate(
    items: Array<{ name: string; action: MigrationAction }>,
  ): Promise<MigrationResult[]>;
  getRoot(): Promise<string>;
  rebuildIndex(): Promise<{ ok: boolean; message: string; entries: number }>;
}

declare global {
  interface Window {
    skillsBank: SkillsBankAPI;
  }
}
