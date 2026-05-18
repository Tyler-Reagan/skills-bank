import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  type Bounds,
  type DiscoverStatus,
  type SyncStatus,
  type UpdateStatus,
} from "../shared/ipc.js";

const api = {
  listRegistry: () => ipcRenderer.invoke(IPC.listRegistry),
  listInstalled: (customDirs?: string[]) =>
    ipcRenderer.invoke(IPC.listInstalled, customDirs),
  pickCustomSkillsDir: () => ipcRenderer.invoke(IPC.pickCustomSkillsDir),
  getSkillDiff: (req: unknown) => ipcRenderer.invoke(IPC.getSkillDiff, req),
  install: (name: string, force?: boolean, agents?: unknown) =>
    ipcRenderer.invoke(IPC.install, name, force, agents),
  uninstall: (name: string, agents?: unknown) =>
    ipcRenderer.invoke(IPC.uninstall, name, agents),
  deregister: (name: string) => ipcRenderer.invoke(IPC.deregister, name),
  unregister: (name: string, destination: string, force?: boolean) =>
    ipcRenderer.invoke(IPC.unregister, name, destination, force),
  deleteUnregistered: (name: string) =>
    ipcRenderer.invoke(IPC.deleteUnregistered, name),
  hide: (name: string) => ipcRenderer.invoke(IPC.hide, name),
  unhide: (name: string) => ipcRenderer.invoke(IPC.unhide, name),
  acceptDrift: (name: string) => ipcRenderer.invoke(IPC.acceptDrift, name),
  takeCanonical: (name: string) => ipcRenderer.invoke(IPC.takeCanonical, name),
  forgetMissing: (name: string) => ipcRenderer.invoke(IPC.forgetMissing, name),
  repointExternal: (name: string) =>
    ipcRenderer.invoke(IPC.repointExternal, name),
  listTopLevelSymlinks: () => ipcRenderer.invoke(IPC.listTopLevelSymlinks),
  clearPendingConflicts: () => ipcRenderer.invoke(IPC.clearPendingConflicts),
  scan: () => ipcRenderer.invoke(IPC.scan),
  register: (items: unknown) => ipcRenderer.invoke(IPC.register, items),
  getRoot: () => ipcRenderer.invoke(IPC.getRoot),
  rebuildIndex: () => ipcRenderer.invoke(IPC.rebuildIndex),
  finalize: () => ipcRenderer.invoke(IPC.finalize),
  exportInfo: (name: string) => ipcRenderer.invoke(IPC.exportInfo, name),
  exportSkill: (name: string) => ipcRenderer.invoke(IPC.exportSkill, name),
  readSkillMd: (name: string) => ipcRenderer.invoke(IPC.readSkillMd, name),
  openInFinder: (absolutePath: string) =>
    ipcRenderer.invoke(IPC.openInFinder, absolutePath),
  editTags: (name: string, tags: string[]) =>
    ipcRenderer.invoke(IPC.editTags, name, tags),
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  setRegistryRoot: () => ipcRenderer.invoke(IPC.setRegistryRoot),
  checkForUpdates: () => ipcRenderer.invoke(IPC.checkForUpdates),
  downloadUpdate: () => ipcRenderer.invoke(IPC.downloadUpdate),
  quitAndInstallUpdate: () => ipcRenderer.invoke(IPC.quitAndInstallUpdate),
  setDismissedUpdateVersion: (version: string | null) =>
    ipcRenderer.invoke(IPC.setDismissedUpdateVersion, version),
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => {
    const listener = (_e: unknown, status: UpdateStatus) => cb(status);
    ipcRenderer.on(IPC.updateStatus, listener);
    return () => ipcRenderer.removeListener(IPC.updateStatus, listener);
  },
  syncCanonical: () => ipcRenderer.invoke(IPC.syncCanonical),
  getSyncReport: () => ipcRenderer.invoke(IPC.getSyncReport),
  onSyncStatus: (cb: (status: SyncStatus) => void) => {
    const listener = (_e: unknown, status: SyncStatus) => cb(status);
    ipcRenderer.on(IPC.syncStatus, listener);
    return () => ipcRenderer.removeListener(IPC.syncStatus, listener);
  },
  getPendingConflicts: () => ipcRenderer.invoke(IPC.getPendingConflicts),
  resolveConflicts: (decisions: unknown) =>
    ipcRenderer.invoke(IPC.resolveConflicts, decisions),
  authStatus: () => ipcRenderer.invoke(IPC.authStatus),
  authSetRegistrySourceLocal: () =>
    ipcRenderer.invoke(IPC.authSetRegistrySourceLocal),
  authStartDeviceFlow: () => ipcRenderer.invoke(IPC.authStartDeviceFlow),
  authPollDeviceFlow: (flowId: string) =>
    ipcRenderer.invoke(IPC.authPollDeviceFlow, flowId),
  authCancelDeviceFlow: (flowId: string) =>
    ipcRenderer.invoke(IPC.authCancelDeviceFlow, flowId),
  authResumeDeviceFlow: () => ipcRenderer.invoke(IPC.authResumeDeviceFlow),
  authLogout: () => ipcRenderer.invoke(IPC.authLogout),
  reposListMine: () => ipcRenderer.invoke(IPC.reposListMine),
  reposReplaceRegistry: (fullName: string) =>
    ipcRenderer.invoke(IPC.reposReplaceRegistry, fullName),
  reposRefreshCurrent: () => ipcRenderer.invoke(IPC.reposRefreshCurrent),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.openExternal, url),
  openSelfHostDocs: () => ipcRenderer.invoke(IPC.openSelfHostDocs),
  exportRegistry: () => ipcRenderer.invoke(IPC.exportRegistry),
  importRegistry: () => ipcRenderer.invoke(IPC.importRegistry),
  importRegistryMerge: () => ipcRenderer.invoke(IPC.importRegistryMerge),
  importRegistryMergeApply: (sourcePath: string, decisions: unknown) =>
    ipcRenderer.invoke(IPC.importRegistryMergeApply, sourcePath, decisions),
  repairBrokenLinks: (name: string) =>
    ipcRenderer.invoke(IPC.repairBrokenLinks, name),
  removeBrokenLinks: (name: string, agents: unknown) =>
    ipcRenderer.invoke(IPC.removeBrokenLinks, name, agents),
  resolveSkillConflicts: (name: string, decisions: unknown) =>
    ipcRenderer.invoke(IPC.resolveSkillConflicts, name, decisions),
  discoverShow: (bounds: Bounds) =>
    ipcRenderer.invoke(IPC.discoverShow, bounds),
  discoverHide: () => ipcRenderer.invoke(IPC.discoverHide),
  discoverHideSync: () => ipcRenderer.sendSync(IPC.discoverHideSync),
  discoverSetBounds: (bounds: Bounds) =>
    ipcRenderer.invoke(IPC.discoverSetBounds, bounds),
  discoverGoBack: () => ipcRenderer.invoke(IPC.discoverGoBack),
  discoverReload: () => ipcRenderer.invoke(IPC.discoverReload),
  discoverOpenExternal: () => ipcRenderer.invoke(IPC.discoverOpenExternal),
  discoverOpenTerminal: (terminalApp?: string) =>
    ipcRenderer.invoke(IPC.discoverOpenTerminal, terminalApp),
  onDiscoverStatus: (cb: (status: DiscoverStatus) => void) => {
    const listener = (_e: unknown, status: DiscoverStatus) => cb(status);
    ipcRenderer.on(IPC.discoverStatus, listener);
    return () => ipcRenderer.removeListener(IPC.discoverStatus, listener);
  },
  onHeaderMenuAction: (cb: (action: string) => void) => {
    const listener = (_e: unknown, action: string) => cb(action);
    ipcRenderer.on(IPC.headerMenuAction, listener);
    return () => ipcRenderer.removeListener(IPC.headerMenuAction, listener);
  },
  upstreamProbe: () => ipcRenderer.invoke(IPC.upstreamProbe),
  onUpstreamProbeComplete: (
    cb: (event: import("../shared/ipc.js").UpstreamProbeCompleteEvent) => void,
  ) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      payload: unknown,
    ): void => {
      // Tolerate the historical "complete" string and any future
      // shape evolutions by coercing non-object payloads to an
      // empty event.
      const event =
        payload && typeof payload === "object"
          ? (payload as import("../shared/ipc.js").UpstreamProbeCompleteEvent)
          : {};
      cb(event);
    };
    ipcRenderer.on(IPC.upstreamProbe, listener);
    return () => ipcRenderer.removeListener(IPC.upstreamProbe, listener);
  },
  upstreamUpdate: (name: string) =>
    ipcRenderer.invoke(IPC.upstreamUpdate, name),
  upstreamRepoMetadata: (repo: string) =>
    ipcRenderer.invoke(IPC.upstreamRepoMetadata, repo),
  upstreamLastCommit: (repo: string, skillPath: string) =>
    ipcRenderer.invoke(IPC.upstreamLastCommit, repo, skillPath),
  upstreamSetManual: (name: string, choice: unknown) =>
    ipcRenderer.invoke(IPC.upstreamSetManual, name, choice),
};

contextBridge.exposeInMainWorld("skillsBank", api);
