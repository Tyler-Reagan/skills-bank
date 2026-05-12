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
  listInstalled: () => ipcRenderer.invoke(IPC.listInstalled),
  install: (name: string, force?: boolean, agents?: unknown) =>
    ipcRenderer.invoke(IPC.install, name, force, agents),
  uninstall: (name: string) => ipcRenderer.invoke(IPC.uninstall, name),
  deregister: (name: string) => ipcRenderer.invoke(IPC.deregister, name),
  unregister: (name: string, destination: string) =>
    ipcRenderer.invoke(IPC.unregister, name, destination),
  hide: (name: string) => ipcRenderer.invoke(IPC.hide, name),
  unhide: (name: string) => ipcRenderer.invoke(IPC.unhide, name),
  acceptDrift: (name: string) => ipcRenderer.invoke(IPC.acceptDrift, name),
  forgetMissing: (name: string) =>
    ipcRenderer.invoke(IPC.forgetMissing, name),
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
  quitAndInstallUpdate: () => ipcRenderer.invoke(IPC.quitAndInstallUpdate),
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
  authSetPersonaConvenience: () =>
    ipcRenderer.invoke(IPC.authSetPersonaConvenience),
  authStartDeviceFlow: () => ipcRenderer.invoke(IPC.authStartDeviceFlow),
  authPollDeviceFlow: (flowId: string) =>
    ipcRenderer.invoke(IPC.authPollDeviceFlow, flowId),
  authCancelDeviceFlow: (flowId: string) =>
    ipcRenderer.invoke(IPC.authCancelDeviceFlow, flowId),
  authLogout: () => ipcRenderer.invoke(IPC.authLogout),
  reposListMine: () => ipcRenderer.invoke(IPC.reposListMine),
  reposReplaceRegistry: (fullName: string) =>
    ipcRenderer.invoke(IPC.reposReplaceRegistry, fullName),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.openExternal, url),
  openSelfHostDocs: () => ipcRenderer.invoke(IPC.openSelfHostDocs),
  exportRegistry: () => ipcRenderer.invoke(IPC.exportRegistry),
  importRegistry: () => ipcRenderer.invoke(IPC.importRegistry),
  repairBrokenLinks: (name: string) =>
    ipcRenderer.invoke(IPC.repairBrokenLinks, name),
  removeBrokenLinks: (name: string, agents: unknown) =>
    ipcRenderer.invoke(IPC.removeBrokenLinks, name, agents),
  resolveSkillConflicts: (name: string, decisions: unknown) =>
    ipcRenderer.invoke(IPC.resolveSkillConflicts, name, decisions),
  discoverShow: (bounds: Bounds) => ipcRenderer.invoke(IPC.discoverShow, bounds),
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
  showHeaderMenu: (context: unknown) =>
    ipcRenderer.invoke(IPC.showHeaderMenu, context),
  onHeaderMenuAction: (cb: (action: string) => void) => {
    const listener = (_e: unknown, action: string) => cb(action);
    ipcRenderer.on(IPC.headerMenuAction, listener);
    return () => ipcRenderer.removeListener(IPC.headerMenuAction, listener);
  },
};

contextBridge.exposeInMainWorld("skillsBank", api);
