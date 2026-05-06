import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc.js";

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
};

contextBridge.exposeInMainWorld("skillsBank", api);
