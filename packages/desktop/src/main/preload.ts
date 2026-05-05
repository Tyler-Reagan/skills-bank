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
};

contextBridge.exposeInMainWorld("skillsBank", api);
