import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  applyMigration,
  installSkill,
  listInstalled,
  loadIndex,
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
      preload: path.join(__dirname, "..", "main", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const indexHtml = path.join(__dirname, "..", "..", "dist", "index.html");
  void win.loadFile(indexHtml);
}

ipcMain.handle(IPC.getRoot, () => registryRoot);

ipcMain.handle(IPC.listRegistry, () => loadIndex(registryRoot).entries);

ipcMain.handle(IPC.listInstalled, () => listInstalled(registryRoot));

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

ipcMain.handle(IPC.rebuildIndex, async () => {
  return await new Promise<{ ok: boolean; message: string; entries: number }>(
    (resolve) => {
      const child = spawn("pnpm", ["run", "build:index"], {
        cwd: registryRoot,
        env: { ...process.env, FORCE_COLOR: "0" },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("error", (err) =>
        resolve({ ok: false, message: err.message, entries: 0 }),
      );
      child.on("close", (code) => {
        const match = stdout.match(/with (\d+) entries/);
        const entries = match && match[1] ? Number(match[1]) : 0;
        if (code === 0) {
          resolve({
            ok: true,
            message: `index rebuilt (${entries} entries)`,
            entries,
          });
        } else {
          resolve({
            ok: false,
            message: stderr.trim() || `build:index exited ${code}`,
            entries: 0,
          });
        }
      });
    },
  );
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
