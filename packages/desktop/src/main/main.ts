import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createOriginProbeRunner,
  reconcileFoldersToManifestSafe,
  resolveRegistryRoot,
} from "@skills-bank/core";
import {
  IPC,
  type LinkedRepoMetadata,
  type OriginProbeCompleteEvent,
  type RegistrySource,
} from "../shared/ipc.js";
import { getStoredToken } from "./auth.js";
import {
  configFilePath,
  readConfig,
  writeConfig,
  setRegistryRoot,
  setRegistrySource,
  setLinkedRepo,
  setDismissedUpdateVersion,
  initProbeRunner,
  getRegistryRoot,
  getLinkedRepo,
} from "./main-state.js";
import { registerMetricsHandlers } from "./ipc-metrics.js";
import { getTrackingStatus } from "./skill-tracking.js";
import { registerAuthHandlers } from "./ipc-auth.js";
import { registerGithubHandlers } from "./ipc-github.js";
import { registerLabelsHandlers } from "./ipc-labels.js";
import { registerManifestHandlers } from "./ipc-manifest.js";
import { registerRegistryHandlers } from "./ipc-registry.js";
import { registerReposHandlers } from "./ipc-repos.js";
import {
  buildAppMenu,
  createWindow,
  iconPng,
  isSafeExternalUrl,
  registerShellHandlers,
  wireAutoUpdater,
} from "./ipc-shell.js";

// ─── Dev-mode isolation ─────────────────────────────────────────────────────
if (!app.isPackaged) {
  const devHome = path.join(app.getPath("home"), ".skills-bank-dev");
  fs.mkdirSync(devHome, { recursive: true });
  app.setName("Skills Bank (Dev)");
  app.setPath("userData", path.join(devHome, "userData"));
  process.env.SKILLS_BANK_HOME_OVERRIDE = devHome;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Registry path resolution ────────────────────────────────────────────────

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

function defaultManagedRegistryRoot(): string {
  const root = path.join(app.getPath("userData"), "registry");
  fs.mkdirSync(path.join(root, "skills"), { recursive: true });
  return root;
}

function resolveBootRegistryRoot(): string {
  const stored = readConfig().registryRoot;
  if (stored && isValidRegistryRoot(stored).ok) return stored;
  try {
    return resolveRegistryRoot();
  } catch {
    return defaultManagedRegistryRoot();
  }
}

function resolveBootRegistrySource(): RegistrySource {
  return readConfig().registrySource ?? "local";
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

const bootRegistryRoot = resolveBootRegistryRoot();
setRegistryRoot(bootRegistryRoot);
setRegistrySource(resolveBootRegistrySource());
setLinkedRepo(readConfig().linkedRepo);
setDismissedUpdateVersion(readConfig().dismissedUpdateVersion);

// True up the manifest against the folders on disk before the first
// index build — the single manifest-write seam (ADR-0020/0021). A
// cross-bucket name collision on disk must not crash app load — Safe
// skips this cycle's reconcile and logs instead.
reconcileFoldersToManifestSafe(bootRegistryRoot, {
  linkedRepo: getLinkedRepo()?.fullName,
});

// ─── Probe runner ─────────────────────────────────────────────────────────────

const PROBE_CADENCE_MS = 6 * 60 * 60 * 1000;
const PROBE_BOOT_DELAY_MS = 5 * 1000;

const probeRunner = createOriginProbeRunner({
  registryRoot: () => getRegistryRoot(),
  token: () => getStoredToken(),
  linkedRepo: () => getLinkedRepo()?.fullName ?? null,
  onComplete: (event) => {
    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) {
      if (!win.isDestroyed()) win.webContents.send(IPC.originProbe, event);
    }
  },
});

initProbeRunner(probeRunner);

// ─── Register all IPC handlers ────────────────────────────────────────────────

registerMetricsHandlers();
if (!app.isPackaged && getTrackingStatus().state !== "off") {
  console.warn(
    "[skills-bank dev] Skill tracking is enabled. The hook script, invocation log, and enabled-state " +
      "all live at real ~/.skills-bank/ and ~/.claude/settings.json — paths shared with the packaged " +
      "install. Disabling or re-enabling tracking here affects your production Claude Code hook configuration.",
  );
}
registerAuthHandlers();
registerGithubHandlers();
registerLabelsHandlers();
registerManifestHandlers();
registerRegistryHandlers();
registerReposHandlers();
registerShellHandlers();

// ─── App lifecycle ────────────────────────────────────────────────────────────

// App-wide WebContents hardening.
const DISCOVER_HOSTS = new Set(["skills.sh", "www.skills.sh"]);

app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, navUrl) => {
    try {
      const parsed = new URL(navUrl);
      if (parsed.protocol === "file:") return;
      if (
        (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        DISCOVER_HOSTS.has(parsed.hostname)
      ) {
        return;
      }
      event.preventDefault();
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        void shell.openExternal(navUrl);
      }
    } catch {
      event.preventDefault();
    }
  });
});

void app.whenReady().then(() => {
  if (
    process.platform === "darwin" &&
    !app.isPackaged &&
    fs.existsSync(iconPng)
  ) {
    app.dock?.setIcon(iconPng);
  }
  wireAutoUpdater();
  Menu.setApplicationMenu(buildAppMenu());
  createWindow();
  if (app.isPackaged) {
    void autoUpdater.checkForUpdates();
  }
  setTimeout(() => {
    void probeRunner.run();
  }, PROBE_BOOT_DELAY_MS);
  setInterval(() => {
    void probeRunner.run();
  }, PROBE_CADENCE_MS);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
