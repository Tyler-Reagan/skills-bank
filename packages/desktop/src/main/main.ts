import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  WebContentsView,
} from "electron";
// electron-updater is CJS; destructure from the default import to interop
// cleanly under Node's ESM loader (NodeNext module resolution).
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyCanonicalSync,
  applyMigration,
  buildRegistryIndex,
  exportSkill,
  fetchCanonicalTarball,
  finalizeSkillsDir,
  getExportInfo,
  installSkill,
  listInstalled,
  readLastSyncReport,
  readPendingConflicts,
  readSyncDecisions,
  resolveRegistryRoot,
  scanExistingInstalls,
  uninstallSkill,
  removeBrokenLinks,
  repairBrokenLinks,
  resolveSkillConflicts,
  writeSyncDecisions,
  AGENTS,
  getAgentSkillsDir,
  type AgentId,
  type InstalledKind,
  type MigrationAction,
  type SyncDecisions,
} from "@skills-bank/core";
import {
  IPC,
  type AuthStatus,
  type Bounds,
  type DiscoverStatus,
  type SyncStatus,
  type UpdateStatus,
  type UserRepo,
} from "../shared/ipc.js";
import {
  cancelDeviceFlow,
  clearStoredToken,
  DeviceFlowError,
  getCurrentUser,
  getStoredToken,
  pollDeviceFlow,
  startDeviceFlow,
} from "./auth.js";
import { isAuthConfigured } from "./auth-config.js";
import { writeSkillSource } from "@skills-bank/core";

const CANONICAL_OWNER = "Tyler-Reagan";
const CANONICAL_REPO = "skills-bank";

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

export type Persona = "convenience" | "power";

interface AppConfig {
  registryRoot: string | null;
  persona: Persona | null;
}

function configFilePath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

function readConfig(): AppConfig {
  const p = configFilePath();
  try {
    if (!fs.existsSync(p)) return { registryRoot: null, persona: null };
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<AppConfig>;
    return {
      registryRoot:
        typeof raw.registryRoot === "string" ? raw.registryRoot : null,
      persona:
        raw.persona === "convenience" || raw.persona === "power"
          ? raw.persona
          : null,
    };
  } catch {
    return { registryRoot: null, persona: null };
  }
}

function writeConfig(cfg: AppConfig): void {
  const p = configFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
}

// Loose validator: accept any existing directory. The persona model treats
// the registry as a folder of skills, not as a clone of a specific repo, so
// the strict "package.json name must be skills-bank" check is gone. Folders
// without a `skills/` subdir simply render as empty until the user adds
// skills (or a sync populates it).
function isValidRegistryRoot(candidate: string): {
  ok: boolean;
  reason?: string;
} {
  if (!candidate) return { ok: false, reason: "empty path" };
  if (!fs.existsSync(candidate)) {
    return { ok: false, reason: `path does not exist: ${candidate}` };
  }
  if (!fs.statSync(candidate).isDirectory()) {
    return { ok: false, reason: `not a directory: ${candidate}` };
  }
  return { ok: true };
}

// Default location for the convenience-persona registry: app-managed,
// survives app upgrades, ready for canonical sync to populate it.
function defaultManagedRegistryRoot(): string {
  const root = path.join(app.getPath("userData"), "registry");
  fs.mkdirSync(path.join(root, "skills"), { recursive: true });
  return root;
}

function resolveBootRegistryRoot(): string {
  const stored = readConfig().registryRoot;
  if (stored && isValidRegistryRoot(stored).ok) return stored;
  // SKILLS_BANK_ROOT env or a cwd walk-up takes precedence over the managed
  // default — preserves dev workflow where the developer points at the
  // canonical repo on disk.
  try {
    return resolveRegistryRoot();
  } catch {
    return defaultManagedRegistryRoot();
  }
}

let registryRoot: string = resolveBootRegistryRoot();

// Resolve persona at boot. If the dev override (SKILLS_BANK_ROOT) is set,
// silently treat the install as convenience-persona — devs running against
// the canonical repo on disk shouldn't see the LoginScreen. Any explicit
// stored persona wins.
function resolveBootPersona(): Persona | null {
  const stored = readConfig().persona;
  if (stored) return stored;
  if (process.env["SKILLS_BANK_ROOT"]) {
    writeConfig({ registryRoot, persona: "convenience" });
    return "convenience";
  }
  return null;
}

let persona: Persona | null = resolveBootPersona();

// Source PNG used for window/dock icons in dev. Packaged macOS builds use
// the .icns embedded by electron-builder; Windows uses the .ico.
const iconPng = path.join(__dirname, "..", "..", "build", "icon.png");

// ─── Discover tab: embedded skills.sh WebContentsView ───────────────────────
//
// We embed skills.sh as a top-level WebContentsView (not an iframe — they
// send `X-Frame-Options: DENY`). The view is lazy-created on first show,
// reused across show/hide so back-history and scroll persist, and lives
// in its own `persist:skills-sh` session so its cookies/cache stay isolated
// from the rest of the app.
//
// Bounds come from the renderer (placeholder `getBoundingClientRect()`) and
// are coordinates relative to the BrowserWindow's contentView, which is
// what `view.setBounds` expects on macOS / Windows / Linux Electron 32.

const DISCOVER_HOME = "https://skills.sh";
const DISCOVER_HOSTS = new Set(["skills.sh", "www.skills.sh"]);

let discoverView: WebContentsView | null = null;
let discoverAttached = false;
let discoverCurrentUrl = DISCOVER_HOME;

function broadcastDiscoverStatus(status: DiscoverStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.discoverStatus, status);
  }
}

function ensureDiscoverView(parent: BrowserWindow): WebContentsView {
  if (discoverView) return discoverView;
  const view = new WebContentsView({
    webPreferences: {
      partition: "persist:skills-sh",
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (e, url) => {
    try {
      const host = new URL(url).hostname;
      if (!DISCOVER_HOSTS.has(host)) {
        e.preventDefault();
        void shell.openExternal(url);
      }
    } catch {
      // Malformed URL — let Chromium handle / reject.
    }
  });
  wc.on("did-start-loading", () => {
    broadcastDiscoverStatus({ kind: "loading", url: discoverCurrentUrl });
  });
  wc.on("did-navigate", (_e, url) => {
    discoverCurrentUrl = url;
    broadcastDiscoverStatus({
      kind: "ready",
      url,
      canGoBack: wc.navigationHistory.canGoBack(),
    });
  });
  wc.on("did-navigate-in-page", (_e, url, isMainFrame) => {
    if (!isMainFrame) return;
    discoverCurrentUrl = url;
    broadcastDiscoverStatus({
      kind: "ready",
      url,
      canGoBack: wc.navigationHistory.canGoBack(),
    });
  });
  wc.on("did-finish-load", () => {
    broadcastDiscoverStatus({
      kind: "ready",
      url: discoverCurrentUrl,
      canGoBack: wc.navigationHistory.canGoBack(),
    });
  });
  wc.on("did-fail-load", (_e, errorCode, description, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (errorCode === -3) return; // ERR_ABORTED — fires on every reload, ignore.
    broadcastDiscoverStatus({
      kind: "error",
      url: validatedURL || discoverCurrentUrl,
      errorCode,
      description,
    });
  });
  parent.on("closed", () => {
    discoverView = null;
    discoverAttached = false;
  });
  discoverView = view;
  void wc.loadURL(DISCOVER_HOME);
  return view;
}

function intBounds(b: Bounds): Electron.Rectangle {
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.max(0, Math.round(b.width)),
    height: Math.max(0, Math.round(b.height)),
  };
}

ipcMain.handle(IPC.discoverShow, (_e, bounds: Bounds) => {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!win) return;
  const view = ensureDiscoverView(win);
  view.setBounds(intBounds(bounds));
  view.setVisible(true);
  if (!discoverAttached) {
    win.contentView.addChildView(view);
    discoverAttached = true;
  }
});

ipcMain.handle(IPC.discoverHide, () => {
  if (!discoverView) return;
  // Visibility-toggle (cheap), keep the view attached so back-history and
  // scroll persist. We zero the bounds too so the view doesn't capture clicks
  // in the rare case Chromium ignores `setVisible` on a child.
  discoverView.setVisible(false);
  discoverView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
});

ipcMain.handle(IPC.discoverSetBounds, (_e, bounds: Bounds) => {
  if (!discoverView) return;
  discoverView.setBounds(intBounds(bounds));
});

ipcMain.handle(IPC.discoverGoBack, () => {
  if (!discoverView) return;
  const h = discoverView.webContents.navigationHistory;
  if (h.canGoBack()) h.goBack();
});

ipcMain.handle(IPC.discoverReload, () => {
  if (!discoverView) {
    // Reload before first show = retry from a previous error without an
    // attached view. Recreate lazily on next show; emit a transient loading
    // ping so the renderer knows we acknowledged.
    broadcastDiscoverStatus({ kind: "loading", url: DISCOVER_HOME });
    return;
  }
  void discoverView.webContents.loadURL(DISCOVER_HOME);
});

ipcMain.handle(IPC.discoverOpenExternal, async () => {
  await shell.openExternal(discoverCurrentUrl);
});

ipcMain.handle(IPC.discoverOpenTerminal, async () => {
  // Detached spawn so the terminal process outlives our app session and
  // doesn't block on stdio. Cwd is the registry root if known so the user
  // lands somewhere skill-relevant; otherwise the process default.
  const cwd = registryRoot ?? undefined;
  try {
    if (process.platform === "darwin") {
      // `open -a Terminal <path>` opens the system terminal at that dir.
      const args = ["-a", "Terminal"];
      if (cwd) args.push(cwd);
      spawn("open", args, { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "win32") {
      // `start ""` consumes the title arg so the path isn't taken as one.
      // Falls back to cmd if Windows Terminal isn't installed.
      const command = cwd
        ? `start "" wt.exe -d "${cwd}" || start "" cmd.exe /K cd /D "${cwd}"`
        : `start "" wt.exe || start "" cmd.exe`;
      spawn("cmd.exe", ["/c", command], { detached: true, stdio: "ignore" }).unref();
    } else {
      // Linux best-effort. Most distros ship `x-terminal-emulator` (Debian)
      // or expose one of the common emulators on PATH.
      const candidates = ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"];
      let launched = false;
      for (const bin of candidates) {
        try {
          const child = spawn(bin, cwd ? ["--working-directory", cwd] : [], {
            detached: true,
            stdio: "ignore",
          });
          child.unref();
          launched = true;
          break;
        } catch {
          // try next candidate
        }
      }
      if (!launched) {
        return { ok: false, message: "no terminal emulator found on PATH" };
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
});

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    icon: iconPng,
    webPreferences: {
      preload: path.join(__dirname, "..", "main", "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const indexHtml = path.join(__dirname, "..", "..", "dist", "index.html");
  void win.loadFile(indexHtml);

  // DevTools is opt-in via env var to keep `pnpm desktop:dev` quiet.
  // Cmd+Alt+I (View → Toggle Developer Tools) still summons it on demand
  // because we don't override Electron's default menu.
  if (process.env["SKILLS_BANK_DEVTOOLS"] === "1") {
    win.webContents.openDevTools({ mode: "right" });
  }
}

// Single guard for handlers that need a configured registry root.
const NO_ROOT_MSG =
  "Registry folder not configured. Use the Settings button to pick the skills-bank repo.";

ipcMain.handle(IPC.getRoot, () => registryRoot);

ipcMain.handle(IPC.getConfig, () => ({
  registryRoot,
  configValid: registryRoot !== null,
  isPackaged: app.isPackaged,
  persona,
}));

ipcMain.handle(IPC.setRegistryRoot, async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win ?? undefined!, {
    title: "Choose your skills-bank repo folder",
    message:
      "Pick the skills-bank folder you cloned (must contain package.json with name 'skills-bank' and a skills/ directory).",
    properties: ["openDirectory"],
    defaultPath: registryRoot ?? app.getPath("home"),
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, message: "cancelled", registryRoot };
  }
  const candidate = result.filePaths[0]!;
  const validation = isValidRegistryRoot(candidate);
  if (!validation.ok) {
    return {
      ok: false,
      message: validation.reason ?? "invalid folder",
      registryRoot,
    };
  }
  registryRoot = candidate;
  writeConfig({ registryRoot: candidate, persona });
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
  if (!registryRoot)
    return listInstalled("", { index: { generatedAt: "", entries: [] } });
  const index = buildRegistryIndex(registryRoot);
  return listInstalled(registryRoot, { index });
});

ipcMain.handle(
  IPC.install,
  (_e, name: string, force?: boolean, agents?: AgentId[]) => {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  try {
    const r = installSkill(name, {
      registryRoot,
      force: force ?? false,
      ...(agents && agents.length > 0 ? { agents } : {}),
    });
    const wrote = r.installs.filter((i) => !i.alreadyInstalled);
    if (wrote.length > 0) {
      return {
        ok: true,
        message: `installed ${name} for ${wrote.length} agent(s)`,
      };
    }
    if (r.installs.length > 0) {
      return { ok: true, message: `${name} already installed` };
    }
    return {
      ok: false,
      message: r.errors[0]?.message ?? `nothing installed for ${name}`,
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  },
);

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
    // Prefer the most actionable entry per name when a skill exists in
    // multiple agent dirs. Adopt and setAgents both need a usable
    // source, so prioritise: real-directory (actual content) > ours
    // (working symlink to registry) > foreign-symlink > broken-symlink.
    // Without this, a naive Map keyed by name silently overwrites the
    // useful real-dir entry with whatever sorted last (often a broken
    // claude symlink), making realpath calls explode downstream.
    const kindRank: Record<InstalledKind, number> = {
      "real-directory": 4,
      ours: 3,
      "foreign-symlink": 2,
      "broken-symlink": 1,
    };
    const byName = new Map<string, (typeof report.entries)[number]>();
    for (const e of report.entries) {
      const existing = byName.get(e.name);
      if (!existing || kindRank[e.kind] > kindRank[existing.kind]) {
        byName.set(e.name, e);
      }
    }
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

// Finalize every agent skills dir whose top-level is a symlink. Aggregates
// results so the UI sees one combined ok/message rather than per-agent.
ipcMain.handle(IPC.finalize, () => {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  const report = scanExistingInstalls(registryRoot);
  if (report.topLevelSymlinks.length === 0) {
    return {
      ok: false,
      message: "No agent skills directories are top-level symlinks.",
    };
  }
  const results = report.topLevelSymlinks.map((tls) =>
    finalizeSkillsDir({
      registryRoot,
      agent: tls.agent,
      confirmDestructive: true,
    }),
  );
  const allOk = results.every((r) => r.ok);
  const summary = results
    .map((r, i) => {
      const tls = report.topLevelSymlinks[i]!;
      return `${tls.agent}: ${r.message}`;
    })
    .join("; ");
  const blockingEntries = results.flatMap((r) => r.blockingEntries ?? []);
  return {
    ok: allOk,
    message: summary,
    ...(blockingEntries.length > 0 ? { blockingEntries } : {}),
  };
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

// Read up to 8 KB of SKILL.md text, with a "…(truncated)" marker when
// the file is bigger. Pulled out so the readSkillMd IPC can reuse it
// against any candidate path (registry copy or agent dir).
function readSkillMdText(skillMdPath: string): string | null {
  if (!fs.existsSync(skillMdPath)) return null;
  const fd = fs.openSync(skillMdPath, "r");
  try {
    const buf = Buffer.alloc(8192);
    const bytes = fs.readSync(fd, buf, 0, 8192, 0);
    const total = fs.statSync(skillMdPath).size;
    const text = buf.subarray(0, bytes).toString("utf8");
    return total > bytes ? text + "\n\n…(truncated)" : text;
  } finally {
    fs.closeSync(fd);
  }
}

// Resolve SKILL.md for `name` by checking the registry first (if the
// skill is registered there) and then walking every known agent dir.
// This makes the drawer preview work for not-yet-registered skills
// whose actual content lives at e.g. `~/.agents/skills/<name>/SKILL.md`
// after a `npx skills add` install.
ipcMain.handle(IPC.readSkillMd, (_e, name: string) => {
  if (!registryRoot) return null;
  try {
    const index = buildRegistryIndex(registryRoot);
    const entry = index.entries.find((x) => x.name === name);
    if (entry) {
      const fromRegistry = readSkillMdText(
        path.join(registryRoot, entry.path, "SKILL.md"),
      );
      if (fromRegistry !== null) return fromRegistry;
    }
    for (const agent of AGENTS) {
      const candidate = path.join(getAgentSkillsDir(agent), name, "SKILL.md");
      const text = readSkillMdText(candidate);
      if (text !== null) return text;
    }
    return null;
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
        return {
          ok: false,
          message: `tag "${trimmed.slice(0, 24)}…" exceeds 64 chars`,
        };
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
      message: `Tags updated (${cleaned.length})`,
    };
  },
);

// ─── Auto-updates ───────────────────────────────────────────────────────────
//
// Auto-update is intentionally a no-op outside packaged builds: electron-updater
// can't resolve a version when running from `pnpm dev`. The renderer subscribes
// to `IPC.updateStatus` to surface state. Update check pulls from the GitHub
// Releases feed configured in package.json `build.publish`.
//
// Registry decoupling: this only swaps the app bundle. The user's chosen
// registryRoot lives in app.getPath("userData")/config.json, which Electron
// preserves across upgrades.

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function broadcastUpdateStatus(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.updateStatus, status);
  }
}

function wireAutoUpdater(): void {
  if (!app.isPackaged) return;
  autoUpdater.on("checking-for-update", () => {
    broadcastUpdateStatus({ kind: "checking" });
  });
  autoUpdater.on("update-available", (info) => {
    broadcastUpdateStatus({ kind: "available", version: info.version });
  });
  autoUpdater.on("update-not-available", (info) => {
    broadcastUpdateStatus({
      kind: "not-available",
      currentVersion: info.version,
    });
  });
  autoUpdater.on("download-progress", (p) => {
    broadcastUpdateStatus({ kind: "downloading", percent: p.percent });
  });
  autoUpdater.on("update-downloaded", (info) => {
    broadcastUpdateStatus({ kind: "downloaded", version: info.version });
  });
  autoUpdater.on("error", (err) => {
    broadcastUpdateStatus({
      kind: "error",
      message: err.message ?? String(err),
    });
  });
}

ipcMain.handle(IPC.checkForUpdates, async () => {
  if (!app.isPackaged) {
    const reason = "auto-update is disabled in dev (not a packaged build)";
    broadcastUpdateStatus({ kind: "disabled", reason });
    return { ok: false, message: reason };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true, message: "checking for updates" };
  } catch (err) {
    const message = (err as Error).message;
    broadcastUpdateStatus({ kind: "error", message });
    return { ok: false, message };
  }
});

ipcMain.handle(IPC.quitAndInstallUpdate, () => {
  if (!app.isPackaged) return;
  autoUpdater.quitAndInstall();
});

// ─── Canonical registry sync (M2) ───────────────────────────────────────────
//
// Pulls Tyler-Reagan/skills-bank as a tarball, upserts canonical skills into
// the active registryRoot, and queues conflicts for the M5 resolver. The
// renderer subscribes to `syncStatus` for progress; results are also
// persisted at <registryRoot>/.skills-bank/last-sync.json.
//
// Note: we do not gate this on persona — when M3 ships, the renderer will
// hide the Sync button for power persona. The handler stays usable so a
// power user could in principle still run it; nothing here writes outside
// of the app-managed registry.

function broadcastSyncStatus(status: SyncStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.syncStatus, status);
  }
}

async function runSync(): Promise<{ ok: boolean; message: string }> {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  try {
    broadcastSyncStatus({ kind: "fetching" });
    const fetched = await fetchCanonicalTarball({
      owner: CANONICAL_OWNER,
      repo: CANONICAL_REPO,
    });
    try {
      broadcastSyncStatus({ kind: "applying" });
      const decisions = readSyncDecisions(registryRoot);
      const report = await applyCanonicalSync(
        registryRoot,
        fetched.extractedRoot,
        fetched.commitSha,
        decisions,
      );
      broadcastSyncStatus({
        kind: "done",
        upserted: report.upserted.length,
        conflicts: report.conflicts.length,
        orphaned: report.orphaned.length,
        commitSha: report.commitSha,
      });
      return {
        ok: true,
        message: `synced ${report.upserted.length} skill(s)${
          report.conflicts.length > 0
            ? `, ${report.conflicts.length} conflict(s) pending`
            : ""
        }${
          report.resolved.length > 0
            ? `, ${report.resolved.length} auto-resolved`
            : ""
        }`,
      };
    } finally {
      fetched.cleanup();
    }
  } catch (err) {
    const message = (err as Error).message;
    broadcastSyncStatus({ kind: "error", message });
    return { ok: false, message };
  }
}

ipcMain.handle(IPC.syncCanonical, () => runSync());

ipcMain.handle(IPC.getSyncReport, () => {
  if (!registryRoot) return null;
  return readLastSyncReport(registryRoot);
});

ipcMain.handle(IPC.getPendingConflicts, () => {
  if (!registryRoot) return null;
  return readPendingConflicts(registryRoot);
});

// Persist user choices and immediately re-run sync so the resolutions
// take effect without a separate user action. The re-run consumes the
// just-written decisions via readSyncDecisions inside runSync.
ipcMain.handle(IPC.resolveConflicts, async (_e, decisions: SyncDecisions) => {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  try {
    writeSyncDecisions(registryRoot, decisions);
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  return runSync();
});

// ─── Auth + persona (M3) ────────────────────────────────────────────────────
//
// Persona drives which features the renderer surfaces. Convenience users get
// the canonical Sync flow (M2/M5); power users get the M4 registry-replace
// flow. Persona = null means first-launch and the renderer shows LoginScreen.

async function buildAuthStatus(): Promise<AuthStatus> {
  const user = persona === "power" ? await getCurrentUser() : null;
  return {
    persona,
    isAuthConfigured: isAuthConfigured(),
    user,
  };
}

ipcMain.handle(IPC.authStatus, () => buildAuthStatus());

ipcMain.handle(IPC.authSetPersonaConvenience, async () => {
  persona = "convenience";
  writeConfig({ registryRoot, persona });
  return buildAuthStatus();
});

ipcMain.handle(IPC.authStartDeviceFlow, async () => {
  return startDeviceFlow();
});

ipcMain.handle(IPC.authPollDeviceFlow, async (_e, flowId: string) => {
  try {
    await pollDeviceFlow(flowId);
    persona = "power";
    writeConfig({ registryRoot, persona });
    return await buildAuthStatus();
  } catch (err) {
    if (err instanceof DeviceFlowError) {
      throw new Error(`device-flow:${err.code}:${err.message}`);
    }
    throw err;
  }
});

ipcMain.handle(IPC.authCancelDeviceFlow, (_e, flowId: string) => {
  cancelDeviceFlow(flowId);
});

ipcMain.handle(IPC.authLogout, async () => {
  clearStoredToken();
  persona = null;
  writeConfig({ registryRoot, persona });
  return buildAuthStatus();
});

// ─── User repos + registry replace (M4) ─────────────────────────────────────

async function ghFetch(
  pathSuffix: string,
  init?: RequestInit,
): Promise<Response> {
  const token = getStoredToken();
  if (!token) throw new Error("not authenticated");
  return fetch(`https://api.github.com${pathSuffix}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "skills-bank",
    },
  });
}

ipcMain.handle(IPC.reposListMine, async (): Promise<UserRepo[]> => {
  const out: UserRepo[] = [];
  // Up to 3 pages (300 repos) — enough for nearly every user.
  for (let page = 1; page <= 3; page++) {
    const res = await ghFetch(
      `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
    );
    if (!res.ok) {
      throw new Error(`GitHub /user/repos: ${res.status}`);
    }
    const repos = (await res.json()) as Array<{
      full_name: string;
      private: boolean;
      default_branch: string;
      description: string | null;
    }>;
    for (const r of repos) {
      out.push({
        fullName: r.full_name,
        isPrivate: r.private,
        defaultBranch: r.default_branch,
        description: r.description ?? null,
      });
    }
    if (repos.length < 100) break;
  }
  return out;
});

ipcMain.handle(IPC.reposReplaceRegistry, async (_e, fullName: string) => {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  const token = getStoredToken();
  if (!token) return { ok: false, message: "not authenticated" };
  const slash = fullName.indexOf("/");
  if (slash <= 0) {
    return { ok: false, message: `invalid repo: ${fullName}` };
  }
  const owner = fullName.slice(0, slash);
  const repo = fullName.slice(slash + 1);

  let fetched;
  try {
    fetched = await fetchCanonicalTarball({ owner, repo, token });
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  try {
    const skillsDir = path.join(fetched.extractedRoot, "skills");
    if (!fs.existsSync(skillsDir)) {
      return {
        ok: false,
        message: `${fullName} has no skills/ directory at the repo root`,
      };
    }
    // Wipe the existing local registry skills/ wholesale; the power
    // persona is "replace, don't merge."
    const localSkillsDir = path.join(registryRoot, "skills");
    fs.rmSync(localSkillsDir, { recursive: true, force: true });
    fs.mkdirSync(localSkillsDir, { recursive: true });

    const importedAt = new Date().toISOString();
    let count = 0;
    for (const ent of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const src = path.join(skillsDir, ent.name);
      const dest = path.join(localSkillsDir, ent.name);
      fs.cpSync(src, dest, { recursive: true });
      writeSkillSource(dest, {
        source: "imported",
        syncedFromCommit: fetched.commitSha,
        syncedAt: importedAt,
      });
      count++;
    }
    // Clear M2 sync state so any prior canonical state doesn't leak in.
    const stateDir = path.join(registryRoot, ".skills-bank");
    for (const f of [
      "last-sync.json",
      "pending-conflicts.json",
      "sync-decisions.json",
    ]) {
      const p = path.join(stateDir, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    return {
      ok: true,
      message: `imported ${count} skill(s) from ${fullName}`,
      importedCount: count,
    };
  } finally {
    fetched.cleanup();
  }
});

ipcMain.handle(IPC.openExternal, async (_e, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle(IPC.repairBrokenLinks, (_e, name: string) => {
  if (!registryRoot)
    return { repaired: [], unrepairable: [{ agent: "claude", linkPath: "", reason: NO_ROOT_MSG }] };
  return repairBrokenLinks(registryRoot, name);
});

ipcMain.handle(
  IPC.removeBrokenLinks,
  (_e, name: string, agents: AgentId[]) => {
    if (!registryRoot)
      return { removed: [], errors: [{ agent: "claude", message: NO_ROOT_MSG }] };
    return removeBrokenLinks(registryRoot, name, agents);
  },
);

ipcMain.handle(
  IPC.resolveSkillConflicts,
  (_e, name: string, decisions: import("@skills-bank/core").ConflictResolveDecision[]) => {
    if (!registryRoot) {
      return {
        applied: [],
        errors: decisions.map((d) => ({
          agent: d.agent,
          action: d.action,
          message: NO_ROOT_MSG,
        })),
      };
    }
    return resolveSkillConflicts(registryRoot, name, decisions);
  },
);


// Open docs/self-host.md. Prefer the GitHub-hosted URL (renders nicely
// for installed users post-merge) and fall back to the locally bundled
// copy if GitHub returns 404 (the docs file isn't on main yet) or the
// user is offline. The docs/ tree is bundled via electron-builder's
// `extraResources` for packaged builds; in dev we resolve relative to
// the desktop package's app path (`<repo>/packages/desktop/`).
const SELF_HOST_URL =
  "https://github.com/Tyler-Reagan/skills-bank/blob/main/docs/self-host.md";

async function selfHostUrlReachable(): Promise<boolean> {
  try {
    const res = await fetch(SELF_HOST_URL, {
      method: "HEAD",
      // GitHub redirects unauthenticated HEAD on private/missing pages —
      // accept the redirect chain and check the terminal status.
      redirect: "follow",
    });
    return res.ok;
  } catch {
    return false;
  }
}

ipcMain.handle(IPC.openSelfHostDocs, async () => {
  if (await selfHostUrlReachable()) {
    await shell.openExternal(SELF_HOST_URL);
    return { ok: true };
  }
  const docPath = app.isPackaged
    ? path.join(process.resourcesPath, "docs", "self-host.md")
    : path.join(app.getAppPath(), "..", "..", "docs", "self-host.md");
  if (!fs.existsSync(docPath)) {
    return { ok: false, message: `self-host docs not found at ${docPath}` };
  }
  const error = await shell.openPath(docPath);
  if (error) return { ok: false, message: error };
  return { ok: true };
});

void app.whenReady().then(() => {
  // macOS dev: dock icon comes from the binary (Electron's default) until we
  // override. Packaged .app gets its dock icon from the bundle's .icns.
  if (process.platform === "darwin" && !app.isPackaged && fs.existsSync(iconPng)) {
    app.dock?.setIcon(iconPng);
  }
  wireAutoUpdater();
  createWindow();
  if (app.isPackaged) {
    // Fire-and-forget: any error broadcasts to the renderer via the error event.
    void autoUpdater.checkForUpdates();
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
