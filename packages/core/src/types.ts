export interface SkillMeta {
  name: string;
  description: string;
  domain?: string;
  tags?: string[];
  version?: string;
  author?: string;
}

export interface RegistryEntry extends SkillMeta {
  /** Path relative to registry root, e.g. "skills/meta/hello". */
  path: string;
  category: string;
  lastCommit?: { sha: string; date: string; message: string };
}

export interface RegistryIndex {
  generatedAt: string;
  registry?: string;
  entries: RegistryEntry[];
}

export type InstalledKind =
  | "ours"
  | "foreign-symlink"
  | "real-directory"
  | "broken-symlink";

export interface InstalledSkill {
  name: string;
  /** Absolute path of `~/.claude/skills/<name>` itself. */
  linkPath: string;
  /** Absolute resolved target if it's a symlink, else null. */
  target: string | null;
  kind: InstalledKind;
  /** Set when `kind === "ours"` or when target lives in our skills/ dir. */
  registryEntry?: RegistryEntry;
}

export interface ScanReport {
  claudeSkillsDir: string;
  registryRoot: string;
  entries: InstalledSkill[];
}

export type MigrationAction =
  | { type: "skip"; name: string }
  | { type: "remove"; name: string }
  | { type: "adopt"; name: string; category: string }
  | { type: "register-external"; name: string };

export interface MigrationResult {
  action: MigrationAction;
  ok: boolean;
  message: string;
}
