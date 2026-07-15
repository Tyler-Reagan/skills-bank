/**
 * Shared mutable state for the main process, exposed via getter/setter
 * pairs so domain IPC modules can read and write without closing over
 * module-level lets in main.ts.
 *
 * Also houses utility functions that close over this state:
 * persistConfig, snapshotAfterMutation, mutatingHandle,
 * manifestExportContext, and the labels-file helpers.
 */

import { app, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  exportRegistryManifest,
  writeRegistrySnapshot,
  createOriginProbeRunner,
  reconcileFoldersToManifestSafe,
} from "@skills-bank/core";
import {
  IPC,
  type LinkedRepoMetadata,
  type OriginProbeCompleteEvent,
  type OriginProbeResult,
} from "../shared/ipc.js";

// ─── AppConfig (duplicated here so state.ts has no dep on main.ts) ──────────

interface AppConfig {
  registryRoot: string | null;
  dismissedAppUpdateVersion: string | null;
  linkedRepo: LinkedRepoMetadata | null;
  weakStorageNoticeDismissedFor: string[];
}

function emptyConfig(): AppConfig {
  return {
    registryRoot: null,
    dismissedAppUpdateVersion: null,
    linkedRepo: null,
    weakStorageNoticeDismissedFor: [],
  };
}

export function configFilePath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

export function readConfig(): AppConfig {
  const p = configFilePath();
  try {
    if (!fs.existsSync(p)) return emptyConfig();
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<AppConfig> & {
      // Pre-rename key. Fall back to it so a user who dismissed a
      // specific release notice doesn't see it reappear once after
      // upgrading past the App*-qualification rename.
      dismissedUpdateVersion?: unknown;
    };
    return {
      registryRoot:
        typeof raw.registryRoot === "string" ? raw.registryRoot : null,
      dismissedAppUpdateVersion:
        typeof raw.dismissedAppUpdateVersion === "string"
          ? raw.dismissedAppUpdateVersion
          : typeof raw.dismissedUpdateVersion === "string"
            ? raw.dismissedUpdateVersion
            : null,
      linkedRepo: readLinkedRepoFromRaw(raw.linkedRepo),
      weakStorageNoticeDismissedFor: Array.isArray(
        raw.weakStorageNoticeDismissedFor,
      )
        ? raw.weakStorageNoticeDismissedFor.filter(
            (s): s is string => typeof s === "string",
          )
        : [],
    };
  } catch {
    return emptyConfig();
  }
}

function readLinkedRepoFromRaw(raw: unknown): LinkedRepoMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<LinkedRepoMetadata>;
  if (
    typeof r.fullName !== "string" ||
    typeof r.lastFetchedAt !== "string" ||
    typeof r.syncedFromCommit !== "string"
  ) {
    return null;
  }
  return {
    fullName: r.fullName,
    lastFetchedAt: r.lastFetchedAt,
    syncedFromCommit: r.syncedFromCommit,
  };
}

export function writeConfig(cfg: AppConfig): void {
  const p = configFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
}

// ─── Mutable state ────────────────────────────────────────────────────────────

let _registryRoot = "";
export function getRegistryRoot(): string {
  return _registryRoot;
}
export function setRegistryRoot(v: string): void {
  _registryRoot = v;
}

let _linkedRepo: LinkedRepoMetadata | null = null;
export function getLinkedRepo(): LinkedRepoMetadata | null {
  return _linkedRepo;
}
export function setLinkedRepo(v: LinkedRepoMetadata | null): void {
  _linkedRepo = v;
}

let _dismissedAppUpdateVersion: string | null = null;
export function getDismissedAppUpdateVersion(): string | null {
  return _dismissedAppUpdateVersion;
}
export function setDismissedAppUpdateVersion(v: string | null): void {
  _dismissedAppUpdateVersion = v;
}

let _inFlightImportAbort: AbortController | null = null;
export function getInFlightImportAbort(): AbortController | null {
  return _inFlightImportAbort;
}
export function setInFlightImportAbort(v: AbortController | null): void {
  _inFlightImportAbort = v;
}

// ─── Config persistence ───────────────────────────────────────────────────────

/**
 * Writes the current in-memory app config. Use this instead of calling
 * writeConfig({...}) at sites that only mutate one field, so we don't lose
 * the others when fields are added.
 */
export function persistConfig(): void {
  // Read first to preserve the weakStorageNoticeDismissedFor list,
  // which only the dedicated IPC handler mutates — `persistConfig`
  // shouldn't clobber the user's prior dismissal when other fields change.
  const existing = readConfig();
  writeConfig({
    registryRoot: _registryRoot,
    dismissedAppUpdateVersion: _dismissedAppUpdateVersion,
    linkedRepo: _linkedRepo,
    weakStorageNoticeDismissedFor: existing.weakStorageNoticeDismissedFor,
  });
}

// ─── Snapshot / mutating handle ───────────────────────────────────────────────

/**
 * Best-effort registry snapshot writer. Invoked from every IPC handler
 * that mutates registry membership or per-skill metadata. True up the
 * manifest against folders on disk first (the single manifest-write
 * seam — ADR-0020/0021), then snapshot the resulting live record.
 */
export function snapshotAfterMutation(): void {
  if (!_registryRoot) return;
  try {
    reconcileFoldersToManifestSafe(_registryRoot, {
      labels: readLabelsFile(),
      linkedRepo: _linkedRepo?.fullName,
    });
    const manifest = exportRegistryManifest(_registryRoot, {
      labels: readLabelsFile(),
    });
    writeRegistrySnapshot({
      userDataDir: app.getPath("userData"),
      manifest,
    });
  } catch {
    // Swallow — see JSDoc.
  }
}

/**
 * Wrap an IPC handler so that every invocation triggers a registry
 * auto-snapshot in its `finally` block. Used in place of
 * `ipcMain.handle` for any channel that mutates registry membership
 * or per-skill metadata.
 */
export function mutatingHandle<P extends unknown[], R>(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: P) => R | Promise<R>,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...(args as P));
    } finally {
      snapshotAfterMutation();
    }
  });
}

// ─── Manifest export context ──────────────────────────────────────────────────

/**
 * Shared `exportRegistryManifest` inputs sourced from app state: the
 * local curation labels.
 */
export function manifestExportContext(): {
  labels: import("@skills-bank/core").LabelsMap;
} {
  return { labels: readLabelsFile() };
}

// ─── Labels file helpers ─────────────────────────────────────────────────────

function labelsFilePath(): string {
  return path.join(app.getPath("userData"), "labels.json");
}

export function readLabelsFile(): import("@skills-bank/core").LabelsMap {
  const p = labelsFilePath();
  if (!fs.existsSync(p)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Record<
      string,
      Record<string, unknown>
    >;
    // Tolerant read: migrate legacy `addedTags` → `tags` (renamed in v1.19).
    const out: import("@skills-bank/core").LabelsMap = {};
    for (const [name, entry] of Object.entries(raw)) {
      if ("addedTags" in entry && !("tags" in entry)) {
        const { addedTags, ...rest } = entry;
        out[name] = {
          ...rest,
          tags: addedTags,
        } as import("@skills-bank/core").SkillLabelOverride;
      } else {
        out[name] = entry as import("@skills-bank/core").SkillLabelOverride;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function writeLabelsFile(
  data: import("@skills-bank/core").LabelsMap,
): void {
  fs.writeFileSync(labelsFilePath(), JSON.stringify(data, null, 2) + "\n");
}

/**
 * Merge the label overrides an import reconstructed from a manifest into
 * the local `labels.json`. Per-skill, the pulled override replaces the
 * local one (the manifest is the authority being applied).
 */
export function applyRestoredLabels(
  restored: import("@skills-bank/core").LabelsMap | undefined,
): void {
  if (!restored || Object.keys(restored).length === 0) return;
  const data = readLabelsFile();
  for (const [name, override] of Object.entries(restored)) {
    data[name] = override;
  }
  writeLabelsFile(data);
}

// ─── Probe runner ─────────────────────────────────────────────────────────────

let _probeRunner: ReturnType<typeof createOriginProbeRunner> | null = null;

export function initProbeRunner(
  runner: ReturnType<typeof createOriginProbeRunner>,
): void {
  _probeRunner = runner;
}

export async function runUpstreamProbe(): Promise<OriginProbeResult> {
  if (!_probeRunner) throw new Error("probe runner not initialized");
  return _probeRunner.run();
}

export function notifyProbeComplete(
  event: OriginProbeCompleteEvent = {},
): void {
  if (!_probeRunner) return;
  // Re-emit through the runner's onComplete so empty refresh nudges
  // and probe results follow the same channel.
  if (Object.keys(event).length === 0) {
    _probeRunner.notifyRefresh();
    return;
  }
  const { BrowserWindow } = require("electron") as typeof import("electron");
  const wins = BrowserWindow.getAllWindows();
  for (const win of wins) {
    if (!win.isDestroyed()) win.webContents.send(IPC.originProbe, event);
  }
}

export function augmentWithProbedUpdates<T extends { name: string }>(
  entries: T[],
): T[] {
  if (!_probeRunner) return entries;
  return _probeRunner.augmentEntries(entries);
}

// Compatibility shim: the old `probedUpdates.delete(name)` call sites
// keep using a Map-like object so the diff stays small.
export const probedUpdates = {
  delete: (name: string) => _probeRunner?.clearUpdate(name),
};

// ─── Shared constant ──────────────────────────────────────────────────────────

export const NO_ROOT_MSG =
  "Registry folder not configured. Use the Settings button to pick the skills-bank repo.";
