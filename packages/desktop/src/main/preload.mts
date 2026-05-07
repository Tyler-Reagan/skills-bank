import { contextBridge, ipcRenderer } from "electron";
import { IPC, type SyncStatus, type UpdateStatus } from "../shared/ipc.js";

const api = {
  listRegistry: () => ipcRenderer.invoke(IPC.listRegistry),
  listInstalled: () => ipcRenderer.invoke(IPC.listInstalled),
  install: (name: string, force?: boolean) =>
    ipcRenderer.invoke(IPC.install, name, force),
  uninstall: (name: string) => ipcRenderer.invoke(IPC.uninstall, name),
  scan: () => ipcRenderer.invoke(IPC.scan),
  migrate: (items: unknown) => ipcRenderer.invoke(IPC.migrate, items),
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
  repairBrokenLinks: (name: string) =>
    ipcRenderer.invoke(IPC.repairBrokenLinks, name),
  removeBrokenLinks: (name: string, agents: unknown) =>
    ipcRenderer.invoke(IPC.removeBrokenLinks, name, agents),
};

contextBridge.exposeInMainWorld("skillsBank", api);
