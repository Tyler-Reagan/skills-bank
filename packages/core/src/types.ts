export interface SkillMeta {
  name: string;
  description: string;
  tags?: string[];
  version?: string;
  author?: string;
}

/**
 * Publish state of a registry skill, derived from git: whether the
 * canonical commit touching the skill folder is reachable from the
 * upstream remote. Drives the "is this a clean published skill or a
 * local-only edit?" badge on cards. Only meaningful when computed
 * inside a git working tree.
 */
export type PublishState = "pushed" | "draft" | "untracked" | "unknown";

export interface RegistryEntry extends SkillMeta {
  /** Path relative to registry root, e.g. "skills/hello". */
  path: string;
  lastCommit?: { sha: string; date: string; message: string };
  /**
   * Origin marker for this skill. Read from a sibling .skills-bank.json
   * inside the skill folder; absent means user-authored.
   */
  source: import("./source.js").SkillSource;
  /**
   * Whether the skill's latest commit is reachable from the upstream
   * remote. Populated by buildRegistryIndex when includeGitInfo is true
   * (already the CI/CLI default). "unknown" when the registry isn't a
   * git working tree.
   */
  publishState?: PublishState;
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
  /** Stable id of the agent dir this entry was discovered in. */
  agent: import("./agents.js").AgentId;
  /** Absolute path of `<agent-dir>/<name>` itself. */
  linkPath: string;
  /** Absolute resolved target if it's a symlink, else null. */
  target: string | null;
  kind: InstalledKind;
  /** Set when `kind === "ours"` or when target lives in our skills/ dir. */
  registryEntry?: RegistryEntry;
}

export interface TopLevelSymlinkInfo {
  /** The agent whose top-level skills dir is itself a symlink. */
  agent: import("./agents.js").AgentId;
  /** Absolute path the agent's skills dir symlink resolves to. */
  resolvedTarget: string;
  /** Whether the resolved target exists and is a directory. */
  exists: boolean;
}

export interface ScanReport {
  /** Map from AgentId → absolute skills dir path that was scanned. */
  agentDirs: Record<string, string>;
  /** Kept for backward-compat with renderer code that displayed it. */
  claudeSkillsDir: string;
  registryRoot: string;
  entries: InstalledSkill[];
  /**
   * One per agent whose top-level skills dir is itself a symlink to
   * another directory (e.g. ~/.claude/skills → ~/.agents/skills). The
   * UI can offer to finalize each independently.
   */
  topLevelSymlinks: TopLevelSymlinkInfo[];
}

export interface FinalizeResult {
  ok: boolean;
  message: string;
  /** When ok=true, the path the original symlink was renamed to. */
  backupPath?: string;
  /** When ok=false because of unmigrated entries, list them. */
  blockingEntries?: string[];
}

export type RegistrationAction =
  | { type: "skip"; name: string }
  | { type: "remove"; name: string }
  | { type: "adopt"; name: string }
  | { type: "register-external"; name: string }
  | {
      type: "setAgents";
      name: string;
      /**
       * Desired agent links. Symlinks are added for entries in this list
       * that don't currently have one and removed for entries currently
       * present but absent from this list. Real-directory entries are
       * never removed (the actual content lives there).
       */
      agents: import("./agents.js").AgentId[];
    };

export interface RegistrationResult {
  action: RegistrationAction;
  ok: boolean;
  message: string;
}
