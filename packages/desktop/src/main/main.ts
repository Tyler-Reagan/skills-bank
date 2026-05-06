import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
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

ipcMain.handle(IPC.readSkillMd, (_e, name: string) => {
  try {
    const index = buildRegistryIndex(registryRoot);
    const entry = index.entries.find((x) => x.name === name);
    if (!entry) return null;
    const skillMd = path.join(registryRoot, entry.path, "SKILL.md");
    if (!fs.existsSync(skillMd)) return null;
    const fd = fs.openSync(skillMd, "r");
    try {
      const buf = Buffer.alloc(8192);
      const bytes = fs.readSync(fd, buf, 0, 8192, 0);
      const total = fs.statSync(skillMd).size;
      const text = buf.subarray(0, bytes).toString("utf8");
      return total > bytes ? text + "\n\n…(truncated)" : text;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
});

ipcMain.handle(IPC.openInFinder, async (_e, absolutePath: string) => {
  await shell.openPath(absolutePath);
});

ipcMain.handle(
  IPC.editTags,
  (_e, name: string, tags: unknown): { ok: boolean; message: string } => {
    if (!Array.isArray(tags)) {
      return { ok: false, message: "tags must be an array" };
    }
    const cleaned: string[] = [];
    for (const t of tags) {
      if (typeof t !== "string") continue;
      const trimmed = t.trim();
      if (!trimmed) continue;
      if (trimmed.length > 64) {
        return { ok: false, message: `tag "${trimmed.slice(0, 24)}…" exceeds 64 chars` };
      }
      if (cleaned.includes(trimmed)) continue;
      cleaned.push(trimmed);
    }
    const index = buildRegistryIndex(registryRoot);
    const entry = index.entries.find((x) => x.name === name);
    if (!entry) {
      return { ok: false, message: `skill "${name}" not in registry` };
    }
    const metaPath = path.join(registryRoot, entry.path, "meta.json");
    if (!fs.existsSync(metaPath)) {
      return { ok: false, message: `meta.json missing at ${entry.path}` };
    }
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    } catch (err) {
      return { ok: false, message: `meta.json: ${(err as Error).message}` };
    }
    if (cleaned.length === 0) delete raw["tags"];
    else raw["tags"] = cleaned;
    try {
      fs.writeFileSync(metaPath, JSON.stringify(raw, null, 2) + "\n");
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
    return {
      ok: true,
      message: `tags updated (${cleaned.length})`,
    };
  },
);

void app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
