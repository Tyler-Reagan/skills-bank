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

// ─── Registry path resolution ───────────────────────────────────────────────
//
// Order: persisted user-data config > SKILLS_BANK_ROOT env > walk up from cwd.
// When packaged, only the first two ever succeed; the walk-up is for dev
// runs from inside the source tree.
//
// Result is exposed to the renderer via IPC.getConfig so it can show the
// first-run setup screen when nothing resolves to a valid registry.

interface AppConfig {
  registryRoot: string | null;
}

function configFilePath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

function readConfig(): AppConfig {
  const p = configFilePath();
  try {
    if (!fs.existsSync(p)) return { registryRoot: null };
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<AppConfig>;
    return {
      registryRoot:
        typeof raw.registryRoot === "string" ? raw.registryRoot : null,
    };
  } catch {
    return { registryRoot: null };
  }
}

function writeConfig(cfg: AppConfig): void {
  const p = configFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
}

function isValidRegistryRoot(candidate: string): {
  ok: boolean;
  reason?: string;
} {
  if (!candidate) return { ok: false, reason: "empty path" };
  if (!fs.existsSync(candidate)) {
    return { ok: false, reason: `path does not exist: ${candidate}` };
  }
  const pkgPath = path.join(candidate, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return {
      ok: false,
      reason: "no package.json in this folder — pick the skills-bank repo root",
    };
  }
  try {
    const data = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      name?: string;
    };
    if (data.name !== "skills-bank") {
      return {
        ok: false,
        reason: `package.json name is "${data.name ?? "(unset)"}", expected "skills-bank"`,
      };
    }
  } catch {
    return { ok: false, reason: "package.json is not valid JSON" };
  }
  if (!fs.existsSync(path.join(candidate, "skills"))) {
    return {
      ok: false,
      reason: "no skills/ directory inside the chosen folder",
    };
  }
  return { ok: true };
}

function resolveBootRegistryRoot(): string | null {
  const stored = readConfig().registryRoot;
  if (stored && isValidRegistryRoot(stored).ok) return stored;
  try {
    return resolveRegistryRoot(); // env var or cwd walk-up
  } catch {
    return null;
  }
}

let registryRoot: string | null = resolveBootRegistryRoot();

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

// Single guard for handlers that need a configured registry root.
const NO_ROOT_MSG = "Registry folder not configured. Use the Settings button to pick the skills-bank repo.";

ipcMain.handle(IPC.getRoot, () => registryRoot);

ipcMain.handle(IPC.getConfig, () => ({
  registryRoot,
  configValid: registryRoot !== null,
  isPackaged: app.isPackaged,
}));

ipcMain.handle(IPC.setRegistryRoot, async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win ?? undefined!, {
    title: "Choose your skills-bank repo folder",
    message: "Pick the skills-bank folder you cloned (must contain package.json with name 'skills-bank' and a skills/ directory).",
    properties: ["openDirectory"],
    defaultPath: registryRoot ?? app.getPath("home"),
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, message: "cancelled", registryRoot };
  }
  const candidate = result.filePaths[0]!;
  const validation = isValidRegistryRoot(candidate);
  if (!validation.ok) {
    return { ok: false, message: validation.reason ?? "invalid folder", registryRoot };
  }
  registryRoot = candidate;
  writeConfig({ registryRoot: candidate });
  return { ok: true, message: `registry set to ${candidate}`, registryRoot };
});

// Always rebuild from filesystem on every call. The on-disk index.json is a
// CI artifact, not the source of truth — this guarantees the UI reflects
// reality after migrations, manual edits, or any other state change without
// requiring the user to remember to rebuild.
ipcMain.handle(IPC.listRegistry, () => {
  if (!registryRoot) return [];
  return buildRegistryIndex(registryRoot, { writeFile: true }).entries;
});

ipcMain.handle(IPC.listInstalled, () => {
  if (!registryRoot) return listInstalled("", { index: { generatedAt: "", entries: [] } });
  const index = buildRegistryIndex(registryRoot);
  return listInstalled(registryRoot, { index });
});

ipcMain.handle(IPC.install, (_e, name: string, force?: boolean) => {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
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

// Uninstall doesn't need the registry — it just removes the symlink at
// ~/.claude/skills/<name>. Leave it functional even with no registry.
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

ipcMain.handle(IPC.scan, () => {
  if (!registryRoot) {
    return {
      claudeSkillsDir: "",
      registryRoot: "",
      entries: [],
      topLevelSymlink: null,
    };
  }
  return scanExistingInstalls(registryRoot);
});

ipcMain.handle(
  IPC.migrate,
  (_e, items: Array<{ name: string; action: MigrationAction }>) => {
    if (!registryRoot) {
      return items.map(({ action }) => ({
        action,
        ok: false,
        message: NO_ROOT_MSG,
      }));
    }
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
        registryRoot: registryRoot!,
        confirmDestructive: true,
      });
    });
  },
);

ipcMain.handle(IPC.rebuildIndex, () => {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG, entries: 0 };
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
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  return finalizeSkillsDir({ registryRoot, confirmDestructive: true });
});

ipcMain.handle(IPC.exportInfo, (_e, name: string) => {
  if (!registryRoot) throw new Error(NO_ROOT_MSG);
  return getExportInfo(registryRoot, name);
});

ipcMain.handle(IPC.exportSkill, async (_e, name: string) => {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
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
  if (!registryRoot) return null;
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
    if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
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
