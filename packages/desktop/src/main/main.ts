import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  WebContentsView,
} from "electron";
import type { MenuItemConstructorOptions } from "electron";
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
  applyRegistration,
  buildRegistryIndex,
  classifySkillByName,
  clearPendingConflicts,
  deleteFromBankSkill,
  deleteUnregisteredSkill,
  exportSkill,
  exportRegistry,
  fetchCanonicalTarball,
  acceptDriftKeepLocal,
  acceptDriftTakeCanonical,
  finalizeSkillsDir,
  forgetMissingEntry,
  fromCaught,
  getExportInfo,
  hideCanonSkill,
  installSkill,
  invalidateCanonCache,
  makeAppError,
  mergeImportRegistry,
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
  unhideCanonSkill,
  unregisterSkill,
  writeSyncDecisions,
  writeUpstreamCanonNames,
  AGENTS,
  getAgentSkillsDir,
  type AgentId,
  type InstalledKind,
  type RegistrationAction,
  type SyncDecisions,
} from "@skills-bank/core";
import {
  IPC,
  type AuthStatus,
  type Bounds,
  type DiscoverStatus,
  type HeaderMenuAction,
  type HeaderMenuContext,
  type SkillDiffFile,
  type SkillDiffRequest,
  type SkillDiffResult,
  type SyncStatus,
  type UpdateStatus,
  type UserRepo,
} from "../shared/ipc.js";
import { createPatch, diffLines } from "diff";
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

export type RegistrySource = "local" | "github";

interface AppConfig {
  registryRoot: string | null;
  registrySource: RegistrySource | null;
  // Version string the user has chosen to skip via the update-notes modal.
  // Suppresses auto-open of the modal for that specific version only — the
  // app still auto-checks and auto-downloads, and the user can always
  // re-summon the modal via the "Check for Updates…" menu item.
  dismissedUpdateVersion: string | null;
}

function emptyConfig(): AppConfig {
  return {
    registryRoot: null,
    registrySource: null,
    dismissedUpdateVersion: null,
  };
}

function configFilePath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

function readConfig(): AppConfig {
  const p = configFilePath();
  try {
    if (!fs.existsSync(p)) return emptyConfig();
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<AppConfig>;
    return {
      registryRoot:
        typeof raw.registryRoot === "string" ? raw.registryRoot : null,
      registrySource:
        raw.registrySource === "local" || raw.registrySource === "github"
          ? raw.registrySource
          : null,
      dismissedUpdateVersion:
        typeof raw.dismissedUpdateVersion === "string"
          ? raw.dismissedUpdateVersion
          : null,
    };
  } catch {
    return emptyConfig();
  }
}

function writeConfig(cfg: AppConfig): void {
  const p = configFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
}

// Loose validator: accept any existing directory. The registry is a folder
// of skills, not a clone of a specific repo, so the strict "package.json
// name must be skills-bank" check is gone. Folders without a `skills/`
// subdir simply render as empty until the user adds skills (or a sync
// populates it).
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

// Default location for the local-bundled registry: app-managed,
// survives app upgrades, ready for bundled sync to populate it.
function defaultManagedRegistryRoot(): string {
  const root = path.join(app.getPath("userData"), "registry");
  fs.mkdirSync(path.join(root, "skills"), { recursive: true });
  seedManagedRegistryIfEmpty(root);
  // Run the canon-snapshot + source-marker bootstrap on every boot,
  // not just on first-launch seed. Existing installs from before M2
  // have a populated registry but no upstream-canon.json, so canon
  // attribution would otherwise be false for every bundled skill.
  ensureManagedCanonAttribution(root);
  return root;
}

// Packaged builds bundle the canonical skills/ + index.json at
// process.resourcesPath/seed/. On first launch the managed registry is
// empty, so without seeding the user has to hit Pull Updates before
// anything appears. Copy the seed in once; never overwrite existing
// content. Idempotent — the index.json presence check makes re-entry
// a no-op even if the user deleted individual skills.
function seedManagedRegistryIfEmpty(root: string): void {
  const indexPath = path.join(root, "index.json");
  if (fs.existsSync(indexPath)) return;

  const seedDir = path.join(process.resourcesPath, "seed");
  const seedSkills = path.join(seedDir, "skills");
  const seedIndex = path.join(seedDir, "index.json");
  if (!fs.existsSync(seedSkills) || !fs.existsSync(seedIndex)) return;

  try {
    fs.cpSync(seedSkills, path.join(root, "skills"), {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
    fs.copyFileSync(seedIndex, indexPath);
    fs.writeFileSync(
      path.join(root, ".seeded"),
      JSON.stringify(
        { version: app.getVersion(), seededAt: new Date().toISOString() },
        null,
        2,
      ),
    );
    // First-launch only: mark each freshly-seeded skill as
    // source: bundled. The bundled seed doesn't ship per-skill
    // .skills-bank.json files (those are managed-registry app state,
    // not upstream content), so without this the seeded skills
    // default to source: yours — falling through to YOURS badges and
    // disabling drift detection. Safe to write here because the
    // outer `if (fs.existsSync(indexPath)) return` guarantees we
    // only run on a brand-new install where files match the seed
    // byte-for-byte. ensureManagedCanonAttribution (below) does
    // NOT write source markers for existing installs, since those
    // could have user-edited content that Sync would later wipe.
    try {
      const seedIdx = JSON.parse(fs.readFileSync(seedIndex, "utf8")) as {
        entries?: Array<{ name?: unknown }>;
      };
      const seededAt = new Date().toISOString();
      for (const e of seedIdx.entries ?? []) {
        if (typeof e.name !== "string") continue;
        const skillDir = path.join(root, "skills", e.name);
        if (!fs.existsSync(skillDir)) continue;
        writeSkillSource(skillDir, {
          source: "bundled",
          syncedAt: seededAt,
        });
      }
    } catch (err) {
      console.error("seed source-marker pass failed:", err);
    }
  } catch (err) {
    // Seed failures are non-fatal — the user can still Pull Updates.
    // Log to stderr so packaged builds with --enable-logging surface it.
    console.error("seedManagedRegistryIfEmpty failed:", err);
  }
}

// Bootstrap the canon snapshot on every managed-registry boot.
//
// Existing installs from before M2 have a populated registry but no
// upstream-canon.json — so canon attribution falls to false for every
// bundled skill, which surfaces as YOURS badges and allows
// Unregister/Delete on what should be canon-protected content. The
// snapshot write is idempotent: skipped when the file already exists,
// so this is a one-shot recovery for users who pre-date M2.
//
// Deliberately does NOT write `.skills-bank.json` source markers for
// existing skills — those could have been user-edited since the
// original seed, and marking them canonical would cause the next
// Sync to overwrite the user's changes. First-launch seeding (above)
// writes the source markers when files are guaranteed fresh.
function ensureManagedCanonAttribution(root: string): void {
  const stateDir = path.join(root, ".skills-bank");
  const snapshotPath = path.join(stateDir, "upstream-canon.json");
  if (fs.existsSync(snapshotPath)) return;

  const seedDir = path.join(process.resourcesPath, "seed");
  const seedIndex = path.join(seedDir, "index.json");
  if (!fs.existsSync(seedIndex)) return;

  try {
    const seedIdx = JSON.parse(fs.readFileSync(seedIndex, "utf8")) as {
      entries?: Array<{ name?: unknown }>;
    };
    const names = (seedIdx.entries ?? [])
      .map((e) => e.name)
      .filter((n): n is string => typeof n === "string");
    writeUpstreamCanonNames(root, names, "bundled");
  } catch (err) {
    console.error("ensureManagedCanonAttribution failed:", err);
  }
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

// Resolve registry source at boot. Persona-collapse default: every fresh
// install lands on local-bundled. Stored values are still respected (so a
// linked GitHub repo persists across launches once Bundle 3 wires up the
// switching affordance from Settings). The LoginScreen onboarding fork is
// gone; users opt into github-linked from Settings, not from a first-
// launch dialog.
function resolveBootRegistrySource(): RegistrySource {
  const stored = readConfig().registrySource;
  if (stored) return stored;
  // First launch (or post-reset). Default to local-bundled and persist
  // so the renderer never sees registrySource === null in the boot path.
  writeConfig({
    registryRoot,
    registrySource: "local",
    dismissedUpdateVersion: readConfig().dismissedUpdateVersion,
  });
  return "local";
}

let registrySource: RegistrySource | null = resolveBootRegistrySource();

let dismissedUpdateVersion: string | null = readConfig().dismissedUpdateVersion;

// Writes the current in-memory app config triple. Use this instead of calling
// writeConfig({...}) at sites that only mutate one field, so we don't lose
// the others when fields are added.
function persistConfig(): void {
  writeConfig({ registryRoot, registrySource, dismissedUpdateVersion });
}

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
  // Push current status to renderer on every show — on tab re-entry the view
  // is reused without a new navigation, so did-start-loading / did-finish-load
  // never fire and the renderer would be stuck in its initial "loading" state.
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

function hideDiscoverView(): void {
  if (!discoverView) return;
  discoverView.setVisible(false);
  discoverView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
}

// Async hide (used when timing isn't critical).
ipcMain.handle(IPC.discoverHide, () => {
  hideDiscoverView();
});

// Synchronous hide — called from the renderer's useLayoutEffect so the
// WebContentsView is guaranteed hidden before the next paint. Without this,
// modal overlays (SettingsModal, etc.) render behind the embedded browser
// for one frame before the async hide message arrives.
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

ipcMain.handle(IPC.discoverOpenTerminal, async (_e, terminalApp?: string) => {
  // Detached spawn so the terminal process outlives our app session and
  // doesn't block on stdio. Cwd is the registry root if known so the user
  // lands somewhere skill-relevant; otherwise the process default.
  const cwd = registryRoot ?? undefined;
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
      // `start ""` consumes the title arg so the path isn't taken as one.
      // Falls back to cmd if Windows Terminal isn't installed.
      const command = cwd
        ? `start "" wt.exe -d "${cwd}" || start "" cmd.exe /K cd /D "${cwd}"`
        : `start "" wt.exe || start "" cmd.exe`;
      spawn("cmd.exe", ["/c", command], {
        detached: true,
        stdio: "ignore",
      }).unref();
    } else {
      // Linux best-effort. Most distros ship `x-terminal-emulator` (Debian)
      // or expose one of the common emulators on PATH.
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
        return { ok: false, message: "no terminal emulator found on PATH" };
      }
    }
    return { ok: true };
  } catch (err) {
    return (() => { const error = fromCaught("ipc.unknown", err); return { ok: false, message: error.message, error }; })();
  }
});

// ─── Header native menu ──────────────────────────────────────────────────────
//
// The header "Settings" / account button triggers a native Electron popup
// menu instead of a React popover so it renders above the WebContentsView.
// Action strings are sent back to the renderer via IPC.headerMenuAction.

ipcMain.handle(IPC.showHeaderMenu, (event, ctx: HeaderMenuContext) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;

  const send = (action: HeaderMenuAction) =>
    event.sender.send(IPC.headerMenuAction, action);

  const template: MenuItemConstructorOptions[] = [];

  if (ctx.registrySource === "github") {
    if (ctx.user) {
      template.push({
        label: `Signed in as ${ctx.user.login}`,
        enabled: false,
      });
      template.push({ type: "separator" });
    }
    template.push({
      label: "Choose registry repo…",
      click: () => send("changeRegistry"),
    });
  } else {
    template.push({ label: "Using bundled registry", enabled: false });
    template.push({ type: "separator" });
    template.push({
      label: "Link a GitHub repo… (Coming soon)",
      click: () => send("githubLinkComingSoon"),
    });
    template.push({ type: "separator" });
    template.push({
      label: "Import a registry (replace)…",
      click: () => send("changeRegistry"),
    });
    template.push({
      label: "Merge a registry into mine…",
      click: () => send("mergeRegistry"),
    });
    template.push({
      label: "Export registry…",
      click: () => send("exportRegistry"),
    });
  }

  if (ctx.showSync) {
    template.push({ type: "separator" });
    template.push({ label: "Sync skills", click: () => send("sync") });
  }

  template.push({ type: "separator" });
  template.push({ label: "Settings…", click: () => send("openSettings") });
  template.push({
    label: "Keyboard shortcuts…",
    click: () => send("openShortcuts"),
  });
  template.push({
    label: "Check for app updates",
    click: () => send("checkForUpdates"),
  });

  if (ctx.registrySource === "github") {
    template.push({ type: "separator" });
    template.push({
      label: "Sign out of GitHub",
      click: () => send("signOut"),
    });
  }

  Menu.buildFromTemplate(template).popup({ window: win });
});

// macOS menu bar. Items that affect renderer state send via IPC.headerMenuAction.
// The menu is built once at launch; registry-source-specific items (e.g. Export) are
// always present but the renderer ignores actions that don't apply to its state.
function buildAppMenu(): Menu {
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
          label: "Settings…",
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
        { label: "Refresh", click: () => send("refresh") },
        { label: "Sync skills", click: () => send("sync") },
        { type: "separator" },
        { role: "toggleDevTools" },
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

function createWindow(): void {
  const win = new BrowserWindow({
    // 1280x860 fits three 320px-min cards comfortably with the gutter,
    // and gives the action buttons room to align on the Needs-attention
    // section without horizontal scroll. The 1100x720 default forced a
    // 2-column grid that broke alignment for users with longer skill
    // descriptions.
    width: 1280,
    height: 860,
    minWidth: 880,
    minHeight: 600,
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
  registrySource,
  dismissedUpdateVersion,
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
  // M2: drop cached upstream-canon for the previous root so the next
  // index build classifies skills against the new root's own upstream
  // snapshot (or absence of one), not the old repo's set.
  invalidateCanonCache();
  persistConfig();
  return { ok: true, message: `registry set to ${candidate}`, registryRoot };
});

// Always rebuild from filesystem on every call. The on-disk index.json is a
// CI artifact, not the source of truth — this guarantees the UI reflects
// reality after registrations, manual edits, or any other state change without
// requiring the user to remember to rebuild.
ipcMain.handle(IPC.listRegistry, () => {
  if (!registryRoot) return [];
  return buildRegistryIndex(registryRoot, { writeFile: true }).entries;
});

ipcMain.handle(IPC.listInstalled, (_e, customDirs?: string[]) => {
  const dirs = Array.isArray(customDirs)
    ? customDirs.filter((s): s is string => typeof s === "string")
    : undefined;
  if (!registryRoot)
    return listInstalled("", {
      index: { generatedAt: "", entries: [] },
      customDirs: dirs,
    });
  const index = buildRegistryIndex(registryRoot);
  return listInstalled(registryRoot, { index, customDirs: dirs });
});

ipcMain.handle(IPC.pickCustomSkillsDir, async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win ?? undefined!, {
    title: "Add a skills directory to the Installed tab",
    properties: ["openDirectory"],
    defaultPath: app.getPath("home"),
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, message: "canceled" };
  }
  return { ok: true, path: result.filePaths[0], message: "ok" };
});

// Per-file unified diff between two skill folders. Reusable across
// sync-collision and (future) drift-drawer surfaces — both render via
// the same DiffViewer renderer component.
ipcMain.handle(
  IPC.getSkillDiff,
  async (_e, req: SkillDiffRequest): Promise<SkillDiffResult> => {
    const files = computeFolderDiff(req.leftPath, req.rightPath);
    return {
      leftLabel: req.leftLabel,
      rightLabel: req.rightLabel,
      files,
    };
  },
);

// 1 MB per-file cap. Files past this size or with binary content
// (NUL byte in the first 8 KB) are reported as `binary` with no
// diff body — keeps the renderer responsive and the IPC channel
// from blowing up on large fixture files.
const DIFF_BYTE_BUDGET = 1024 * 1024;

function looksBinary(buf: Buffer): boolean {
  const head = buf.subarray(0, Math.min(buf.length, 8192));
  for (let i = 0; i < head.length; i++) {
    if (head[i] === 0) return true;
  }
  return false;
}

function readTextIfSmall(p: string): { kind: "text" | "binary"; body: string } {
  const stat = fs.statSync(p);
  if (stat.size > DIFF_BYTE_BUDGET) return { kind: "binary", body: "" };
  const buf = fs.readFileSync(p);
  if (looksBinary(buf)) return { kind: "binary", body: "" };
  return { kind: "text", body: buf.toString("utf8") };
}

function walkFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  function visit(rel: string): void {
    const abs = path.join(root, rel);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      // Skip app-state sidecars — they're metadata the user didn't
      // author and would surface as noise in every diff.
      if (ent.name === ".skills-bank.json") continue;
      if (ent.name === ".skills-bank-hash") continue;
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) visit(r);
      else if (ent.isFile()) out.push(r);
    }
  }
  visit("");
  out.sort();
  return out;
}

function computeFolderDiff(leftRoot: string, rightRoot: string): SkillDiffFile[] {
  const leftFiles = new Set(walkFiles(leftRoot));
  const rightFiles = new Set(walkFiles(rightRoot));
  const allPaths = new Set<string>([...leftFiles, ...rightFiles]);
  const sorted = [...allPaths].sort();
  const out: SkillDiffFile[] = [];

  for (const rel of sorted) {
    const inLeft = leftFiles.has(rel);
    const inRight = rightFiles.has(rel);
    const leftAbs = path.join(leftRoot, rel);
    const rightAbs = path.join(rightRoot, rel);

    if (inLeft && inRight) {
      const left = readTextIfSmall(leftAbs);
      const right = readTextIfSmall(rightAbs);
      if (left.kind === "binary" || right.kind === "binary") {
        if (left.body === right.body) continue; // both binary-and-skipped, treat as same
        out.push({
          path: rel,
          added: 0,
          removed: 0,
          unifiedDiff: "",
          status: "binary",
        });
        continue;
      }
      if (left.body === right.body) continue;
      let added = 0;
      let removed = 0;
      for (const part of diffLines(left.body, right.body)) {
        const lines = part.count ?? part.value.split("\n").length - 1;
        if (part.added) added += lines;
        else if (part.removed) removed += lines;
      }
      const unifiedDiff = createPatch(rel, left.body, right.body, "", "");
      out.push({
        path: rel,
        added,
        removed,
        unifiedDiff,
        status: "modified",
      });
    } else if (inLeft) {
      const left = readTextIfSmall(leftAbs);
      if (left.kind === "binary") {
        out.push({
          path: rel,
          added: 0,
          removed: 0,
          unifiedDiff: "",
          status: "left-only",
        });
        continue;
      }
      const removed = left.body.split("\n").length;
      const unifiedDiff = createPatch(rel, left.body, "", "", "");
      out.push({
        path: rel,
        added: 0,
        removed,
        unifiedDiff,
        status: "left-only",
      });
    } else {
      const right = readTextIfSmall(rightAbs);
      if (right.kind === "binary") {
        out.push({
          path: rel,
          added: 0,
          removed: 0,
          unifiedDiff: "",
          status: "right-only",
        });
        continue;
      }
      const added = right.body.split("\n").length;
      const unifiedDiff = createPatch(rel, "", right.body, "", "");
      out.push({
        path: rel,
        added,
        removed: 0,
        unifiedDiff,
        status: "right-only",
      });
    }
  }
  return out;
}

ipcMain.handle(
  IPC.install,
  (_e, name: string, force?: boolean, agents?: AgentId[]) => {
    if (!registryRoot) return { ok: false, message: NO_ROOT_MSG, errors: [] };
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
          errors: r.errors,
        };
      }
      if (r.installs.length > 0) {
        return {
          ok: true,
          message: `${name} already installed`,
          errors: r.errors,
        };
      }
      return {
        ok: false,
        message: r.errors[0]?.message ?? `nothing installed for ${name}`,
        errors: r.errors,
      };
    } catch (err) {
      return (() => { const error = fromCaught("ipc.unknown", err); return { ok: false, message: error.message, error, errors: [] }; })();
    }
  },
);

// Full removal: deletes the registry copy + all agent symlinks. Distinct
// from uninstall (symlinks only). Refuses if the registry is unset.
//
// M1: this is the canonical demonstration of IPC-side classifier gating.
// We classify the skill against the current registry state and refuse if
// the capability table says no. With M1's defaults (canon=false) nothing
// is denied here that wasn't already denied by deregisterSkill's own
// guards; M5 turns this into the real enforcement point for canon
// protection.
ipcMain.handle(IPC.deregister, (_e, name: string) => {
  if (!registryRoot) {
    return { ok: false, message: NO_ROOT_MSG, errors: [] };
  }
  const classification = classifySkillByName(registryRoot, name);
  if (classification && !classification.capabilities.canDeleteFromBank) {
    return {
      ok: false,
      message: `Cannot delete ${name} from this state (${classification.state}).`,
      errors: [],
    };
  }
  try {
    const r = deleteFromBankSkill(name, { registryRoot });
    const removedSymlinkCount =
      r.symlinkRemovals?.filter((s) => s.removed).length ?? 0;
    return {
      ok: r.ok,
      message: r.message,
      deletedPath: r.deletedPath,
      removedSymlinkCount,
      errors: r.errors,
    };
  } catch (err) {
    return (() => { const error = fromCaught("ipc.unknown", err); return { ok: false, message: error.message, error, errors: [] }; })();
  }
});

// M5: hide a canon skill from the default views. Canon skills can't
// be unregistered or deleted from the UI (those would be irrecoverable
// — the upstream owns them), so Hide is the only canon-side action a
// non-power user can take.
ipcMain.handle(IPC.hide, (_e, name: string) => {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  const index = buildRegistryIndex(registryRoot);
  const entry = index.entries.find((e) => e.name === name);
  if (!entry) {
    return { ok: false, message: `${name} is not in the registry` };
  }
  if (entry.canon !== true) {
    return {
      ok: false,
      message: `${name} isn't canon — unregister or delete it instead`,
    };
  }
  try {
    hideCanonSkill(registryRoot, name);
    return { ok: true, message: `Hid ${name} from the default views.` };
  } catch (err) {
    return (() => { const error = fromCaught("ipc.unknown", err); return { ok: false, message: error.message, error }; })();
  }
});

ipcMain.handle(IPC.unhide, (_e, name: string) => {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  try {
    unhideCanonSkill(registryRoot, name);
    return { ok: true, message: `Unhid ${name}.` };
  } catch (err) {
    return (() => { const error = fromCaught("ipc.unknown", err); return { ok: false, message: error.message, error }; })();
  }
});

// M6: canon-drift heal — keep local edits, clear the canonical
// marker. After this, the skill is `source: user` and sync stops
// trying to overwrite it.
ipcMain.handle(IPC.acceptDrift, (_e, name: string) => {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  const index = buildRegistryIndex(registryRoot);
  const entry = index.entries.find((e) => e.name === name);
  if (!entry) return { ok: false, message: `${name} is not in the registry` };
  if (entry.adopted === false) {
    return {
      ok: false,
      message: `${name} isn't adopted — drift doesn't apply`,
    };
  }
  const skillDir = path.join(registryRoot, entry.path);
  try {
    acceptDriftKeepLocal(skillDir);
    buildRegistryIndex(registryRoot, {
      includeGitInfo: true,
      writeFile: true,
    });
    return {
      ok: true,
      message: `Kept local edits to ${name}; future syncs will leave it alone.`,
    };
  } catch (err) {
    return (() => { const error = fromCaught("ipc.unknown", err); return { ok: false, message: error.message, error }; })();
  }
});

// Canon-drift heal — take-canonical arm. Re-snapshots the current
// hash so drift clears; source stays canonical so Sync continues to
// own the skill. Distinct from acceptDrift (which detaches from
// Sync). Use this when drift surfaced spuriously and the current
// post-sync state is acceptable.
ipcMain.handle(IPC.takeCanonical, (_e, name: string) => {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  const index = buildRegistryIndex(registryRoot);
  const entry = index.entries.find((e) => e.name === name);
  if (!entry) return { ok: false, message: `${name} is not in the registry` };
  if (entry.adopted === false) {
    return {
      ok: false,
      message: `${name} isn't adopted — drift doesn't apply`,
    };
  }
  const skillDir = path.join(registryRoot, entry.path);
  try {
    acceptDriftTakeCanonical(skillDir);
    buildRegistryIndex(registryRoot, {
      includeGitInfo: true,
      writeFile: true,
    });
    return {
      ok: true,
      message: `Re-baselined ${name} as canonical; drift cleared.`,
    };
  } catch (err) {
    return (() => { const error = fromCaught("ipc.unknown", err); return { ok: false, message: error.message, error }; })();
  }
});

// M6: missing-entry heal — drop the registry record. For non-
// adopted (external), removes the external.json row. For adopted,
// the entry naturally drops on the next index build (folder was
// gone); we trigger that rebuild here.
ipcMain.handle(IPC.forgetMissing, (_e, name: string) => {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  try {
    const r = forgetMissingEntry(registryRoot, name);
    buildRegistryIndex(registryRoot, {
      includeGitInfo: true,
      writeFile: true,
    });
    return r;
  } catch (err) {
    return (() => { const error = fromCaught("ipc.unknown", err); return { ok: false, message: error.message, error }; })();
  }
});

// M9b: bottom-of-the-ladder destructive action for unregistered
// skills. Refuses if the skill is registered — caller must
// unregister first. Real-dir installations are rm-rf'd; symlinks
// are unlinked (targets untouched, since they're user-owned).
ipcMain.handle(IPC.deleteUnregistered, (_e, name: string) => {
  if (!registryRoot) {
    return {
      ok: false,
      message: NO_ROOT_MSG,
      removedDirs: [],
      removedSymlinks: [],
    };
  }
  try {
    const r = deleteUnregisteredSkill(registryRoot, name);
    return {
      ok: r.ok,
      message: r.message,
      removedDirs: r.removedDirs,
      removedSymlinks: r.removedSymlinks,
    };
  } catch (err) {
    const error = fromCaught("delete-unregistered.unknown", err);
    return {
      ok: false,
      message: error.message,
      error,
      removedDirs: [],
      removedSymlinks: [],
    };
  }
});

// M4: mid-tier destructive action. Moves adopted files to the
// configured agents dir (default ~/.agents/skills/) and removes the
// registry entry. Non-adopted skills just lose the entry; origin
// files untouched.
ipcMain.handle(
  IPC.unregister,
  (_e, name: string, destination: AgentId, force?: boolean) => {
    if (!registryRoot) {
      const error = makeAppError({
        code: "config.no-registry-root",
        message: NO_ROOT_MSG,
      });
      return {
        ok: false,
        message: NO_ROOT_MSG,
        wasAdopted: false,
        errors: [error],
        error,
      };
    }
    const classification = classifySkillByName(registryRoot, name);
    if (classification && !classification.capabilities.canUnregister) {
      const error = makeAppError({
        code: "unregister.not-allowed-from-state",
        message: `Cannot unregister ${name} from this state (${classification.state}).`,
        copyableDetails: { name, state: classification.state },
      });
      return {
        ok: false,
        message: error.message,
        wasAdopted: false,
        errors: [error],
        error,
      };
    }
    try {
      const r = unregisterSkill(name, {
        registryRoot,
        destination,
        force: force ?? false,
      });
      return {
        ok: r.ok,
        message: r.message,
        destinationPath: r.destinationPath,
        wasAdopted: r.wasAdopted,
        errors: r.errors,
        error: r.error,
      };
    } catch (err) {
      const error = fromCaught("unregister.unknown", err);
      return {
        ok: false,
        message: error.message,
        wasAdopted: false,
        errors: [error],
        error,
      };
    }
  },
);

// Stuck-state recovery: drop the pending-conflicts.json state file so
// the next sync attempt starts clean. Idempotent — fine to call when no
// pending file exists.
ipcMain.handle(IPC.clearPendingConflicts, () => {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  try {
    const r = clearPendingConflicts(registryRoot);
    return {
      ok: true,
      message: r.removed
        ? "Cleared pending sync state."
        : "No pending sync state to clear.",
    };
  } catch (err) {
    return (() => { const error = fromCaught("ipc.unknown", err); return { ok: false, message: error.message, error }; })();
  }
});

// Uninstall doesn't need the registry — it just removes symlinks at
// each agent dir. Leave it functional even with no registry.
// M7: optional agents array restricts the operation to a subset; the
// rest of the agent dirs keep their symlinks. Empty/missing array
// keeps the legacy "remove from every agent dir" behavior.
ipcMain.handle(IPC.uninstall, (_e, name: string, agents?: AgentId[]) => {
  try {
    const r = uninstallSkill(
      name,
      agents && agents.length > 0 ? { agents } : {},
    );
    const removedCount = r.removals.filter((x) => x.removed).length;
    const keptCount = r.errors.length;
    const message =
      keptCount === 0
        ? r.removed
          ? `Removed ${name} from ${removedCount} agent dir(s).`
          : `${name} not installed`
        : `Removed from ${removedCount} agent(s); ${keptCount} kept (not symlinks)`;
    return {
      ok: true,
      message,
      errors: r.errors,
      removedCount,
      keptCount,
    };
  } catch (err) {
    return (() => { const error = fromCaught("ipc.unknown", err); return { ok: false, message: error.message, error, errors: [] }; })();
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
  IPC.register,
  (_e, items: Array<{ name: string; action: RegistrationAction }>) => {
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
      return applyRegistration(entry, action, {
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
    const error = fromCaught("rebuild-index.unknown", err);
    return {
      ok: false,
      message: error.message,
      error,
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
    return (() => { const error = fromCaught("ipc.unknown", err); return { ok: false, message: error.message, error }; })();
  }
});

ipcMain.handle(IPC.exportRegistry, async () => {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  try {
    const skillsDir = path.join(registryRoot, "skills");
    const date = new Date().toISOString().slice(0, 10);
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win ?? undefined!, {
      title: "Export registry",
      defaultPath: `skills-bank-registry-${date}.zip`,
      filters: [{ name: "Zip Archive", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, message: "export cancelled" };
    }
    const r = await exportRegistry(registryRoot, result.filePath);
    return {
      ok: true,
      message: `Exported ${r.skillCount} skill${r.skillCount === 1 ? "" : "s"} → ${r.destPath}`,
      skillCount: r.skillCount,
    };
  } catch (err) {
    return (() => { const error = fromCaught("ipc.unknown", err); return { ok: false, message: error.message, error }; })();
  }
});

ipcMain.handle(IPC.importRegistry, async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win ?? undefined!, {
    title: "Import a registry",
    message: "Pick a folder containing a skills/ subdirectory.",
    properties: ["openDirectory"],
    defaultPath: app.getPath("home"),
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
  const skillsDir = path.join(candidate, "skills");
  if (!fs.existsSync(skillsDir)) {
    return {
      ok: false,
      message: `No skills/ directory found in the selected folder. Make sure you're pointing at a valid registry.`,
      registryRoot,
    };
  }
  const skillCount = fs
    .readdirSync(skillsDir)
    .filter((e) => fs.statSync(path.join(skillsDir, e)).isDirectory()).length;
  registryRoot = candidate;
  // M2: same reason as setRegistryRoot — flush canon cache so the new
  // root's index build doesn't see the prior root's snapshot.
  invalidateCanonCache();
  persistConfig();
  return {
    ok: true,
    message: `Registry imported — ${skillCount} skill${skillCount === 1 ? "" : "s"} found`,
    registryRoot: candidate,
    skillCount,
  };
});

// M8: merge mode — additive import that keeps the active registry
// and adds skills from a picked folder. Collisions return as
// ConflictEntry[] for the renderer to resolve via the existing
// sync-conflict modal; the renderer calls importRegistryMergeApply
// with the user's decisions to finalize.
ipcMain.handle(IPC.importRegistryMerge, async () => {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win ?? undefined!, {
    title: "Merge a registry into yours",
    message:
      "Pick a folder containing a skills/ subdirectory. Non-colliding entries are added directly; collisions will prompt for keep/use-theirs/rename.",
    properties: ["openDirectory"],
    defaultPath: app.getPath("home"),
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, message: "cancelled" };
  }
  const sourcePath = result.filePaths[0]!;
  if (!fs.existsSync(path.join(sourcePath, "skills"))) {
    return {
      ok: false,
      message: `No skills/ directory found in ${sourcePath}.`,
    };
  }
  try {
    const report = mergeImportRegistry(registryRoot, sourcePath);
    return {
      ok: true,
      message: summarizeMerge(report),
      sourcePath,
      report,
    };
  } catch (err) {
    return (() => { const error = fromCaught("ipc.unknown", err); return { ok: false, message: error.message, error }; })();
  }
});

ipcMain.handle(
  IPC.importRegistryMergeApply,
  (_e, sourcePath: string, decisions: SyncDecisions) => {
    if (!registryRoot)
      return {
        ok: false,
        message: NO_ROOT_MSG,
        report: { imported: [], conflicts: [], keptMine: [], renamed: [] },
      };
    try {
      const report = mergeImportRegistry(registryRoot, sourcePath, decisions);
      return {
        ok: true,
        message: summarizeMerge(report),
        report,
      };
    } catch (err) {
      const error = fromCaught("merge-import.unknown", err);
      return {
        ok: false,
        message: error.message,
        error,
        report: { imported: [], conflicts: [], keptMine: [], renamed: [] },
      };
    }
  },
);

function summarizeMerge(
  report: import("@skills-bank/core").MergeImportReport,
): string {
  const parts: string[] = [];
  if (report.imported.length > 0)
    parts.push(`${report.imported.length} imported`);
  if (report.keptMine.length > 0)
    parts.push(`${report.keptMine.length} kept yours`);
  if (report.renamed.length > 0) parts.push(`${report.renamed.length} renamed`);
  if (report.conflicts.length > 0)
    parts.push(`${report.conflicts.length} need attention`);
  return parts.join(", ") || "no changes";
}

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
  (
    _e,
    name: string,
    tags: unknown,
  ): { ok: boolean; message: string; error?: import("@skills-bank/core").AppError } => {
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
      const error = fromCaught("edit-tags.meta-parse-failed", err);
      return { ok: false, message: `meta.json: ${error.message}`, error };
    }
    if (cleaned.length === 0) delete raw["tags"];
    else raw["tags"] = cleaned;
    try {
      fs.writeFileSync(metaPath, JSON.stringify(raw, null, 2) + "\n");
    } catch (err) {
      return (() => { const error = fromCaught("ipc.unknown", err); return { ok: false, message: error.message, error }; })();
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

// The auto-check on launch surfaces the badge; downloads happen only after
// the user explicitly clicks "Download & install" in the update-notes modal.
// Both flags are off so nothing silently consumes bandwidth or installs at
// quit-time without consent.
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

// The `download-progress` event from electron-updater only carries percent
// info — no version/notes — so we cache the last `update-available` info
// and attach it to every downstream broadcast. This keeps the modal's notes
// + version stable as the user watches the progress bar.
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

// electron-updater's `releaseNotes` is `string | { version, note }[] | null`.
// Strings come from the GitHub release body (the common case for our pipeline);
// arrays appear in Sparkle-style setups where multiple versions are bundled.
// Normalize at this boundary so the renderer only ever handles `string | null`.
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

function wireAutoUpdater(): void {
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

// User-initiated download. We deliberately do not call this from any
// implicit code path — the boot-time check only surfaces the badge, and
// the actual bytes flow only after explicit consent in the modal.
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

ipcMain.handle(IPC.setDismissedUpdateVersion, (_e, version: string | null) => {
  dismissedUpdateVersion =
    typeof version === "string" && version.length > 0 ? version : null;
  persistConfig();
});

// ─── Canonical registry sync (M2) ───────────────────────────────────────────
//
// Pulls Tyler-Reagan/skills-bank as a tarball, upserts canonical skills into
// the active registryRoot, and queues conflicts for the M5 resolver. The
// renderer subscribes to `syncStatus` for progress; results are also
// persisted at <registryRoot>/.skills-bank/last-sync.json.
//
// Note: we do not gate this on registrySource — the renderer hides the
// Sync button when github-linked. The handler stays usable so a linked
// user could in principle still run it; nothing here writes outside of
// the app-managed registry.

function broadcastSyncStatus(status: SyncStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.syncStatus, status);
  }
}

async function runSync(): Promise<{
  ok: boolean;
  message: string;
  error?: import("@skills-bank/core").AppError;
}> {
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
    const error = fromCaught("sync.run-failed", err);
    broadcastSyncStatus({ kind: "error", message: error.message });
    return { ok: false, message: error.message, error };
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
    return (() => { const error = fromCaught("ipc.unknown", err); return { ok: false, message: error.message, error }; })();
  }
  return runSync();
});

// ─── Auth + registry source ─────────────────────────────────────────────────
//
// `registrySource` drives which features the renderer surfaces. Local-bundled
// users get the Sync flow; github-linked users get the registry-replace flow.
// registrySource = null means first-launch and the renderer shows LoginScreen.

async function buildAuthStatus(): Promise<AuthStatus> {
  const user = registrySource === "github" ? await getCurrentUser() : null;
  return {
    registrySource,
    isAuthConfigured: isAuthConfigured(),
    user,
  };
}

ipcMain.handle(IPC.authStatus, () => buildAuthStatus());

ipcMain.handle(IPC.authSetRegistrySourceLocal, async () => {
  registrySource = "local";
  persistConfig();
  return buildAuthStatus();
});

ipcMain.handle(IPC.authStartDeviceFlow, async () => {
  return startDeviceFlow();
});

ipcMain.handle(IPC.authPollDeviceFlow, async (_e, flowId: string) => {
  try {
    await pollDeviceFlow(flowId);
    registrySource = "github";
    persistConfig();
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
  registrySource = null;
  persistConfig();
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
    return (() => { const error = fromCaught("ipc.unknown", err); return { ok: false, message: error.message, error }; })();
  }
  try {
    const skillsDir = path.join(fetched.extractedRoot, "skills");
    if (!fs.existsSync(skillsDir)) {
      return {
        ok: false,
        message: `${fullName} has no skills/ directory at the repo root`,
      };
    }
    // Wipe the existing local registry skills/ wholesale; github-linked
    // registry replace is "replace, don't merge."
    const localSkillsDir = path.join(registryRoot, "skills");
    fs.rmSync(localSkillsDir, { recursive: true, force: true });
    fs.mkdirSync(localSkillsDir, { recursive: true });

    const importedAt = new Date().toISOString();
    const importedNames: string[] = [];
    let count = 0;
    for (const ent of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const src = path.join(skillsDir, ent.name);
      const dest = path.join(localSkillsDir, ent.name);
      fs.cpSync(src, dest, { recursive: true });
      writeSkillSource(dest, {
        source: "yours",
        syncedFromCommit: fetched.commitSha,
        syncedAt: importedAt,
      });
      importedNames.push(ent.name);
      count++;
    }
    // Clear sync state so any prior bundled state doesn't leak in.
    const stateDir = path.join(registryRoot, ".skills-bank");
    for (const f of [
      "last-sync.json",
      "pending-conflicts.json",
      "sync-decisions.json",
    ]) {
      const p = path.join(stateDir, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    // Snapshot the imported set as the canon source for this repo so
    // buildRegistryIndex marks them canon immediately. The imported
    // tarball doesn't include `.git`, so publishState would be
    // "unknown" otherwise.
    writeUpstreamCanonNames(registryRoot, importedNames, "imported");
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
    return {
      repaired: [],
      unrepairable: [{ agent: "claude", linkPath: "", reason: NO_ROOT_MSG }],
    };
  return repairBrokenLinks(registryRoot, name);
});

ipcMain.handle(IPC.removeBrokenLinks, (_e, name: string, agents: AgentId[]) => {
  if (!registryRoot)
    return { removed: [], errors: [{ agent: "claude", message: NO_ROOT_MSG }] };
  return removeBrokenLinks(registryRoot, name, agents);
});

ipcMain.handle(
  IPC.resolveSkillConflicts,
  (
    _e,
    name: string,
    decisions: import("@skills-bank/core").ConflictResolveDecision[],
  ) => {
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
