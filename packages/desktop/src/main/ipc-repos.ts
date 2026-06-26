import { ipcMain } from "electron";
import {
  fetchRepoDefaultBranch,
  fetchUserRepos,
  fromCaught,
  syncTarballToRegistry,
} from "@skills-bank/core";
import { getStoredToken } from "./auth.js";
import {
  getLinkedRepo,
  getRegistryRoot,
  mutatingHandle,
  NO_ROOT_MSG,
  persistConfig,
  setLinkedRepo,
  setRegistrySource,
  snapshotAfterMutation,
} from "./main-state.js";
import { broadcastSyncStatus, runSync } from "./ipc-manifest.js";
import { setReplaceRegistryWithRepo } from "./ipc-manifest.js";
import {
  IPC,
  BUNDLED_REPO,
  type LinkedRepoMetadata,
  type UserRepo,
} from "../shared/ipc.js";

// Import reconcileOriginsBeforeExport locally to avoid re-export
import {
  fetchOriginTree,
  reconcileResidentOrigins,
  buildSkillFolderMap,
} from "@skills-bank/core";

async function reconcileOriginsBeforeExport(
  root: string,
  repo: string,
  branch: string,
  token: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const tree = await fetchOriginTree(repo, token, { ref: branch });
  if (!tree.ok) return { ok: false, message: tree.message };
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
 * v0.11.9 M8: commit the github-linked-mode flip atomically.
 */
function commitGithubLinkage(meta: LinkedRepoMetadata): void {
  setRegistrySource("github");
  setLinkedRepo(meta);
  persistConfig();
}

export async function replaceRegistryWithRepo(fullName: string): Promise<{
  ok: boolean;
  message: string;
  importedCount?: number;
  conflictCount?: number;
  error?: ReturnType<typeof fromCaught>;
}> {
  const registryRoot = getRegistryRoot();
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  const root = registryRoot;
  const token = getStoredToken();
  if (!token) return { ok: false, message: "not authenticated" };
  const slash = fullName.indexOf("/");
  if (slash <= 0) {
    return { ok: false, message: `invalid repo: ${fullName}` };
  }
  const owner = fullName.slice(0, slash);
  const repo = fullName.slice(slash + 1);

  try {
    const report = await syncTarballToRegistry({
      registryRoot,
      owner,
      repo,
      token,
      mountTo: "personal",
      onStatus: (phase) => broadcastSyncStatus({ kind: phase }),
    });
    if (
      report.upserted.length === 0 &&
      report.conflicts.length === 0 &&
      report.unchanged.length === 0
    ) {
      broadcastSyncStatus({ kind: "idle" });
      const detail =
        (report.discoveryCollisions ?? []).length > 0
          ? ` (${report.discoveryCollisions!.length} name collision${report.discoveryCollisions!.length === 1 ? "" : "s"} in the source tree)`
          : "";
      return {
        ok: false,
        message: `${fullName} has no skills the app can recognize${detail}. A skill folder needs a SKILL.md.`,
      };
    }
    broadcastSyncStatus({
      kind: "done",
      upserted: report.upserted,
      conflicts: report.conflicts.length,
      orphaned: report.orphaned,
      commitSha: report.commitSha,
    });
    const fetchedDefaultBranch = await fetchRepoDefaultBranch(fullName, token);
    commitGithubLinkage({
      fullName,
      lastFetchedAt: report.syncedAt,
      syncedFromCommit: report.commitSha,
      defaultBranch: fetchedDefaultBranch,
    });
    await reconcileOriginsBeforeExport(
      root,
      fullName,
      fetchedDefaultBranch ?? "HEAD",
      token,
    );
    const message =
      report.conflicts.length > 0
        ? `synced ${report.upserted.length} from ${fullName}, ${report.conflicts.length} conflict(s) need review`
        : report.upserted.length === 0
          ? `${fullName} is already up to date (${report.unchanged.length} skill(s) unchanged)`
          : `synced ${report.upserted.length} skill(s) from ${fullName}`;
    return {
      ok: true,
      message,
      importedCount: report.upserted.length,
      conflictCount: report.conflicts.length,
    };
  } catch (err) {
    const error = fromCaught("ipc.unknown", err);
    broadcastSyncStatus({ kind: "error", message: error.message });
    return { ok: false, message: error.message, error };
  }
}

export function registerReposHandlers(): void {
  // Wire the replaceRegistryWithRepo into manifest module's resolveConflicts
  setReplaceRegistryWithRepo(replaceRegistryWithRepo);

  ipcMain.handle(IPC.reposListMine, async (): Promise<UserRepo[]> => {
    const token = getStoredToken();
    if (!token) throw new Error("not authenticated");
    return fetchUserRepos(token);
  });

  mutatingHandle(IPC.reposReplaceRegistry, async (_e, fullName: string) =>
    replaceRegistryWithRepo(fullName),
  );

  mutatingHandle(IPC.reposRefreshCurrent, async () => {
    const linkedRepo = getLinkedRepo();
    const target = linkedRepo?.fullName ?? BUNDLED_REPO;
    return replaceRegistryWithRepo(target);
  });
}
