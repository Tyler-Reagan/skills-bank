import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  shell,
  WebContentsView,
} from "electron";
import type { MenuItemConstructorOptions } from "electron";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fromCaught } from "@skills-bank/core";
import { getStorageBackend } from "./auth.js";
import {
  getDismissedUpdateVersion,
  getRegistryRoot,
  persistConfig,
  readConfig,
  setDismissedUpdateVersion,
} from "./main-state.js";

import {
  IPC,
  type Bounds,
  type DiscoverStatus,
  type HeaderMenuAction,
  type UpdateStatus,
} from "../shared/ipc.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Source PNG used for window/dock icons in dev.
export const iconPng = path.join(__dirname, "..", "..", "build", "icon.png");

// ─── Discover tab ─────────────────────────────────────────────────────────────

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
  wc.on(
    "did-fail-load",
    (_e, errorCode, description, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      if (errorCode === -3) return; // ERR_ABORTED — fires on every reload, ignore.
      broadcastDiscoverStatus({
        kind: "error",
        url: validatedURL || discoverCurrentUrl,
        errorCode,
        description,
      });
    },
  );
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

function hideDiscoverView(): void {
  if (!discoverView) return;
  discoverView.setVisible(false);
  discoverView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
}

// ─── Auto-updates ─────────────────────────────────────────────────────────────

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

let lastUpdateInfo: {
  version: string;
  releaseNotes: string | null;
  releaseName: string | null;
} | null = null;

function broadcastUpdateStatus(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.updateStatus, status);
  }
}

function normalizeNotes(
  raw: string | Array<{ version: string; note: string | null }> | null,
): string | null {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    const parts = raw
      .map((r) => {
        const body = r.note?.trim();
        return body ? `## v${r.version}\n\n${body}` : null;
      })
      .filter((s): s is string => s !== null);
    return parts.length > 0 ? parts.join("\n\n") : null;
  }
  return null;
}

export function wireAutoUpdater(): void {
  if (!app.isPackaged) return;
  autoUpdater.on("checking-for-update", () => {
    broadcastUpdateStatus({ kind: "checking" });
  });
  autoUpdater.on("update-available", (info) => {
    lastUpdateInfo = {
      version: info.version,
      releaseNotes: normalizeNotes(info.releaseNotes ?? null),
      releaseName: info.releaseName ?? null,
    };
    broadcastUpdateStatus({ kind: "available", ...lastUpdateInfo });
  });
  autoUpdater.on("update-not-available", (info) => {
    broadcastUpdateStatus({
      kind: "not-available",
      currentVersion: info.version,
    });
  });
  autoUpdater.on("download-progress", (p) => {
    broadcastUpdateStatus({
      kind: "downloading",
      percent: p.percent,
      version: lastUpdateInfo?.version ?? "",
      releaseNotes: lastUpdateInfo?.releaseNotes ?? null,
      releaseName: lastUpdateInfo?.releaseName ?? null,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    lastUpdateInfo = {
      version: info.version,
      releaseNotes: normalizeNotes(info.releaseNotes ?? null),
      releaseName: info.releaseName ?? null,
    };
    broadcastUpdateStatus({ kind: "downloaded", ...lastUpdateInfo });
  });
  autoUpdater.on("error", (err) => {
    broadcastUpdateStatus({
      kind: "error",
      message: err.message ?? String(err),
    });
  });
}

// ─── App menu ─────────────────────────────────────────────────────────────────

export function buildAppMenu(): Menu {
  const send = (action: HeaderMenuAction) => {
    const win =
      BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (win) win.webContents.send(IPC.headerMenuAction, action);
  };

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Settings",
          accelerator: "CmdOrCtrl+,",
          click: () => send("openSettings"),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Check for Skill Updates",
          click: () => send("checkSkillUpdates"),
        },
        { type: "separator" },
        ...(app.isPackaged
          ? []
          : [{ role: "toggleDevTools" } as MenuItemConstructorOptions]),
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

// ─── Window creation ──────────────────────────────────────────────────────────

export function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 880,
    minHeight: 600,
    icon: iconPng,
    title: app.getName(),
    webPreferences: {
      preload: path.join(__dirname, "..", "main", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (!app.isPackaged) {
    win.on("page-title-updated", (event) => event.preventDefault());
  }
  const indexHtml = path.join(__dirname, "..", "..", "dist", "index.html");
  void win.loadFile(indexHtml);

  if (process.env["SKILLS_BANK_DEVTOOLS"] === "1") {
    win.webContents.openDevTools({ mode: "right" });
  }
}

// ─── Self-host docs ───────────────────────────────────────────────────────────

const SELF_HOST_URL = "https://skills-bank-desktop.vercel.app/self-host";

async function selfHostUrlReachable(): Promise<boolean> {
  try {
    const res = await fetch(SELF_HOST_URL, {
      method: "HEAD",
      redirect: "follow",
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── URL safety guard ─────────────────────────────────────────────────────────

export function isSafeExternalUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length === 0) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

// ─── Register handlers ────────────────────────────────────────────────────────

export function registerShellHandlers(): void {
  // ─── Discover handlers ─────────────────────────────────────────────────────

  ipcMain.handle(IPC.discoverShow, (_e, bounds: Bounds) => {
    const win =
      BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!win) return;
    const view = ensureDiscoverView(win);
    view.setBounds(intBounds(bounds));
    view.setVisible(true);
    if (!discoverAttached) {
      win.contentView.addChildView(view);
      discoverAttached = true;
    }
    const wc = view.webContents;
    broadcastDiscoverStatus(
      wc.isLoading()
        ? { kind: "loading", url: discoverCurrentUrl }
        : {
            kind: "ready",
            url: discoverCurrentUrl,
            canGoBack: wc.navigationHistory.canGoBack(),
          },
    );
  });

  ipcMain.handle(IPC.discoverHide, () => {
    hideDiscoverView();
  });

  ipcMain.on(IPC.discoverHideSync, (event) => {
    hideDiscoverView();
    event.returnValue = null;
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
      broadcastDiscoverStatus({ kind: "loading", url: DISCOVER_HOME });
      return;
    }
    void discoverView.webContents.loadURL(DISCOVER_HOME);
  });

  ipcMain.handle(IPC.discoverOpenExternal, async () => {
    await shell.openExternal(discoverCurrentUrl);
  });

  ipcMain.handle(IPC.discoverOpenTerminal, async (_e, terminalApp?: string) => {
    const cwd = getRegistryRoot() ?? undefined;
    try {
      if (process.platform === "darwin") {
        const appName =
          terminalApp === "iterm2"
            ? "iTerm"
            : terminalApp === "warp"
              ? "Warp"
              : terminalApp === "hyper"
                ? "Hyper"
                : terminalApp === "alacritty"
                  ? "Alacritty"
                  : terminalApp === "kitty"
                    ? "kitty"
                    : "Terminal";
        const args = ["-a", appName];
        if (cwd) args.push(cwd);
        spawn("open", args, { detached: true, stdio: "ignore" }).unref();
      } else if (process.platform === "win32") {
        const safeCwd = cwd ? cwd.replace(/["\r\n]/g, "") : "";
        const command = safeCwd
          ? `start "" wt.exe -d "${safeCwd}" || start "" cmd.exe /K cd /D "${safeCwd}"`
          : `start "" wt.exe || start "" cmd.exe`;
        spawn("cmd.exe", ["/c", command], {
          detached: true,
          stdio: "ignore",
        }).unref();
      } else {
        const candidates = [
          "x-terminal-emulator",
          "gnome-terminal",
          "konsole",
          "xterm",
        ];
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
          return {
            ok: false,
            message: "no terminal emulator found on PATH",
          };
        }
      }
      return { ok: true };
    } catch (err) {
      return (() => {
        const error = fromCaught("ipc.unknown", err);
        return { ok: false, message: error.message, error };
      })();
    }
  });

  // ─── Auto-update handlers ──────────────────────────────────────────────────

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
      const error = fromCaught("update.check-failed", err);
      broadcastUpdateStatus({ kind: "error", message: error.message });
      return { ok: false, message: error.message, error };
    }
  });

  ipcMain.handle(IPC.downloadUpdate, async () => {
    if (!app.isPackaged) {
      const reason = "auto-update is disabled in dev (not a packaged build)";
      broadcastUpdateStatus({ kind: "disabled", reason });
      return { ok: false, message: reason };
    }
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true, message: "download started" };
    } catch (err) {
      const error = fromCaught("update.download-failed", err);
      broadcastUpdateStatus({ kind: "error", message: error.message });
      return { ok: false, message: error.message, error };
    }
  });

  ipcMain.handle(IPC.quitAndInstallUpdate, () => {
    if (!app.isPackaged) return;
    autoUpdater.quitAndInstall();
  });

  ipcMain.handle(
    IPC.setDismissedUpdateVersion,
    (_e, version: string | null) => {
      setDismissedUpdateVersion(
        typeof version === "string" && version.length > 0 ? version : null,
      );
      persistConfig();
    },
  );

  // ─── Open external / misc ──────────────────────────────────────────────────

  ipcMain.handle(IPC.openExternal, async (_e, url: string) => {
    if (!isSafeExternalUrl(url)) {
      console.warn(`openExternal: refused non-http(s) URL: ${String(url)}`);
      return;
    }
    await shell.openExternal(url);
  });

  ipcMain.handle(IPC.openSelfHostDocs, async () => {
    if (await selfHostUrlReachable()) {
      await shell.openExternal(SELF_HOST_URL);
      return { ok: true };
    }
    const docPath = app.isPackaged
      ? path.join(process.resourcesPath, "docs", "self-host.md")
      : path.join(app.getAppPath(), "..", "docs", "self-host.md");
    if (!fs.existsSync(docPath)) {
      return { ok: false, message: `self-host docs not found at ${docPath}` };
    }
    const error = await shell.openPath(docPath);
    if (error) return { ok: false, message: error };
    return { ok: true };
  });

  ipcMain.handle(IPC.getConfig, () => {
    const backend = getStorageBackend();
    const cfg = readConfig();
    const showWeakStorageNotice =
      backend === "basic_text" &&
      !cfg.weakStorageNoticeDismissedFor.includes(backend);
    return {
      registryRoot: getRegistryRoot(),
      configValid: getRegistryRoot() !== null,
      isPackaged: app.isPackaged,
      dismissedUpdateVersion: getDismissedUpdateVersion(),
      storageBackend: backend,
      showWeakStorageNotice,
    };
  });
}
