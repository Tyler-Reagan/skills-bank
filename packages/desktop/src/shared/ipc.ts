import type {
  AgentId,
  BrokenLinkRemoveReport,
  BrokenLinkRepairReport,
  ConflictEntry,
  ConflictResolveDecision,
  ConflictResolveReport,
  ExportInfo,
  ExportResult,
  FinalizeResult,
  InstalledSkill,
  MergeImportReport,
  RegistrationAction,
  RegistrationResult,
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
  register: "skills:register",
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
  downloadUpdate: "app:downloadUpdate",
  quitAndInstallUpdate: "app:quitAndInstallUpdate",
  updateStatus: "app:updateStatus",
  setDismissedUpdateVersion: "app:setDismissedUpdateVersion",
  syncCanonical: "registry:syncCanonical",
  getSyncReport: "registry:getSyncReport",
  syncStatus: "registry:syncStatus",
  getPendingConflicts: "registry:getPendingConflicts",
  resolveConflicts: "registry:resolveConflicts",
  authStatus: "auth:status",
  authIsConfigured: "auth:isConfigured",
  authSetRegistrySourceLocal: "auth:setRegistrySourceLocal",
  authStartDeviceFlow: "auth:startDeviceFlow",
  authPollDeviceFlow: "auth:pollDeviceFlow",
  authCancelDeviceFlow: "auth:cancelDeviceFlow",
  authLogout: "auth:logout",
  reposListMine: "repos:listMine",
  reposReplaceRegistry: "repos:replaceRegistry",
  openExternal: "system:openExternal",
  openSelfHostDocs: "system:openSelfHostDocs",
  exportRegistry: "skills:exportRegistry",
  importRegistry: "skills:importRegistry",
  importRegistryMerge: "skills:importRegistryMerge",
  importRegistryMergeApply: "skills:importRegistryMergeApply",
  repairBrokenLinks: "skills:repairBrokenLinks",
  removeBrokenLinks: "skills:removeBrokenLinks",
  resolveSkillConflicts: "skills:resolveSkillConflicts",
  deregister: "skills:deregister",
  unregister: "skills:unregister",
  deleteUnregistered: "skills:deleteUnregistered",
  hide: "skills:hide",
  unhide: "skills:unhide",
  acceptDrift: "skills:acceptDrift",
  takeCanonical: "skills:takeCanonical",
  forgetMissing: "skills:forgetMissing",
  clearPendingConflicts: "registry:clearPendingConflicts",
  discoverShow: "discover:show",
  discoverHide: "discover:hide",
  discoverHideSync: "discover:hideSync",
  discoverSetBounds: "discover:setBounds",
  discoverGoBack: "discover:goBack",
  discoverReload: "discover:reload",
  discoverOpenExternal: "discover:openExternal",
  discoverOpenTerminal: "discover:openTerminal",
  discoverStatus: "discover:status",
  showHeaderMenu: "header:showMenu",
  headerMenuAction: "header:action",
  pickCustomSkillsDir: "skills:pickCustomSkillsDir",
  getSkillDiff: "skills:getSkillDiff",
} as const;

export interface SkillDiffFile {
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
}

/**
 * Internal-only enum. `"local"` ⇒ the user is on the bundled registry
 * shipped with the app. `"github"` ⇒ they've linked a GitHub repo as
 * the registry backing store. Replaces the legacy `Persona` enum and
 * never surfaces to the user (the UI uses "Local bundled" / "Link a
 * GitHub repo" copy).
 */
export type RegistrySource = "local" | "github";

export interface AuthStatus {
  registrySource: RegistrySource | null;
  isAuthConfigured: boolean;
  user: {
    login: string;
    avatarUrl: string;
    htmlUrl: string;
  } | null;
}

export interface DeviceFlowStartPayload {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  flowId: string;
}

export interface UserRepo {
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
  description: string | null;
}

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

export interface HeaderMenuContext {
  registrySource: RegistrySource | null;
  user: { login: string } | null;
  showSync: boolean;
}

export type HeaderMenuAction =
  | "changeRegistry"
  | "mergeRegistry"
  | "exportRegistry"
  | "openSettings"
  | "openShortcuts"
  | "signOut"
  | "refresh"
  | "sync"
  | "checkForUpdates"
  | "githubLinkComingSoon";

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

interface InstallIPCError {
  agent: AgentId;
  message: string;
}

interface InstallIPCResult {
  ok: boolean;
  message: string;
  /**
   * Per-agent failures from the underlying installSkill. Surfaced so the
   * renderer can detect "needs --force" conflicts and offer a retry path
   * without parsing the toast message.
   */
  errors?: InstallIPCError[];
}

interface UninstallIPCResult {
  ok: boolean;
  message: string;
  /** Per-agent failures (e.g. real-directory that we refuse to delete). */
  errors?: InstallIPCError[];
  /** Number of symlinks actually removed. */
  removedCount?: number;
  /** Number of agent dirs we deliberately left alone (real dirs). */
  keptCount?: number;
}

interface DeregisterIPCResult {
  ok: boolean;
  message: string;
  deletedPath?: string;
  removedSymlinkCount?: number;
  errors?: Array<{ agent?: AgentId; message: string }>;
}

interface UnregisterIPCResult {
  ok: boolean;
  message: string;
  /** Where adopted files were moved to. Absent for non-adopted skills. */
  destinationPath?: string;
  /** True when the unregistered skill was previously adopted. */
  wasAdopted: boolean;
  errors?: Array<{ agent?: AgentId; message: string }>;
}

interface SkillsBankAPI {
  listRegistry(): Promise<RegistryEntry[]>;
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
  deregister(name: string): Promise<DeregisterIPCResult>;
  unregister(name: string, destination: AgentId): Promise<UnregisterIPCResult>;
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
  hide(name: string): Promise<{ ok: boolean; message: string }>;
  unhide(name: string): Promise<{ ok: boolean; message: string }>;
  acceptDrift(name: string): Promise<{ ok: boolean; message: string }>;
  takeCanonical(name: string): Promise<{ ok: boolean; message: string }>;
  forgetMissing(name: string): Promise<{ ok: boolean; message: string }>;
  clearPendingConflicts(): Promise<{ ok: boolean; message: string }>;
  scan(): Promise<ScanReport>;
  register(
    items: Array<{ name: string; action: RegistrationAction }>,
  ): Promise<RegistrationResult[]>;
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
    registrySource: RegistrySource | null;
    dismissedUpdateVersion: string | null;
  }>;
  setRegistryRoot(): Promise<{
    ok: boolean;
    message: string;
    registryRoot: string | null;
  }>;
  checkForUpdates(): Promise<{ ok: boolean; message: string }>;
  downloadUpdate(): Promise<{ ok: boolean; message: string }>;
  quitAndInstallUpdate(): Promise<void>;
  setDismissedUpdateVersion(version: string | null): Promise<void>;
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
  authStatus(): Promise<AuthStatus>;
  authSetRegistrySourceLocal(): Promise<AuthStatus>;
  authStartDeviceFlow(): Promise<DeviceFlowStartPayload>;
  authPollDeviceFlow(flowId: string): Promise<AuthStatus>;
  authCancelDeviceFlow(flowId: string): Promise<void>;
  authLogout(): Promise<AuthStatus>;
  reposListMine(): Promise<UserRepo[]>;
  reposReplaceRegistry(
    fullName: string,
  ): Promise<{ ok: boolean; message: string; importedCount?: number }>;
  openExternal(url: string): Promise<void>;
  openSelfHostDocs(): Promise<{ ok: boolean; message?: string }>;
  exportRegistry(): Promise<{
    ok: boolean;
    message: string;
    skillCount?: number;
  }>;
  importRegistry(): Promise<{
    ok: boolean;
    message: string;
    registryRoot: string | null;
    skillCount?: number;
  }>;
  /**
   * M8: open a folder picker, scan its skills/ dir, attempt to merge
   * into the active registry. Returns the merge report; if it
   * contains conflicts, the renderer routes them through
   * ConflictResolutionModal and calls importRegistryMergeApply with
   * the user's decisions.
   */
  importRegistryMerge(): Promise<
    | { ok: false; message: string }
    | {
        ok: true;
        message: string;
        sourcePath: string;
        report: MergeImportReport;
      }
  >;
  /**
   * M8: resolve a prior import-merge's queued conflicts with the
   * user's decisions. The active registry is the destination; the
   * `sourcePath` is the folder picked in the original merge call.
   */
  importRegistryMergeApply(
    sourcePath: string,
    decisions: SyncDecisions,
  ): Promise<{ ok: boolean; message: string; report: MergeImportReport }>;
  repairBrokenLinks(name: string): Promise<BrokenLinkRepairReport>;
  removeBrokenLinks(
    name: string,
    agents: AgentId[],
  ): Promise<BrokenLinkRemoveReport>;
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
  showHeaderMenu(context: HeaderMenuContext): Promise<void>;
  onHeaderMenuAction(cb: (action: HeaderMenuAction) => void): () => void;
}

declare global {
  interface Window {
    skillsBank: SkillsBankAPI;
  }
}
