import { app, BrowserWindow, dialog, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  applyManifestResolutions,
  buildRegistryIndex,
  clearPendingManifestConflicts,
  diffManifests,
  exportRegistryManifest,
  fetchOriginTree,
  fetchRemoteManifest,
  findSkillFolder,
  fromCaught,
  GH_API,
  ghFetch as coreGhFetch,
  importRegistryManifest,
  MANIFEST_SCHEMA_VERSION,
  mergeManifests,
  reconcileRegistryToManifest,
  reconcileResidentOrigins,
  buildSkillFolderMap,
  readMergeBase,
  readPendingManifestConflicts,
  resolveRenameTarget,
  serializeManifest,
  syncTarballToRegistry,
  writeMergeBase,
  writePendingManifestConflicts,
  writeSyncDecisions,
  getAgent,
  getDefaultInstallAgents,
  linkSkillToAgents,
  readLastSyncReport,
  readPendingConflicts,
  type ManifestDecisions,
  type ManifestSkill,
  type RateLimitInfo,
  type RegistryManifest,
  type SyncDecisions,
} from "@skills-bank/core";
import { getStoredToken } from "./auth.js";
import {
  applyRestoredLabels,
  getInFlightImportAbort,
  getLinkedRepo,
  getRegistryRoot,
  getRegistrySource,
  manifestExportContext,
  mutatingHandle,
  NO_ROOT_MSG,
  setInFlightImportAbort,
  snapshotAfterMutation,
} from "./main-state.js";
import {
  IPC,
  type PreviewManifestPushResult,
  type PushManifestToRepoResult,
  type ReadManifestFromRepoResult,
  type ResolveManifestConflictsResult,
  type RunManifestMergeResult,
  type SyncStatus,
} from "../shared/ipc.js";
import type { AgentId } from "@skills-bank/core";

// Import replaceRegistryWithRepo lazily to avoid circular deps — it's
// defined in ipc-repos.ts and only needed by resolveConflicts.
// We use a dynamic getter so the module is resolved at call time.
let _replaceRegistryWithRepo:
  | ((fullName: string) => Promise<{
      ok: boolean;
      message: string;
      importedCount?: number;
      conflictCount?: number;
      error?: ReturnType<typeof fromCaught>;
    }>)
  | null = null;

export function setReplaceRegistryWithRepo(
  fn: (fullName: string) => Promise<{
    ok: boolean;
    message: string;
    importedCount?: number;
    conflictCount?: number;
    error?: ReturnType<typeof fromCaught>;
  }>,
): void {
  _replaceRegistryWithRepo = fn;
}

// ─── Sync status broadcast ────────────────────────────────────────────────────

function broadcastSyncStatus(status: SyncStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.syncStatus, status);
  }
}

/**
 * Fan a manifest-import progress event out to every renderer window.
 */
function broadcastManifestImportProgress(
  event: import("@skills-bank/core").ManifestImportProgressEvent,
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed())
      win.webContents.send(IPC.manifestImportProgress, event);
  }
}

// ─── Reconcile helpers ────────────────────────────────────────────────────────

/**
 * Reconcile resident skills' origins against the linked repo's actual
 * layout before a manifest is exported, so the committed manifest records
 * truthful, re-fetchable pointers and stale third-party probes stop.
 */
async function reconcileOriginsBeforeExport(
  root: string,
  repo: string,
  branch: string,
  token: string,
): Promise<
  { ok: true } | { ok: false; message: string; rateLimit?: RateLimitInfo }
> {
  const tree = await fetchOriginTree(repo, token, { ref: branch });
  if (!tree.ok) {
    return tree.rateLimit
      ? { ok: false, message: tree.message, rateLimit: tree.rateLimit }
      : { ok: false, message: tree.message };
  }
  if (tree.truncated) {
    return {
      ok: false,
      message: `${repo}'s tree is too large to read reliably — origins not reconciled`,
    };
  }
  reconcileResidentOrigins(root, buildSkillFolderMap(tree.tree), repo);
  return { ok: true };
}

/**
 * Reconcile the local registry to `manifest` via the core primitive,
 * then persist the labels it reconstructed.
 */
async function reconcileLocalToManifest(
  root: string,
  manifest: RegistryManifest,
): Promise<string[]> {
  const { removed, restoredLabels } = await reconcileRegistryToManifest(
    root,
    manifest,
    { token: getStoredToken(), onProgress: broadcastManifestImportProgress },
  );
  applyRestoredLabels(restoredLabels);
  return removed;
}

// ─── Manifest import core ─────────────────────────────────────────────────────

async function runManifestImportCore(manifest: RegistryManifest): Promise<
  | { ok: false; message: string; error?: ReturnType<typeof fromCaught> }
  | {
      ok: true;
      message: string;
      result: Awaited<ReturnType<typeof importRegistryManifest>>;
    }
> {
  const registryRoot = getRegistryRoot();
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  const sv = (manifest as unknown as { schemaVersion: unknown }).schemaVersion;
  if (sv !== 2 && sv !== 3 && sv !== 4) {
    return {
      ok: false,
      message: `Unsupported manifest schemaVersion ${String(sv)} — this build understands v2, v3, and v4.`,
    };
  }
  const controller = new AbortController();
  setInFlightImportAbort(controller);
  let importResult;
  try {
    importResult = await importRegistryManifest(registryRoot, manifest, {
      token: getStoredToken(),
      signal: controller.signal,
      onProgress: broadcastManifestImportProgress,
    });
  } finally {
    setInFlightImportAbort(null);
  }
  applyRestoredLabels(importResult.restoredLabels);
  buildRegistryIndex(registryRoot, { includeGitInfo: true, writeFile: true });
  snapshotAfterMutation();
  const registered = importResult.outcomes.filter(
    (o) => o.result === "registered",
  ).length;
  const collisions = importResult.outcomes.filter(
    (o) => o.result === "collision",
  ).length;
  const unreachable = importResult.outcomes.filter(
    (o) => o.result === "origin-unreachable",
  ).length;
  const parts = [`${registered} restored`];
  if (collisions > 0)
    parts.push(`${collisions} collision${collisions === 1 ? "" : "s"}`);
  if (unreachable > 0)
    parts.push(
      `${unreachable} unreachable origin${unreachable === 1 ? "" : "s"}`,
    );
  return { ok: true, message: parts.join(", "), result: importResult };
}

// ─── Export / import manifest ─────────────────────────────────────────────────

async function writeManifestToDisk(): Promise<{
  ok: boolean;
  message: string;
  skillCount?: number;
  destPath?: string;
  error?: ReturnType<typeof fromCaught>;
}> {
  const registryRoot = getRegistryRoot();
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  try {
    const win = BrowserWindow.getFocusedWindow();
    const sourceBankVersion = app.getVersion();
    const defaultName = `${sourceBankVersion}-registry.json`;
    const result = await dialog.showSaveDialog(win ?? undefined!, {
      title: "Export registry manifest",
      defaultPath: defaultName,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, message: "export cancelled" };
    }
    const manifest = exportRegistryManifest(registryRoot, {
      sourceBankVersion,
      ...manifestExportContext(),
    });
    fs.writeFileSync(result.filePath, JSON.stringify(manifest, null, 2) + "\n");
    return {
      ok: true,
      message: `Exported ${manifest.skills.length} skill${manifest.skills.length === 1 ? "" : "s"} → ${result.filePath}`,
      skillCount: manifest.skills.length,
      destPath: result.filePath,
    };
  } catch (err) {
    const error = fromCaught("ipc.unknown", err);
    return { ok: false, message: error.message, error };
  }
}

async function readManifestFromDisk(): Promise<
  | { ok: false; message: string; error?: ReturnType<typeof fromCaught> }
  | {
      ok: true;
      message: string;
      result: Awaited<ReturnType<typeof importRegistryManifest>>;
    }
> {
  const registryRoot = getRegistryRoot();
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  try {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: "Import registry manifest",
      message: "Pick a manifest JSON file exported from another Skills Bank.",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
      defaultPath: app.getPath("home"),
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, message: "cancelled" };
    }
    const raw = fs.readFileSync(result.filePaths[0]!, "utf8");
    let manifest: RegistryManifest;
    try {
      manifest = JSON.parse(raw) as RegistryManifest;
    } catch (parseErr) {
      const error = fromCaught("ipc.unknown", parseErr);
      return {
        ok: false,
        message: `Invalid manifest JSON: ${error.message}`,
        error,
      };
    }
    return runManifestImportCore(manifest);
  } catch (err) {
    const error = fromCaught("ipc.unknown", err);
    return { ok: false, message: error.message, error };
  }
}

// ─── Canonical sync ───────────────────────────────────────────────────────────

const CANONICAL_OWNER = "Tyler-Reagan";
const CANONICAL_REPO = "skills-bank";

async function runSync(): Promise<{
  ok: boolean;
  message: string;
  error?: import("@skills-bank/core").AppError;
}> {
  const registryRoot = getRegistryRoot();
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  try {
    const token = getStoredToken();
    const report = await syncTarballToRegistry({
      registryRoot,
      owner: CANONICAL_OWNER,
      repo: CANONICAL_REPO,
      ...(token ? { token } : {}),
      mountTo: "vendored",
      onStatus: (phase) => broadcastSyncStatus({ kind: phase }),
    });
    broadcastSyncStatus({
      kind: "done",
      upserted: report.upserted,
      conflicts: report.conflicts.length,
      orphaned: report.orphaned,
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
  } catch (err) {
    const error = fromCaught("sync.run-failed", err);
    broadcastSyncStatus({ kind: "error", message: error.message });
    return { ok: false, message: error.message, error };
  }
}

export { runSync, broadcastSyncStatus };

// ─── Register handlers ────────────────────────────────────────────────────────

export function registerManifestHandlers(): void {
  ipcMain.handle(IPC.exportManifest, writeManifestToDisk);
  ipcMain.handle(IPC.importManifest, readManifestFromDisk);

  ipcMain.handle(IPC.importManifestCancel, () => {
    getInFlightImportAbort()?.abort();
    return { ok: true };
  });

  ipcMain.handle(
    IPC.previewManifestPush,
    async (): Promise<PreviewManifestPushResult> => {
      const registryRoot = getRegistryRoot();
      const linkedRepo = getLinkedRepo();
      if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
      if (!linkedRepo) return { ok: false, message: "no linked repo" };
      const token = getStoredToken();
      if (!token) return { ok: false, message: "not authenticated" };
      const branch = linkedRepo.defaultBranch ?? "main";
      const root = registryRoot;
      await reconcileOriginsBeforeExport(
        root,
        linkedRepo.fullName,
        branch,
        token,
      );
      const sourceBankVersion = app.getVersion();
      const localManifest = exportRegistryManifest(root, {
        sourceBankVersion,
        ...manifestExportContext(),
      });
      const remote = await fetchRemoteManifest(
        linkedRepo.fullName,
        branch,
        token,
      );
      if (!remote.ok) {
        return {
          ok: false,
          message: remote.message,
          rateLimit: remote.rateLimit,
        };
      }
      const diff = diffManifests(localManifest, remote.manifest);
      return {
        ok: true,
        diff,
        skillCount: localManifest.skills.length,
        repo: linkedRepo.fullName,
        branch,
      };
    },
  );

  ipcMain.handle(
    IPC.pushManifestToRepo,
    async (_e, opts: { asPR: boolean }): Promise<PushManifestToRepoResult> => {
      const registryRoot = getRegistryRoot();
      const linkedRepo = getLinkedRepo();
      if (!registryRoot)
        return { ok: false, reason: "write-failed", message: NO_ROOT_MSG };
      if (!linkedRepo)
        return {
          ok: false,
          reason: "write-failed",
          message: "no linked repo",
        };
      const token = getStoredToken();
      if (!token)
        return {
          ok: false,
          reason: "write-failed",
          message: "not authenticated",
        };
      const branch = linkedRepo.defaultBranch ?? "main";
      const root = registryRoot;
      const reconciled = await reconcileOriginsBeforeExport(
        root,
        linkedRepo.fullName,
        branch,
        token,
      );
      if (!reconciled.ok) {
        return reconciled.rateLimit
          ? {
              ok: false,
              reason: "rate-limit",
              message: reconciled.message,
              rateLimit: reconciled.rateLimit,
            }
          : { ok: false, reason: "write-failed", message: reconciled.message };
      }
      const sourceBankVersion = app.getVersion();
      const manifest = exportRegistryManifest(root, {
        sourceBankVersion,
        ...manifestExportContext(),
      });
      const content = serializeManifest(manifest);
      const commitMessage = "chore: update registry manifest";

      if (!opts.asPR) {
        const remote = await fetchRemoteManifest(
          linkedRepo.fullName,
          branch,
          token,
        );
        if (!remote.ok) {
          return remote.reason === "rate-limit" && remote.rateLimit
            ? {
                ok: false,
                reason: "rate-limit",
                message: remote.message,
                rateLimit: remote.rateLimit,
              }
            : { ok: false, reason: "write-failed", message: remote.message };
        }
        const baseManifest = readMergeBase(registryRoot) ?? {
          schemaVersion: MANIFEST_SCHEMA_VERSION,
          exportedAt: "",
          sourceBankVersion: "",
          skills: [],
        };
        if (
          serializeManifest(remote.manifest) !==
          serializeManifest(baseManifest)
        ) {
          return {
            ok: false,
            reason: "diverged",
            message:
              "The linked repo changed since your last sync — pull & merge before pushing.",
          };
        }
        const { writeRepoFile } = await import("@skills-bank/core");
        const res = await writeRepoFile({
          repo: linkedRepo.fullName,
          path: "registry-manifest.json",
          content,
          message: commitMessage,
          branch,
          token,
        });
        if (!res.ok) {
          if (res.rateLimit)
            return {
              ok: false,
              reason: "rate-limit",
              message: res.message,
              rateLimit: res.rateLimit,
            };
          return { ok: false, reason: "write-failed", message: res.message };
        }
        writeMergeBase(registryRoot, manifest);
        return {
          ok: true,
          commitSha: res.commitSha,
          htmlUrl: res.htmlUrl,
          skillCount: manifest.skills.length,
        };
      }

      // PR path
      const prBranch = "manifest/registry-manifest";
      const ownerSegment = linkedRepo.fullName.split("/")[0];
      const prsRes = await coreGhFetch<{ number: number; html_url: string }[]>(
        `${GH_API}/repos/${linkedRepo.fullName}/pulls?head=${ownerSegment}:${prBranch}&state=open`,
        { method: "GET" },
        token,
      );
      if (!prsRes.ok) {
        if (prsRes.rateLimit)
          return {
            ok: false,
            reason: "rate-limit",
            message: prsRes.message,
            rateLimit: prsRes.rateLimit,
          };
        return { ok: false, reason: "write-failed", message: prsRes.message };
      }
      const existingPr = prsRes.body[0] ?? null;

      const { writeRepoFileAsBranch } = await import("@skills-bank/core");
      const writeRes = await writeRepoFileAsBranch({
        repo: linkedRepo.fullName,
        path: "registry-manifest.json",
        content,
        message: commitMessage,
        branch: prBranch,
        baseBranch: branch,
        token,
      });
      if (!writeRes.ok) {
        if (writeRes.rateLimit)
          return {
            ok: false,
            reason: "rate-limit",
            message: writeRes.message,
            rateLimit: writeRes.rateLimit,
          };
        return {
          ok: false,
          reason: "write-failed",
          message: writeRes.message,
        };
      }

      if (existingPr) {
        return {
          ok: true,
          commitSha: writeRes.commitSha,
          htmlUrl: existingPr.html_url,
          prNumber: existingPr.number,
          skillCount: manifest.skills.length,
        };
      }

      const diff = diffManifests(manifest, {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        exportedAt: "",
        sourceBankVersion: "",
        skills: [],
      });
      const prBody = `+${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed`;
      const prRes = await coreGhFetch<{ html_url: string; number: number }>(
        `${GH_API}/repos/${linkedRepo.fullName}/pulls`,
        {
          method: "POST",
          body: JSON.stringify({
            title: commitMessage,
            body: prBody,
            head: prBranch,
            base: branch,
          }),
          headers: { "Content-Type": "application/json" },
        },
        token,
      );
      if (!prRes.ok) {
        if (prRes.rateLimit)
          return {
            ok: false,
            reason: "rate-limit",
            message: prRes.message,
            rateLimit: prRes.rateLimit,
          };
        return { ok: false, reason: "write-failed", message: prRes.message };
      }
      return {
        ok: true,
        commitSha: writeRes.commitSha,
        htmlUrl: prRes.body.html_url,
        prNumber: prRes.body.number,
        skillCount: manifest.skills.length,
      };
    },
  );

  ipcMain.handle(
    IPC.readManifestFromRepo,
    async (): Promise<ReadManifestFromRepoResult> => {
      const registryRoot = getRegistryRoot();
      const linkedRepo = getLinkedRepo();
      if (!registryRoot)
        return { ok: false, reason: "read-failed", message: NO_ROOT_MSG };
      if (!linkedRepo)
        return { ok: false, reason: "read-failed", message: "no linked repo" };
      const token = getStoredToken();
      if (!token)
        return {
          ok: false,
          reason: "read-failed",
          message: "not authenticated",
        };
      const branch = linkedRepo.defaultBranch ?? "main";
      const { readRepoFile } = await import("@skills-bank/core");
      const res = await readRepoFile({
        repo: linkedRepo.fullName,
        path: "registry-manifest.json",
        ref: branch,
        token,
      });
      if (!res.ok) {
        if (res.status === 404) return { ok: false, reason: "not-found" };
        if (res.rateLimit)
          return {
            ok: false,
            reason: "rate-limit",
            message: res.message,
            rateLimit: res.rateLimit,
          };
        return { ok: false, reason: "read-failed", message: res.message };
      }
      let remoteManifest: RegistryManifest;
      try {
        remoteManifest = JSON.parse(res.content) as RegistryManifest;
      } catch (e) {
        return { ok: false, reason: "parse-failed", message: String(e) };
      }
      const sourceBankVersion = app.getVersion();
      const localManifest = exportRegistryManifest(registryRoot, {
        sourceBankVersion,
        ...manifestExportContext(),
      });
      const diff = diffManifests(remoteManifest, localManifest);
      return { ok: true, manifest: remoteManifest, diff };
    },
  );

  ipcMain.handle(IPC.getPendingManifestConflicts, () => {
    const registryRoot = getRegistryRoot();
    if (!registryRoot) return null;
    return readPendingManifestConflicts(registryRoot);
  });

  ipcMain.handle(IPC.clearPendingManifestConflicts, () => {
    const registryRoot = getRegistryRoot();
    if (!registryRoot) return { ok: false, removed: false };
    const r = clearPendingManifestConflicts(registryRoot);
    return { ok: true, removed: r.removed };
  });

  ipcMain.handle(
    IPC.resolveManifestConflicts,
    async (
      _e,
      decisions: ManifestDecisions,
    ): Promise<ResolveManifestConflictsResult> => {
      const registryRoot = getRegistryRoot();
      if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
      const pending = readPendingManifestConflicts(registryRoot);
      if (!pending) {
        return { ok: false, message: "no pending manifest conflicts" };
      }
      const root = registryRoot;

      const resolved = applyManifestResolutions(
        { merged: pending.merged, conflicts: pending.conflicts },
        decisions,
      );

      const renamed: { from: string; to: string }[] = [];
      for (const { from, to } of resolved.renamed) {
        const ref = findSkillFolder(root, from);
        if (!ref) continue;
        const parent = path.dirname(ref.dir);
        const actualTo = fs.existsSync(path.join(parent, to))
          ? resolveRenameTarget(parent, from)
          : to;
        fs.renameSync(ref.dir, path.join(parent, actualTo));
        if (actualTo !== to) {
          const entry = resolved.manifest.skills.find((s) => s.name === to);
          if (entry) entry.name = actualTo;
        }
        renamed.push({ from, to: actualTo });
      }

      try {
        const removed = await reconcileLocalToManifest(root, resolved.manifest);
        clearPendingManifestConflicts(root);
        writeMergeBase(root, pending.theirs);
        return {
          ok: true,
          message: `Resolved ${pending.conflicts.length} conflict${
            pending.conflicts.length === 1 ? "" : "s"
          }${removed.length > 0 ? `, removed ${removed.length}` : ""}${
            renamed.length > 0 ? `, forked ${renamed.length}` : ""
          }.`,
          removed,
          renamed,
        };
      } catch (err) {
        return {
          ok: false,
          message: `reconcile failed: ${(err as Error).message}`,
          error: fromCaught("manifest.resolve-failed", err),
        };
      }
    },
  );

  ipcMain.handle(
    IPC.runManifestMerge,
    async (): Promise<RunManifestMergeResult> => {
      const registryRoot = getRegistryRoot();
      const linkedRepo = getLinkedRepo();
      if (!registryRoot)
        return { ok: false, reason: "read-failed", message: NO_ROOT_MSG };
      if (!linkedRepo)
        return { ok: false, reason: "read-failed", message: "no linked repo" };
      const token = getStoredToken();
      if (!token)
        return {
          ok: false,
          reason: "read-failed",
          message: "not authenticated",
        };
      const root = registryRoot;
      const branch = linkedRepo.defaultBranch ?? "main";

      const remote = await fetchRemoteManifest(
        linkedRepo.fullName,
        branch,
        token,
      );
      if (!remote.ok) {
        return remote.reason === "rate-limit" && remote.rateLimit
          ? {
              ok: false,
              reason: "rate-limit",
              message: remote.message,
              rateLimit: remote.rateLimit,
            }
          : { ok: false, reason: "read-failed", message: remote.message };
      }

      const ours = exportRegistryManifest(root, {
        sourceBankVersion: app.getVersion(),
        ...manifestExportContext(),
      });
      const base = readMergeBase(root) ?? {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        exportedAt: "",
        sourceBankVersion: "",
        skills: [],
      };

      const { merged, conflicts } = mergeManifests(base, ours, remote.manifest);

      if (conflicts.length > 0) {
        writePendingManifestConflicts(root, {
          mergedAt: new Date().toISOString(),
          conflicts,
          merged,
          theirs: remote.manifest,
        });
        return { ok: true, status: "conflicts", conflicts };
      }

      try {
        const removed = await reconcileLocalToManifest(root, merged);
        writeMergeBase(root, remote.manifest);
        return {
          ok: true,
          status: "merged",
          message: `Merged cleanly${
            removed.length > 0 ? ` (removed ${removed.length})` : ""
          }.`,
          removed,
        };
      } catch (err) {
        return {
          ok: false,
          reason: "reconcile-failed",
          message: (err as Error).message,
        };
      }
    },
  );

  ipcMain.handle(
    IPC.manifestImportRetrySkill,
    async (_e, skill: ManifestSkill) => {
      const registryRoot = getRegistryRoot();
      if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
      if (
        !skill ||
        typeof skill !== "object" ||
        typeof skill.name !== "string"
      ) {
        return { ok: false, message: "invalid skill payload" };
      }
      const singleManifest: RegistryManifest = {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        sourceBankVersion: app.getVersion(),
        skills: [skill],
      };
      try {
        const result = await importRegistryManifest(
          registryRoot,
          singleManifest,
          { token: getStoredToken() },
        );
        buildRegistryIndex(registryRoot, {
          includeGitInfo: true,
          writeFile: true,
        });
        snapshotAfterMutation();
        const outcome = result.outcomes[0];
        if (!outcome) {
          return { ok: false, message: "no outcome returned" };
        }
        return { ok: true, outcome };
      } catch (err) {
        const error = fromCaught("ipc.unknown", err);
        return { ok: false, message: error.message };
      }
    },
  );

  ipcMain.handle(
    IPC.installFromManifestHint,
    async (_e, payload: { names: string[]; agents: AgentId[] }) => {
      const registryRoot = getRegistryRoot();
      if (!registryRoot) {
        return {
          ok: false,
          message: NO_ROOT_MSG,
          installedCount: 0,
          errors: [NO_ROOT_MSG],
        };
      }
      const names = Array.isArray(payload?.names) ? payload.names : [];
      const agents = Array.isArray(payload?.agents) ? payload.agents : [];
      const errors: string[] = [];
      let installedCount = 0;
      for (const name of names) {
        try {
          const found = findSkillFolder(registryRoot, name);
          if (!found) throw new Error(`Skill "${name}" not found in registry.`);
          const targetAgents =
            (agents as AgentId[]).length > 0
              ? (agents as AgentId[]).map(getAgent)
              : getDefaultInstallAgents();
          const r = linkSkillToAgents(found.dir, targetAgents);
          if (r.anyNew) installedCount++;
          for (const e of r.errors) {
            errors.push(`${name} → ${e.agent}: ${e.message}`);
          }
        } catch (err) {
          errors.push(`${name}: ${(err as Error).message}`);
        }
      }
      snapshotAfterMutation();
      return {
        ok: errors.length === 0,
        message:
          installedCount > 0
            ? `Installed ${installedCount} skill${installedCount === 1 ? "" : "s"} across ${agents.length} agent${agents.length === 1 ? "" : "s"}.`
            : `No new installs (${errors.length} error${errors.length === 1 ? "" : "s"}).`,
        installedCount,
        errors,
      };
    },
  );

  // ─── Canonical sync handlers ────────────────────────────────────────────────

  mutatingHandle(IPC.syncCanonical, () => runSync());

  ipcMain.handle(IPC.getSyncReport, () => {
    const registryRoot = getRegistryRoot();
    if (!registryRoot) return null;
    return readLastSyncReport(registryRoot);
  });

  ipcMain.handle(IPC.getPendingConflicts, () => {
    const registryRoot = getRegistryRoot();
    if (!registryRoot) return null;
    return readPendingConflicts(registryRoot);
  });

  mutatingHandle(IPC.resolveConflicts, async (_e, decisions: SyncDecisions) => {
    const registryRoot = getRegistryRoot();
    const linkedRepo = getLinkedRepo();
    const registrySource = getRegistrySource();
    if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
    try {
      writeSyncDecisions(registryRoot, decisions);
    } catch (err) {
      return (() => {
        const error = fromCaught("ipc.unknown", err);
        return { ok: false, message: error.message, error };
      })();
    }
    if (registrySource === "github" && linkedRepo) {
      if (!_replaceRegistryWithRepo) {
        return { ok: false, message: "replaceRegistryWithRepo not initialized" };
      }
      return _replaceRegistryWithRepo(linkedRepo.fullName);
    }
    return runSync();
  });
}
