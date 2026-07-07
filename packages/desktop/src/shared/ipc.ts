import type {
  AgentId,
  AppError,
  BrokenLinkRemoveReport,
  BrokenLinkRepairReport,
  ConflictResolveDecision,
  ConflictResolveReport,
  DiagnosticReport,
  ExportInfo,
  ExportResult,
  FinalizeResult,
  ImportRegistryManifestResult,
  ImportSkillOutcome,
  InstalledSkill,
  InvocationStats,
  LabelsMap,
  ManifestConflict,
  ManifestDecisions,
  ManifestDiff,
  ManifestImportProgressEvent,
  ManifestSkill,
  PendingManifestConflicts,
  RateLimitInfo,
  RegistrationAction,
  RegistrationResult,
  RegistryEntry,
  RegistryManifest,
  ScanReport,
  SkillLabelOverride,
  TrackingCoverage,
} from "@skills-bank/core";

/**
 * Common shape for any IPC result that may carry a structured error.
 * Every renderer-facing IPC handler in `main.ts` now returns this
 * shape on failure; success returns vary per-handler but include the
 * same `ok: true` top-level marker.
 */
interface IPCFailureFields {
  /**
   * Stable one-line summary. Kept for back-compat with the legacy
   * toast surface and used as the ErrorPanel header text.
   */
  message: string;
  /** Structured top-level error. Always populated when `ok=false`. */
  error?: AppError;
  /** Per-row structured errors for batch operations. */
  errors?: AppError[];
}

export const IPC = {
  listRegistry: "skills:listRegistry",
  listInstalled: "skills:listInstalled",
  install: "skills:install",
  uninstall: "skills:uninstall",
  scan: "skills:scan",
  register: "skills:register",
  getRoot: "skills:getRoot",
  rebuildIndex: "skills:rebuildIndex",
  finalize: "skills:finalize",
  listTopLevelSymlinks: "agents:listTopLevelSymlinks",
  exportInfo: "skills:exportInfo",
  exportSkill: "skills:export",
  readSkillMd: "skills:readSkillMd",
  openInFinder: "skills:openInFinder",
  getConfig: "skills:getConfig",
  setRegistryRoot: "skills:setRegistryRoot",
  checkForUpdates: "app:checkForUpdates",
  downloadUpdate: "app:downloadUpdate",
  quitAndInstallUpdate: "app:quitAndInstallUpdate",
  updateStatus: "app:updateStatus",
  setDismissedUpdateVersion: "app:setDismissedUpdateVersion",
  dismissWeakStorageNotice: "app:dismissWeakStorageNotice",
  authStatus: "auth:status",
  authIsConfigured: "auth:isConfigured",
  authSetRegistrySourceLocal: "auth:setRegistrySourceLocal",
  authStartDeviceFlow: "auth:startDeviceFlow",
  authPollDeviceFlow: "auth:pollDeviceFlow",
  authCancelDeviceFlow: "auth:cancelDeviceFlow",
  authResumeDeviceFlow: "auth:resumeDeviceFlow",
  authLogout: "auth:logout",
  reposListMine: "repos:listMine",
  reposReplaceRegistry: "repos:replaceRegistry",
  reposRefreshCurrent: "repos:refreshCurrent",
  openExternal: "system:openExternal",
  openSelfHostDocs: "system:openSelfHostDocs",
  exportManifest: "bank:exportManifest",
  importManifest: "bank:importManifest",
  importManifestCancel: "bank:importManifestCancel",
  manifestImportProgress: "bank:manifestImportProgress",
  previewManifestPush: "bank:previewManifestPush",
  pushManifestToRepo: "bank:pushManifestToRepo",
  readManifestFromRepo: "bank:readManifestFromRepo",
  manifestImportRetrySkill: "bank:manifestImportRetrySkill",
  runManifestMerge: "bank:runManifestMerge",
  getPendingManifestConflicts: "bank:getPendingManifestConflicts",
  clearPendingManifestConflicts: "bank:clearPendingManifestConflicts",
  resolveManifestConflicts: "bank:resolveManifestConflicts",
  installFromManifestHint: "bank:installFromManifestHint",
  addFromGithub: "bank:addFromGithub",
  repairBrokenLinks: "skills:repairBrokenLinks",
  removeBrokenLinks: "skills:removeBrokenLinks",
  localDiagnosticsScan: "diagnostics:scan",
  resolveSkillConflicts: "skills:resolveSkillConflicts",
  unregister: "skills:unregister",
  deleteUnregistered: "skills:deleteUnregistered",
  forgetMissing: "skills:forgetMissing",
  repointExternal: "skills:repointExternal",
  repointOrigin: "skills:repointOrigin",
  detachLocal: "skills:detachLocal",
  rehomeIntoLinkedRepo: "skills:rehomeIntoLinkedRepo",
  discoverShow: "discover:show",
  discoverHide: "discover:hide",
  discoverHideSync: "discover:hideSync",
  discoverSetBounds: "discover:setBounds",
  discoverGoBack: "discover:goBack",
  discoverReload: "discover:reload",
  discoverOpenExternal: "discover:openExternal",
  discoverOpenTerminal: "discover:openTerminal",
  discoverStatus: "discover:status",
  headerMenuAction: "header:action",
  pickCustomSkillsDir: "skills:pickCustomSkillsDir",
  getSkillDiff: "skills:getSkillDiff",
  originProbe: "origin:probe",
  originUpdate: "origin:update",
  originRepoMetadata: "origin:repoMetadata",
  originLastCommit: "origin:lastCommit",
  originSetManual: "origin:setManual",
  readLabels: "labels:read",
  updateLabel: "labels:update",
  resetLabel: "labels:reset",
  bulkUpdateLabels: "labels:bulkUpdate",
  getInvocationStats: "metrics:getInvocationStats",
  getSkillTrackingStatus: "metrics:getTrackingStatus",
  setSkillTrackingEnabled: "metrics:setTrackingEnabled",
} as const;

/**
 * Renderer → main payload for `upstream:setManual`. Either:
 * - Stamp a GitHub upstream (`url` + `repo` + `skillPath`). Validated
 *   against `GET /repos/{repo}/contents/{folder}` before writing —
 *   invalid combos return an error and don't mutate.
 * - Mark explicitly user-owned (`url: null`) — the manifest row's
 *   `origin.url` is set to `null` (ADR-0018 no-vacuum; ADR-0020).
 */
export type OriginManualChoice =
  | { url: string; repo: string; skillPath: string }
  | { url: null };

/**
 * Response for `upstream:update`. Carries structured rate-limit info
 * on 429 so the renderer can render a tailored, sticky error toast
 * with a "Sign in" affordance, instead of a generic transient flash.
 *
 * `rateLimit` mirrors core's `RateLimitInfo` shape. Inlined here so
 * the IPC surface doesn't depend on a separately-exported name.
 */
export interface OriginUpdateResult {
  ok: boolean;
  message: string;
  /** Populated only on rate-limit failures. */
  rateLimit?: {
    limit: number;
    remaining: number;
    resetAt: string;
    unauthenticated: boolean;
  };
  /** Populated only on failure when not a rate-limit. Free-form
   *  diagnostic payload the user can copy into an external agent. */
  diagnostic?: string;
  error?: unknown;
}

/** Result of adopting a skill into the linked repo via a PR (ADR-0012). */
interface AdoptIntoLinkedRepoIPCResult {
  ok: boolean;
  message: string;
  /** Populated on success. */
  prNumber?: number;
  htmlUrl?: string;
  rateLimit?: {
    limit: number;
    remaining: number;
    resetAt: string;
    unauthenticated: boolean;
  };
  error?: unknown;
}

/**
 * Payload broadcast on the `upstream:probe` channel when the probe
 * runner finishes a pass. Always sent — when the pass had no
 * surfaceable issues the fields are undefined and the renderer
 * treats the event as a pure "refresh the registry" nudge.
 *
 * `rateLimit` is set when at least one repo probe failed with a 429
 * — populated from the most recent such failure (they all carry the
 * same window state, so any one is representative). Triggers a
 * sticky error toast in the renderer with a Sign-in affordance for
 * unauthenticated hits.
 *
 * Other call sites that emit on this channel purely to nudge a
 * registry refresh (e.g. applyUpstreamUpdate success, upstreamSetManual
 * success) send an empty payload.
 */
export interface OriginProbeCompleteEvent {
  rateLimit?: {
    limit: number;
    remaining: number;
    resetAt: string;
    unauthenticated: boolean;
  };
  /** Repos whose probe failed for non-rate-limit reasons. Surfaced
   *  for diagnostics rather than as a user-facing alert. */
  failedRepos?: string[];
  /** Skills whose upstream hash moved past what was recorded — i.e.
   *  how many Update Available chips this probe will produce. Used
   *  by the Rescan button's "done" state copy. Undefined when the
   *  event is a non-probe refresh nudge. */
  updates?: number;
}

/**
 * Summary returned by `upstream:probe`. The renderer uses this to
 * surface progress in the UpdatesModal's manual-refresh control;
 * per-skill update state is surfaced via the augmented
 * `RegistryEntry.upstreamUpdateAvailable` field on `listRegistry`,
 * not through this payload.
 */
export interface OriginProbeResult {
  /** Number of unique source repos probed (after dedup). */
  probed: number;
  /** Number of skills found with a newer upstream hash than recorded. */
  updates: number;
  /** ISO-8601 timestamp of completion. */
  probedAt: string;
}

/**
 * Display-time enrichment for a skill's source repo. Fetched per-repo
 * by the renderer when an Origin section is visible; cached in main
 * process memory (15-min TTL). Errors collapse to null fields rather
 * than throwing — the drawer just omits the missing chips.
 */
export interface OriginRepoMetadata {
  stars: number | null;
  description: string | null;
  defaultBranch: string | null;
}

/**
 * Latest commit touching a specific path in a source repo. Fetched
 * per-skill when the Settings "Show upstream activity" toggle is on;
 * cached in main-process memory with a 15-min TTL. Nulls when the
 * fetch fails or the path has no commits in the default branch.
 */
export interface OriginLastCommit {
  sha: string | null;
  /** ISO-8601 commit author date. */
  date: string | null;
  /** First line of the commit message. */
  message: string | null;
}

interface SkillDiffFile {
  /** Relative path within the skill folder, e.g. "SKILL.md". */
  path: string;
  /** Lines present in right but not in left. */
  added: number;
  /** Lines present in left but not in right. */
  removed: number;
  /**
   * Unified-diff body without the surrounding header. Empty string
   * when both sides are byte-identical (file omitted from the result
   * in that case).
   */
  unifiedDiff: string;
  status: "modified" | "left-only" | "right-only" | "binary";
}

export interface SkillDiffResult {
  /** Human-readable label for the left side (e.g. "Yours"). */
  leftLabel: string;
  /** Human-readable label for the right side (e.g. "Bundled"). */
  rightLabel: string;
  files: SkillDiffFile[];
}

export interface SkillDiffRequest {
  leftPath: string;
  rightPath: string;
  leftLabel: string;
  rightLabel: string;
}

interface PickCustomSkillsDirResult {
  ok: boolean;
  /** Absolute path the user chose. Absent when ok=false. */
  path?: string;
  /** Human-readable reason. "canceled" when the user dismissed the picker. */
  message: string;
  /**
   * Non-fatal sanity flag — the chosen path looks like a system root,
   * the user's home dir, or otherwise unlikely to be a skills folder.
   * `ok` stays true; renderer surfaces this as a confirm-before-add
   * notice rather than a hard rejection. v0.11.8 M5 guardrail.
   */
  warning?: string;
}

/**
 * The canonical bundled-default repo. Every registry is linked to a
 * GitHub repo, and this one is the default — there is no separate
 * "local mode." A user is "on the bundled set" when `linkedRepo` is
 * either null (fresh install / migrated from the older local mode) or
 * equal to `BUNDLED_REPO`. Renderer code checks the `linkedRepo` field
 * on `AuthStatus` directly; no separate `mode()` helper, since every
 * relevant branch collapses to "do I have a non-bundled linkedRepo?"
 */
export const BUNDLED_REPO = "Tyler-Reagan/skills-bank";

/**
 * Legacy mode discriminator. Kept as a derived alias on `AuthStatus`
 * for one release as a migration safety net; new code should branch on
 * `linkedRepo` instead. Will be dropped in a follow-up release after
 * the migration has settled.
 *
 * Mapping today: `"github"` ⇒ `linkedRepo !== null`; `"local"` ⇒
 * `linkedRepo === null`; `null` is emitted only on fresh installs that
 * haven't completed onboarding (renderer routes to LoginScreen).
 */
export type RegistrySource = "local" | "github";

/**
 * Records which GitHub repo the user has linked, when it was last
 * fetched, and the commit SHA we synced from. Written by
 * `reposReplaceRegistry` on every successful fetch; surfaced in
 * AccountModal so users can see what they're tracking. Null when the
 * user is not in github-linked mode.
 */
export interface LinkedRepoMetadata {
  fullName: string;
  lastFetchedAt: string;
  syncedFromCommit: string;
  /** Populated from /repos API when available; absent in legacy persisted configs. */
  defaultBranch?: string;
}

export interface AuthStatus {
  registrySource: RegistrySource | null;
  isAuthConfigured: boolean;
  user: {
    login: string;
    avatarUrl: string;
    htmlUrl: string;
  } | null;
  linkedRepo: LinkedRepoMetadata | null;
}

export interface DeviceFlowStartPayload {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  flowId: string;
}

/**
 * Payload returned by `authResumeDeviceFlow` when an in-progress flow
 * was persisted (the previous app session quit mid-poll and the device
 * code hasn't expired yet). `expiresAt` is an absolute ms-epoch
 * timestamp; the renderer derives a remaining-seconds budget from it.
 */
export interface DeviceFlowResumePayload {
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
}

export interface UserRepo {
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
  description: string | null;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// State machine for the embedded skills.sh WebContentsView. The renderer
// only ever needs to render four shapes: pre-load (loading), success
// (ready, with current URL + nav state), transient error (offline /
// did-fail-load), and the in-flight reload after retry (loading again).
export type DiscoverStatus =
  | { kind: "idle" }
  | { kind: "loading"; url: string }
  | { kind: "ready"; url: string; canGoBack: boolean }
  | { kind: "error"; url: string; errorCode: number; description: string };

/**
 * Discriminated set of actions the macOS menubar dispatches via the
 * `headerMenuAction` IPC. The in-app header popup-menu retired with
 * the Account/Settings decomposition — only the menubar dispatch
 * path still uses this union.
 */
export type HeaderMenuAction =
  | "changeRegistry"
  | "mergeRegistry"
  | "openSettings"
  | "openShortcuts"
  | "signOut"
  | "refresh"
  | "sync"
  | "checkForUpdates";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | {
      kind: "available";
      version: string;
      releaseNotes: string | null;
      releaseName: string | null;
    }
  | { kind: "not-available"; currentVersion: string }
  | {
      kind: "downloading";
      percent: number;
      version: string;
      releaseNotes: string | null;
      releaseName: string | null;
    }
  | {
      kind: "downloaded";
      version: string;
      releaseNotes: string | null;
      releaseName: string | null;
    }
  | { kind: "error"; message: string }
  | { kind: "disabled"; reason: string };

interface InstallIPCResult extends IPCFailureFields {
  ok: boolean;
}

interface UninstallIPCResult extends IPCFailureFields {
  ok: boolean;
  /** Number of symlinks actually removed. */
  removedCount?: number;
  /** Number of agent dirs we deliberately left alone (real dirs). */
  keptCount?: number;
}

interface UnregisterIPCResult extends IPCFailureFields {
  ok: boolean;
  /** Where adopted files were moved to. Absent for non-adopted skills. */
  destinationPath?: string;
  /** True when the unregistered skill was previously adopted. */
  wasAdopted: boolean;
}

export type PreviewManifestPushResult =
  | {
      ok: true;
      diff: ManifestDiff;
      skillCount: number;
      repo: string;
      branch: string;
    }
  | { ok: false; message: string; rateLimit?: RateLimitInfo };

export type PushManifestToRepoResult =
  | {
      ok: true;
      commitSha: string;
      htmlUrl: string;
      prNumber?: number;
      skillCount: number;
      /**
       * Non-blocking advisory. Set on the PR path when the remote has
       * diverged from the merge base (finding F4): the PR still opens —
       * human review is the backstop — but the caller should warn that the
       * PR may not reflect the latest remote. Direct push hard-refuses on
       * divergence instead (reason: "diverged").
       */
      warning?: string;
    }
  | {
      ok: false;
      reason: "rate-limit";
      message: string;
      rateLimit: RateLimitInfo;
    }
  | {
      ok: false;
      reason: "diverged";
      message: string;
    }
  | { ok: false; reason: "write-failed"; message: string };

export type ReadManifestFromRepoResult =
  | { ok: true; manifest: RegistryManifest; diff: ManifestDiff }
  | { ok: false; reason: "not-found" }
  | {
      ok: false;
      reason: "rate-limit";
      message: string;
      rateLimit: RateLimitInfo;
    }
  | { ok: false; reason: "read-failed" | "parse-failed"; message: string };

/**
 * Result of a three-way pull-merge. `merged` — applied cleanly, no
 * conflicts. `conflicts` — divergence the user must resolve; the
 * conflicts are also persisted, and the renderer opens the resolver
 * modal. The merge base is advanced only on a clean merge (post-
 * resolution advances it for the conflict path).
 */
export type RunManifestMergeResult =
  | { ok: true; status: "merged"; message: string; removed: string[] }
  | { ok: true; status: "conflicts"; conflicts: ManifestConflict[] }
  | {
      ok: false;
      reason: "rate-limit";
      message: string;
      rateLimit: RateLimitInfo;
    }
  | { ok: false; reason: "read-failed" | "reconcile-failed"; message: string };

export type ResolveManifestConflictsResult =
  | {
      ok: true;
      message: string;
      /** Skills removed locally to propagate accepted remote deletions. */
      removed: string[];
      /** `keep-both` forks applied on disk (`<name>` → `<name>-local`). */
      renamed: { from: string; to: string }[];
    }
  | { ok: false; message: string; error?: AppError };

/**
 * Skill-usage tracking state, derived from the REAL `~/.claude/settings.json`
 * (single source of truth for enabled-state) plus the tracking-history ledger.
 * `state`: `on` = our hook entry + script both present; `needs-repair` = entry
 * present but the script went missing (re-enable rewrites it); `off` = no entry.
 */
export interface TrackingStatus {
  state: "off" | "on" | "needs-repair";
  /** On/off windows + gaps, for the "tracked since / gaps" indicator. */
  coverage: TrackingCoverage;
  settingsPath: string;
  scriptPath: string;
  logPath: string;
  /** True when settings.json exists but isn't valid JSON (toggle refuses to write). */
  settingsMalformed: boolean;
}

export type SetTrackingResult =
  | { ok: true; status: TrackingStatus }
  | {
      ok: false;
      reason: "malformed-settings" | "write-failed";
      message: string;
    };

interface SkillsBankAPI {
  listRegistry(): Promise<RegistryEntry[]>;
  /** Read + aggregate the skill-invocation log (per-skill counts, sessions). */
  getInvocationStats(): Promise<InvocationStats>;
  /** Current tracking state + coverage, derived from settings.json + ledger. */
  getSkillTrackingStatus(): Promise<TrackingStatus>;
  /**
   * Install (true) or remove (false) the PreToolUse(Skill) hook in the real
   * `~/.claude/settings.json`. Non-destructive merge; refuses on a malformed
   * settings.json rather than clobbering it. Returns the resulting status.
   */
  setSkillTrackingEnabled(enabled: boolean): Promise<SetTrackingResult>;
  /**
   * Scan agent dirs (and optionally user-defined custom dirs) for
   * installed skills. Custom dirs are absolute paths; non-existent
   * entries and entries that duplicate a known agent dir are skipped.
   */
  listInstalled(customDirs?: string[]): Promise<InstalledSkill[]>;
  /**
   * Open a directory picker so the user can choose a personal skills
   * folder to add to the Installed-tab scan list. Returns
   * `{ ok: false, message: "canceled" }` if the user dismissed the
   * picker. Persistence of the chosen path lives in the renderer's
   * AppSettings; this IPC only resolves the picker dialog.
   */
  pickCustomSkillsDir(): Promise<PickCustomSkillsDirResult>;
  /**
   * Compute a per-file unified diff between two on-disk skill folders.
   * The two callers today are the sync-collision modal (left = local
   * registry copy, right = incoming bundled tarball) and — when the
   * drift drawer rebuild lands — the drift heal flow (left = local
   * edited copy, right = synced-baseline content fetched at the
   * recorded commit). Result shape is the same in both cases so the
   * renderer-side DiffViewer component is reused.
   */
  getSkillDiff(req: SkillDiffRequest): Promise<SkillDiffResult>;
  install(
    name: string,
    force?: boolean,
    agents?: AgentId[],
  ): Promise<InstallIPCResult>;
  /**
   * Remove the skill's symlinks from agent dirs. With no `agents`
   * arg, removes from every agent dir that has the skill (default,
   * unchanged from pre-M7). Pass an explicit list to target a
   * subset — surfaced as the "Choose agents…" affordance in the
   * detail drawer.
   */
  uninstall(name: string, agents?: AgentId[]): Promise<UninstallIPCResult>;
  unregister(
    name: string,
    destination: AgentId,
    force?: boolean,
  ): Promise<UnregisterIPCResult>;
  /**
   * M9b: delete an unregistered skill's on-disk presence. Refuses
   * if the skill is still registered (the registered → unregister
   * → delete ladder is enforced server-side).
   */
  deleteUnregistered(name: string): Promise<{
    ok: boolean;
    message: string;
    removedDirs: string[];
    removedSymlinks: string[];
  }>;
  forgetMissing(
    name: string,
  ): Promise<{ ok: boolean; message: string; error?: AppError }>;
  /**
   * Open a directory picker and repoint a non-adopted external entry's
   * target path to the user's selection. Returns `cancelled` (ok=false)
   * if the user dismisses the picker; surfaces validation errors as
   * `error.message` otherwise.
   */
  repointExternal(
    name: string,
  ): Promise<{ ok: boolean; message: string; error?: AppError }>;
  /**
   * Restore an unreachable origin by repointing it at a new GitHub URL
   * (ADR-0012). Parses the URL → repo + skillPath, re-fetches content,
   * and rewrites the origin pointer (rolling back to the prior marker on
   * failure). Shares `OriginUpdateResult` with `originUpdate`.
   */
  repointOrigin(name: string, url: string): Promise<OriginUpdateResult>;
  /**
   * Sever a skill's origin and rehome it as a local skill in `personal/`
   * (ADR-0012). The restore "keep it local" escape and the drift
   * "keep my edits" action.
   */
  detachLocal(
    name: string,
  ): Promise<{ ok: boolean; message: string; error?: AppError }>;
  /**
   * Adopt an unreachable skill into the linked repo as a PR (ADR-0012):
   * detaches locally, then commits the skill's files under `destPath` and
   * opens (or reuses) a PR. On success returns the PR number + URL.
   */
  rehomeIntoLinkedRepo(
    name: string,
    destPath: string,
  ): Promise<AdoptIntoLinkedRepoIPCResult>;
  scan(customDirs?: string[]): Promise<ScanReport>;
  register(
    items: Array<{ name: string; action: RegistrationAction }>,
  ): Promise<RegistrationResult[]>;
  getRoot(): Promise<string>;
  rebuildIndex(): Promise<{ ok: boolean; message: string; entries: number }>;
  finalize(): Promise<FinalizeResult>;
  /**
   * Lightweight probe for "is any agent dir a symlink we could finalize?"
   * Returns one entry per agent whose top-level skills dir is itself a
   * symlink. Empty array when nothing is symlinked. Used by Settings to
   * gate visibility of the Collapse symlinked agent dirs entry.
   */
  listTopLevelSymlinks(): Promise<
    Array<{ agent: AgentId; resolvedTarget: string; exists: boolean }>
  >;
  exportInfo(name: string): Promise<ExportInfo>;
  exportSkill(
    name: string,
  ): Promise<{ ok: boolean; message: string; result?: ExportResult }>;
  readSkillMd(name: string): Promise<string | null>;
  openInFinder(absolutePath: string): Promise<void>;
  getConfig(): Promise<{
    registryRoot: string | null;
    configValid: boolean;
    isPackaged: boolean;
    registrySource: RegistrySource | null;
    dismissedUpdateVersion: string | null;
    /**
     * Electron's currently-selected `safeStorage` backend. Possible
     * values include `keychain`, `dpapi`, `gnome_libsecret`, `kwallet`,
     * `basic_text`, or `null` when encryption is unavailable.
     * `basic_text` indicates the Linux obfuscation-only fallback
     * — auth.ts stores a token but only weakly encrypted. ADR-0004.
     */
    storageBackend: string | null;
    /**
     * True iff the renderer should surface the weak-storage notice
     * this session (backend resolved to `basic_text` AND the user
     * hasn't dismissed the warning for this backend yet). ADR-0004.
     */
    showWeakStorageNotice: boolean;
  }>;
  /** Persist the user's dismissal of the weak-storage notice. ADR-0004. */
  dismissWeakStorageNotice(): Promise<void>;
  setRegistryRoot(): Promise<{
    ok: boolean;
    message: string;
    registryRoot: string | null;
    /**
     * Non-fatal sanity flag — set when the chosen path is suspicious
     * (system root, the user's home, etc.) but was otherwise valid as
     * a registry root. v0.11.8 M5 guardrail. Renderer surfaces as a
     * warning toast without rolling back the change.
     */
    warning?: string;
  }>;
  checkForUpdates(): Promise<{
    ok: boolean;
    message: string;
    error?: AppError;
  }>;
  downloadUpdate(): Promise<{ ok: boolean; message: string; error?: AppError }>;
  quitAndInstallUpdate(): Promise<void>;
  setDismissedUpdateVersion(version: string | null): Promise<void>;
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void;
  authStatus(): Promise<AuthStatus>;
  authSetRegistrySourceLocal(): Promise<AuthStatus>;
  authStartDeviceFlow(): Promise<DeviceFlowStartPayload>;
  authPollDeviceFlow(flowId: string): Promise<AuthStatus>;
  authCancelDeviceFlow(flowId: string): Promise<void>;
  authResumeDeviceFlow(): Promise<DeviceFlowResumePayload | null>;
  authLogout(): Promise<AuthStatus>;
  reposListMine(): Promise<UserRepo[]>;
  reposReplaceRegistry(fullName: string): Promise<{
    ok: boolean;
    message: string;
    importedCount?: number;
    conflictCount?: number;
  }>;
  /**
   * Re-fetch from the currently linked GitHub repo (no picker). Resolves
   * the target from persisted `linkedRepo`; errors clearly if nothing is
   * linked yet. Shares the diff-before-apply path with
   * `reposReplaceRegistry`.
   */
  reposRefreshCurrent(): Promise<{
    ok: boolean;
    message: string;
    importedCount?: number;
    conflictCount?: number;
  }>;
  openExternal(url: string): Promise<void>;
  openSelfHostDocs(): Promise<{ ok: boolean; message?: string }>;
  exportManifest(): Promise<{
    ok: boolean;
    message: string;
    skillCount?: number;
    destPath?: string;
  }>;
  /**
   * Phase 1 manifest import. Reads a JSON manifest the user picks
   * from disk, mirrors each skill's content from its Origin, and
   * restores per-skill tags + hide state. Returns the per-skill
   * outcomes plus `installHints` so the renderer can surface a
   * single user-confirmed batch install via `installFromManifestHint`.
   */
  importManifest(): Promise<
    | { ok: false; message: string; error?: AppError }
    | {
        ok: true;
        message: string;
        result: ImportRegistryManifestResult;
      }
  >;
  /**
   * Abort the in-flight `importManifest` IPC. The per-skill loop
   * exits at the top of the next iteration; already-mirrored
   * skills stay on disk. No-op when no import is running.
   */
  importManifestCancel(): Promise<{ ok: boolean }>;
  /** Preview what a push would change in the linked repo's manifest. */
  previewManifestPush(): Promise<PreviewManifestPushResult>;
  /** Push the local manifest to the linked repo (direct commit or PR). */
  pushManifestToRepo(opts: {
    asPR: boolean;
  }): Promise<PushManifestToRepoResult>;
  /** Read the manifest from the linked repo and diff it against local. */
  readManifestFromRepo(): Promise<ReadManifestFromRepoResult>;
  /**
   * Pull from the linked repo as a three-way merge: fetch the remote
   * manifest (`theirs`), load the stored merge base, export the local
   * registry (`ours`), and merge. A clean merge reconciles locally and
   * advances the base; conflicts are persisted and surfaced through the
   * resolver modal.
   */
  runManifestMerge(): Promise<RunManifestMergeResult>;
  /**
   * Read the queued three-way merge conflicts (if any) so the resolver
   * modal can re-open across restarts. Null when none are pending.
   */
  getPendingManifestConflicts(): Promise<PendingManifestConflicts | null>;
  /** Discard the queued merge conflicts (stuck-state recovery). */
  clearPendingManifestConflicts(): Promise<{ ok: boolean; removed: boolean }>;
  /**
   * Apply the user's resolver decisions to the queued merge: fold each
   * choice into the merged manifest, reconcile the local registry
   * (import adds/restores, delete confirmed removals, fork `keep-both`),
   * then clear the pending file. Pushing the merged manifest upstream is
   * a separate action.
   */
  resolveManifestConflicts(
    decisions: ManifestDecisions,
  ): Promise<ResolveManifestConflictsResult>;
  /**
   * Apply a manifest's install hints — one user-confirmed batch.
   * Calls the existing install path for each `{ name, agents }`
   * pair. Never auto-invoked by `importManifest`.
   */
  installFromManifestHint(payload: {
    names: string[];
    agents: AgentId[];
  }): Promise<{
    ok: boolean;
    message: string;
    installedCount: number;
    errors: string[];
  }>;
  /**
   * Phase 4 (v1.5): one-shot install from a GitHub URL. The
   * Discover tab: mirror a GitHub skill directly to the shared
   * ~/.agents/skills/ directory. No bank entry created; skill appears
   * as "unregistered" in the Installed tab.
   */
  addFromGithub(url: string): Promise<
    | { ok: true; name: string }
    | { ok: false; reason: "url-parse-error"; message: string }
    | {
        ok: false;
        reason: "mirror-failed";
        message: string;
        rateLimit?: RateLimitInfo;
      }
    | { ok: false; reason: "no-skill-md"; message: string }
  >;
  repairBrokenLinks(name: string): Promise<BrokenLinkRepairReport>;
  removeBrokenLinks(
    name: string,
    agents: AgentId[],
  ): Promise<BrokenLinkRemoveReport>;
  /**
   * Local-disk diagnostics aggregator. Walks agent dirs + the registry
   * index to surface "needs attention" items across four categories
   * (unregistered installs, broken symlinks, external-target-missing,
   * registry-folder-missing). Local-only — no network calls.
   */
  localDiagnosticsScan(customDirs?: string[]): Promise<DiagnosticReport>;
  resolveSkillConflicts(
    name: string,
    decisions: ConflictResolveDecision[],
  ): Promise<ConflictResolveReport>;
  discoverShow(bounds: Bounds): Promise<void>;
  discoverHide(): Promise<void>;
  /** Synchronous hide — blocks until the main process has hidden the view. */
  discoverHideSync(): void;
  discoverSetBounds(bounds: Bounds): Promise<void>;
  discoverGoBack(): Promise<void>;
  discoverReload(): Promise<void>;
  discoverOpenExternal(): Promise<void>;
  discoverOpenTerminal(
    terminalApp?: string,
  ): Promise<{ ok: boolean; message?: string }>;
  onDiscoverStatus(cb: (status: DiscoverStatus) => void): () => void;
  onHeaderMenuAction(cb: (action: HeaderMenuAction) => void): () => void;
  originProbe(): Promise<OriginProbeResult>;
  onOriginProbeComplete(
    cb: (event: OriginProbeCompleteEvent) => void,
  ): () => void;
  /**
   * Subscribe to per-skill progress events emitted by a running
   * manifest import. Fires once at the top of each iteration in the
   * core's per-skill loop. The first event of an import carries
   * `manifestNames` for Tier-3 ghost-card pre-rendering; subsequent
   * events update the cumulative `completed` count and surface
   * per-skill failures via `lastError`. Returns an unsubscribe
   * function — caller invokes on unmount to detach.
   */
  onManifestImportProgress(
    cb: (event: ManifestImportProgressEvent) => void,
  ): () => void;
  /**
   * Tier-3 retry: re-mirror a single skill that errored during a
   * manifest import. Wraps the entry in a one-skill manifest and
   * runs it through `importRegistryManifest` (no progress events
   * fire — retry is single-shot, the renderer awaits the IPC's
   * single outcome). Returns the single outcome of that
   * one-skill import.
   */
  manifestImportRetrySkill(
    skill: ManifestSkill,
  ): Promise<{ ok: boolean; outcome?: ImportSkillOutcome; message?: string }>;
  originUpdate(name: string): Promise<OriginUpdateResult>;
  originRepoMetadata(repo: string): Promise<OriginRepoMetadata>;
  originLastCommit(repo: string, skillPath: string): Promise<OriginLastCommit>;
  originSetManual(
    name: string,
    choice: OriginManualChoice,
  ): Promise<{ ok: boolean; message: string }>;
  readLabels(): Promise<LabelsMap>;
  updateLabel(name: string, patch: SkillLabelOverride): Promise<void>;
  resetLabel(name: string): Promise<void>;
  bulkUpdateLabels(updates: LabelsMap): Promise<void>;
}

declare global {
  interface Window {
    skillsBank: SkillsBankAPI;
  }
}
