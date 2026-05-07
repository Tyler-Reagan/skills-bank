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
  authStatus: "auth:status",
  authIsConfigured: "auth:isConfigured",
  authSetPersonaConvenience: "auth:setPersonaConvenience",
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
  repairBrokenLinks: "skills:repairBrokenLinks",
  removeBrokenLinks: "skills:removeBrokenLinks",
  resolveSkillConflicts: "skills:resolveSkillConflicts",
  discoverShow: "discover:show",
  discoverHide: "discover:hide",
  discoverSetBounds: "discover:setBounds",
  discoverGoBack: "discover:goBack",
  discoverReload: "discover:reload",
  discoverOpenExternal: "discover:openExternal",
  discoverOpenTerminal: "discover:openTerminal",
  discoverStatus: "discover:status",
} as const;

export type Persona = "convenience" | "power";

export interface AuthStatus {
  persona: Persona | null;
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
    agents?: AgentId[],
  ): Promise<{ ok: boolean; message: string }>;
  uninstall(name: string): Promise<{ ok: boolean; message: string }>;
  scan(): Promise<ScanReport>;
  migrate(
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
    persona: Persona | null;
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
  authStatus(): Promise<AuthStatus>;
  authSetPersonaConvenience(): Promise<AuthStatus>;
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
  discoverSetBounds(bounds: Bounds): Promise<void>;
  discoverGoBack(): Promise<void>;
  discoverReload(): Promise<void>;
  discoverOpenExternal(): Promise<void>;
  discoverOpenTerminal(): Promise<{ ok: boolean; message?: string }>;
  onDiscoverStatus(cb: (status: DiscoverStatus) => void): () => void;
}

declare global {
  interface Window {
    skillsBank: SkillsBankAPI;
  }
}
