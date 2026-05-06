export interface SkillMeta {
  name: string;
  description: string;
  tags?: string[];
  version?: string;
  author?: string;
}

export interface RegistryEntry extends SkillMeta {
  /** Path relative to registry root, e.g. "skills/hello". */
  path: string;
  lastCommit?: { sha: string; date: string; message: string };
  /**
   * Non-fatal issues found while building this entry — for example a
   * meta.json that fails schema validation or a folder that only has
   * SKILL.md. Surface in the UI so users can fix metadata without
   * having the entry silently disappear.
   */
  warnings?: string[];
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

export interface TopLevelSymlinkInfo {
  /** Absolute path the ~/.claude/skills symlink resolves to. */
  resolvedTarget: string;
  /** Whether the resolved target exists and is a directory. */
  exists: boolean;
}

export interface ScanReport {
  claudeSkillsDir: string;
  registryRoot: string;
  entries: InstalledSkill[];
  /**
   * Set when the ~/.claude/skills path is itself a symlink to another
   * directory (e.g. ~/.agents/skills). Surfaces the "double-hop" case so
   * the UI can offer to finalize the directory structure.
   */
  topLevelSymlink: TopLevelSymlinkInfo | null;
}

export interface FinalizeResult {
  ok: boolean;
  message: string;
  /** When ok=true, the path the original symlink was renamed to. */
  backupPath?: string;
  /** When ok=false because of unmigrated entries, list them. */
  blockingEntries?: string[];
}

export type MigrationAction =
  | { type: "skip"; name: string }
  | { type: "remove"; name: string }
  | { type: "adopt"; name: string }
  | { type: "register-external"; name: string };

export interface MigrationResult {
  action: MigrationAction;
  ok: boolean;
  message: string;
}
