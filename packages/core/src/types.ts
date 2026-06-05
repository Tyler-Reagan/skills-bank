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
   * Origin marker for this skill. Read from a sibling .skills-bank.json
   * inside the skill folder; absent means user-authored.
   */
  source: import("./source.js").SkillSource;
  /**
   * Taxonomy axis: true when the skill's files physically live under
   * `<registryRoot>/skills/<bucket>/<name>/`. False when the registry
   * entry tracks an external location (the symlink-mode register path).
   * Defaults to true for entries built from the bucket subtree —
   * those are de facto adopted. M3 generalizes the non-adopted case.
   */
  adopted?: boolean;
  /**
   * Spatial categorization. `personal` for skills authored in this
   * repo (self-referential upstream or `kind: "none"`); `vendored`
   * for harvested skills with external upstream. Derived from the
   * folder's location under `<registryRoot>/skills/{personal,vendored}/`
   * — purely a path-level concept, never stored in markers.
   *
   * Absent on external (non-adopted) entries, since those don't live
   * under the bucket subtree.
   */
  bucket?: import("./registry.js").SkillBucket;
  /**
   * Internal-only taxonomy axis: true when this skill's name appears
   * in the active linked registry's upstream bundled snapshot — local
   * mode reads from a persisted bundled-name set, GitHub-linked mode
   * derives from publishState === "pushed". Used purely to gate
   * destructive-action protection (no UI surface). The user-facing
   * provenance signal is `source` (`bundled` / `yours`).
   */
  canon?: boolean;
  /**
   * User has dismissed this bundled skill from default views. Only
   * meaningful when `canon === true` — dismissing non-bundled skills
   * is nonsensical (just unregister them). Dismissed skills retain
   * installations and metadata; this is a UI dormancy flag, not an
   * uninstall.
   */
  hidden?: boolean;
  /**
   * Heal axis: the skill is registered but its files are missing on
   * disk. Set when the prior persisted index had this name but
   * `<registryRoot>/skills/<name>/` is gone (adopted case) or when
   * the external entry's target path is gone. The classifier emits
   * `registry-folder-missing` / `external-target-missing` based on
   * the entry's `adopted` flag.
   */
  missing?: boolean;
  /**
   * Heal axis: the local content has drifted from the recorded
   * baseline hash. Set when `source: "curated"` (existing bundled-
   * sync drift) or when the skill carries an `upstream` pointer
   * (post-scanner drift). The classifier emits
   * `edited-without-origin` for the bundled case and
   * `edited-with-origin` for the upstream case.
   */
  drift?: boolean;
  /**
   * Heal axis: the linked upstream has a newer content hash than
   * what was recorded at last fetch. Set by the desktop runner's
   * probe pass (plan 03, PR 2) for skills with an `upstream` pointer.
   * The classifier emits `origin-update-available` when true and
   * `drift` is false; if both are true, `edited-with-origin`
   * takes priority (the Update heal flow surfaces the upstream
   * change inside the conflict-aware path).
   */
  originUpdateAvailable?: boolean;
  /**
   * Heal axis: this skill's origin probe has failed
   * `ORIGIN_UNREACHABLE_THRESHOLD` consecutive times — see
   * `skill-state.ts`. Set in `buildRegistryIndex` from the runtime
   * sidecar's `probeFailureCount`. The classifier emits
   * `origin-unreachable` when true and the skill has a GitHub origin.
   * Lower priority than drift (drift implies reachable-recently);
   * higher than `originUpdateAvailable`. v1.4.
   */
  originUnreachable?: boolean;
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
  /**
   * Stable id of the agent dir this entry was discovered in. For
   * scans that landed in a user-defined custom directory rather than a
   * known agent dir, this falls back to `"agents"` and `customDir` is
   * set; consumers that distinguish the two should check `customDir`
   * first.
   */
  agent: import("./agents.js").AgentId;
  /**
   * When set, the entry was discovered inside this user-defined custom
   * skills directory rather than one of the known agent dirs.
   * Absolute path to the parent directory (not to the skill itself).
   */
  customDir?: string;
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
  /** When ok=false because of unregistered entries, list them. */
  blockingEntries?: string[];
}

/**
 * Optional disambiguator for actions that act on a specific scan entry
 * when the same skill name exists in multiple agent dirs. Without this,
 * the bulk-register handler had to dedupe by name and pick a single
 * representative — which masked entries (e.g. a real-directory in
 * `~/.agents/skills/` got eaten by a broken-symlink with the same name
 * in `~/.cursor/skills/`). When set, the handler looks up the exact
 * entry; when omitted, it falls back to the kindRank-based dedup.
 */
export interface ActionTarget {
  agent?: import("./agents.js").AgentId;
  customDir?: string;
}

export type RegistrationAction =
  | ({ type: "skip"; name: string } & ActionTarget)
  | ({ type: "remove"; name: string } & ActionTarget)
  | ({
      type: "register";
      name: string;
      /**
       * True ⇒ move files into `<registryRoot>/skills/<name>` (the
       * Adopted=true axis). False ⇒ record the external path and leave
       * files in place (Adopted=false). The renderer derives this from
       * `settings.registerAdopts`; M3 collapsed the prior `adopt` and
       * `register-external` action variants into this single shape.
       */
      adopt: boolean;
      /**
       * Optional post-adoption fan-out. When provided AND `adopt` is
       * true, applyRegistration reconciles agent links after the adopt
       * sweep so the registered skill ends up linked into exactly this
       * agent set. The same shape consumed by `installSkill` — this is
       * what makes Register the inverse of Install (install creates
       * links from a registry entry; register adopts a stray install
       * then mirrors the same link set). Undefined preserves the
       * legacy behavior of only repointing pre-existing links.
       */
      agents?: import("./agents.js").AgentId[];
    } & ActionTarget)
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
