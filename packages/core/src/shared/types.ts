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
   * Provenance — the single nullable-URL origin (ADR-0018/0020),
   * carried verbatim from the manifest row. `url: null` is a valid
   * resting state ("local skill, no remote").
   */
  origin: import("../manifest/manifest.js").ManifestOrigin;
  /**
   * Spatial categorization. `personal` for skills authored in this
   * repo (self-referential upstream or `kind: "none"`); `vendored`
   * for harvested skills with external upstream. Derived from the
   * folder's location under `<registryRoot>/skills/{personal,vendored}/`
   * — purely a path-level concept, never stored in markers.
   */
  bucket?: import("../registry/walk.js").SkillBucket;
  /**
   * Heal axis: the skill is registered but its files are missing on
   * disk. Set when the prior persisted index had this name but
   * `<registryRoot>/skills/<name>/` is gone. The classifier emits
   * `registry-folder-missing`.
   */
  missing?: boolean;
  /**
   * Heal axis: the local content has drifted from the recorded
   * baseline hash (the runtime map's `syncedHash`). The classifier
   * emits `edited-with-origin` when `origin.url` is set and
   * `edited-without-origin` otherwise.
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
   * Stable id of the agent dir this entry was discovered in.
   */
  agent: import("./agents.js").AgentId;
  /** Absolute path of `<agent-dir>/<name>` itself. */
  linkPath: string;
  /** Absolute resolved target if it's a symlink, else null. */
  target: string | null;
  kind: InstalledKind;
  /** Set when `kind === "ours"` or when target lives in our skills/ dir. */
  registryEntry?: RegistryEntry;
}

export interface ScanReport {
  /** Map from AgentId → absolute skills dir path that was scanned. */
  agentDirs: Record<string, string>;
  /** Kept for backward-compat with renderer code that displayed it. */
  claudeSkillsDir: string;
  registryRoot: string;
  entries: InstalledSkill[];
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
}

export type RegistrationAction =
  | ({ type: "skip"; name: string } & ActionTarget)
  | ({ type: "remove"; name: string } & ActionTarget)
  | ({
      type: "register";
      name: string;
      /**
       * Register moves the skill's files into `<registryRoot>/skills/`
       * and records a manifest row (ADR-0022 — Registered ⇔ files live
       * under the bank). Optional post-move fan-out: when provided,
       * applyRegistration reconciles agent links so the skill ends up
       * linked into exactly this agent set; undefined only repoints
       * pre-existing links.
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
