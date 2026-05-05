import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMigration,
  buildRegistryIndex,
  exportSkill,
  finalizeSkillsDir,
  getExportInfo,
  installSkill,
  listInstalled,
  resolveRegistryRoot,
  scanExistingInstalls,
  uninstallSkill,
  type MigrationAction,
} from "@skills-bank/core";
import { IPC } from "../shared/ipc.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let registryRoot: string;
try {
  registryRoot = resolveRegistryRoot();
} catch {
  registryRoot = process.cwd();
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, "..", "main", "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const indexHtml = path.join(__dirname, "..", "..", "dist", "index.html");
  void win.loadFile(indexHtml);

  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: "right" });
  }
}

ipcMain.handle(IPC.getRoot, () => registryRoot);

// Always rebuild from filesystem on every call. The on-disk index.json is a
// CI artifact, not the source of truth — this guarantees the UI reflects
// reality after migrations, manual edits, or any other state change without
// requiring the user to remember to rebuild.
ipcMain.handle(IPC.listRegistry, () => {
  return buildRegistryIndex(registryRoot, { writeFile: true }).entries;
});

ipcMain.handle(IPC.listInstalled, () => {
  const index = buildRegistryIndex(registryRoot);
  return listInstalled(registryRoot, { index });
});

ipcMain.handle(IPC.install, (_e, name: string, force?: boolean) => {
  try {
    const r = installSkill(name, { registryRoot, force: force ?? false });
    return {
      ok: true,
      message: r.alreadyInstalled
        ? `${name} already installed`
        : `installed ${name} → ${r.target}`,
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
});

ipcMain.handle(IPC.uninstall, (_e, name: string) => {
  try {
    const r = uninstallSkill(name);
    return {
      ok: true,
      message: r.removed ? `removed ${name}` : `${name} not installed`,
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
});

ipcMain.handle(IPC.scan, () => scanExistingInstalls(registryRoot));

ipcMain.handle(
  IPC.migrate,
  (_e, items: Array<{ name: string; action: MigrationAction }>) => {
    const report = scanExistingInstalls(registryRoot);
    const byName = new Map(report.entries.map((e) => [e.name, e]));
    return items.map(({ name, action }) => {
      const entry = byName.get(name);
      if (!entry) {
        return {
          action,
          ok: false,
          message: `entry ${name} not found in scan`,
        };
      }
      return applyMigration(entry, action, {
        registryRoot,
        confirmDestructive: true,
      });
    });
  },
);

ipcMain.handle(IPC.rebuildIndex, () => {
  // In-process: no subprocess, no PATH dependency, no pnpm dependency.
  try {
    const index = buildRegistryIndex(registryRoot, {
      includeGitInfo: true,
      writeFile: true,
    });
    return {
      ok: true,
      message: `index rebuilt (${index.entries.length} entries)`,
      entries: index.entries.length,
    };
  } catch (err) {
    return {
      ok: false,
      message: (err as Error).message,
      entries: 0,
    };
  }
});

ipcMain.handle(IPC.finalize, () => {
  return finalizeSkillsDir({ registryRoot, confirmDestructive: true });
});

ipcMain.handle(IPC.exportInfo, (_e, name: string) => {
  return getExportInfo(registryRoot, name);
});

ipcMain.handle(IPC.exportSkill, async (_e, name: string) => {
  try {
    const info = getExportInfo(registryRoot, name);
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win ?? undefined!, {
      title: `Export ${name}`,
      defaultPath: info.suggestedFilename,
      filters:
        info.kind === "standalone"
          ? [{ name: "Markdown", extensions: ["md"] }]
          : [{ name: "Zip Archive", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, message: "export cancelled" };
    }
    const r = await exportSkill(registryRoot, name, result.filePath);
    return {
      ok: true,
      message: `exported ${name} (${r.kind}) → ${r.destPath}`,
      result: r,
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
});

void app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
