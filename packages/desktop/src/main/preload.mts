import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  type Bounds,
  type DiscoverStatus,
  type AppUpdateStatus,
} from "../shared/ipc.js";

const api = {
  listRegistry: () => ipcRenderer.invoke(IPC.listRegistry),
  listInstalled: () => ipcRenderer.invoke(IPC.listInstalled),
  install: (name: string, force?: boolean, agents?: unknown) =>
    ipcRenderer.invoke(IPC.install, name, force, agents),
  uninstall: (name: string, agents?: unknown) =>
    ipcRenderer.invoke(IPC.uninstall, name, agents),
  unregister: (name: string, destination: string, force?: boolean) =>
    ipcRenderer.invoke(IPC.unregister, name, destination, force),
  deleteUnregistered: (name: string) =>
    ipcRenderer.invoke(IPC.deleteUnregistered, name),
  forgetMissing: (name: string) => ipcRenderer.invoke(IPC.forgetMissing, name),
  repointOrigin: (name: string, url: string) =>
    ipcRenderer.invoke(IPC.repointOrigin, name, url),
  detachLocal: (name: string) => ipcRenderer.invoke(IPC.detachLocal, name),
  rehomeIntoLinkedRepo: (name: string, destPath: string) =>
    ipcRenderer.invoke(IPC.rehomeIntoLinkedRepo, name, destPath),
  scan: () => ipcRenderer.invoke(IPC.scan),
  register: (items: unknown) => ipcRenderer.invoke(IPC.register, items),
  getRoot: () => ipcRenderer.invoke(IPC.getRoot),
  rebuildIndex: () => ipcRenderer.invoke(IPC.rebuildIndex),
  extractInfo: (name: string) => ipcRenderer.invoke(IPC.extractInfo, name),
  extractSkill: (name: string) => ipcRenderer.invoke(IPC.extractSkill, name),
  readSkillMd: (name: string) => ipcRenderer.invoke(IPC.readSkillMd, name),
  openInFinder: (absolutePath: string) =>
    ipcRenderer.invoke(IPC.openInFinder, absolutePath),
  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  setRegistryRoot: () => ipcRenderer.invoke(IPC.setRegistryRoot),
  checkForAppUpdates: () => ipcRenderer.invoke(IPC.checkForAppUpdates),
  downloadAppUpdate: () => ipcRenderer.invoke(IPC.downloadAppUpdate),
  quitAndInstallAppUpdate: () =>
    ipcRenderer.invoke(IPC.quitAndInstallAppUpdate),
  setDismissedAppUpdateVersion: (version: string | null) =>
    ipcRenderer.invoke(IPC.setDismissedAppUpdateVersion, version),
  dismissWeakStorageNotice: () =>
    ipcRenderer.invoke(IPC.dismissWeakStorageNotice),
  onAppUpdateStatus: (cb: (status: AppUpdateStatus) => void) => {
    const listener = (_e: unknown, status: AppUpdateStatus) => cb(status);
    ipcRenderer.on(IPC.appUpdateStatus, listener);
    return () => ipcRenderer.removeListener(IPC.appUpdateStatus, listener);
  },
  authStatus: () => ipcRenderer.invoke(IPC.authStatus),
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
  exportManifest: () => ipcRenderer.invoke(IPC.exportManifest),
  importManifest: () => ipcRenderer.invoke(IPC.importManifest),
  importManifestCancel: () => ipcRenderer.invoke(IPC.importManifestCancel),
  previewManifestExport: () => ipcRenderer.invoke(IPC.previewManifestExport),
  exportManifestToRepo: (opts: { asPR: boolean }) =>
    ipcRenderer.invoke(IPC.exportManifestToRepo, opts),
  readManifestFromRepo: () => ipcRenderer.invoke(IPC.readManifestFromRepo),
  runManifestMerge: () => ipcRenderer.invoke(IPC.runManifestMerge),
  getPendingManifestConflicts: () =>
    ipcRenderer.invoke(IPC.getPendingManifestConflicts),
  clearPendingManifestConflicts: () =>
    ipcRenderer.invoke(IPC.clearPendingManifestConflicts),
  resolveManifestConflicts: (decisions: unknown) =>
    ipcRenderer.invoke(IPC.resolveManifestConflicts, decisions),
  installFromManifestHint: (payload: unknown) =>
    ipcRenderer.invoke(IPC.installFromManifestHint, payload),
  addFromGithub: (input: string) =>
    ipcRenderer.invoke(IPC.addFromGithub, input),
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
  discoverNpxSkills: () => ipcRenderer.invoke(IPC.discoverNpxSkills),
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
  originProbe: () => ipcRenderer.invoke(IPC.originProbe),
  onOriginProbeComplete: (
    cb: (event: import("../shared/ipc.js").OriginProbeCompleteEvent) => void,
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
          ? (payload as import("../shared/ipc.js").OriginProbeCompleteEvent)
          : {};
      cb(event);
    };
    ipcRenderer.on(IPC.originProbe, listener);
    return () => ipcRenderer.removeListener(IPC.originProbe, listener);
  },
  manifestImportRetrySkill: (
    skill: import("@skills-bank/core").ManifestSkill,
  ) => ipcRenderer.invoke(IPC.manifestImportRetrySkill, skill),
  onManifestImportProgress: (
    cb: (
      event: import("@skills-bank/core").ManifestImportProgressEvent,
    ) => void,
  ) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      payload: unknown,
    ): void => {
      if (payload && typeof payload === "object") {
        cb(payload as import("@skills-bank/core").ManifestImportProgressEvent);
      }
    };
    ipcRenderer.on(IPC.manifestImportProgress, listener);
    return () =>
      ipcRenderer.removeListener(IPC.manifestImportProgress, listener);
  },
  skillUpdate: (name: string) => ipcRenderer.invoke(IPC.skillUpdate, name),
  originRepoMetadata: (repo: string) =>
    ipcRenderer.invoke(IPC.originRepoMetadata, repo),
  originLastCommit: (repo: string, skillPath: string) =>
    ipcRenderer.invoke(IPC.originLastCommit, repo, skillPath),
  originSetManual: (name: string, choice: unknown) =>
    ipcRenderer.invoke(IPC.originSetManual, name, choice),
  readLabels: () => ipcRenderer.invoke(IPC.readLabels),
  updateLabel: (name: string, patch: unknown) =>
    ipcRenderer.invoke(IPC.updateLabel, name, patch),
  resetLabel: (name: string) => ipcRenderer.invoke(IPC.resetLabel, name),
  bulkUpdateLabels: (updates: unknown) =>
    ipcRenderer.invoke(IPC.bulkUpdateLabels, updates),
  getInvocationStats: () => ipcRenderer.invoke(IPC.getInvocationStats),
  getSkillTrackingStatus: () => ipcRenderer.invoke(IPC.getSkillTrackingStatus),
  setSkillTrackingEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(IPC.setSkillTrackingEnabled, enabled),
};

contextBridge.exposeInMainWorld("skillsBank", api);
