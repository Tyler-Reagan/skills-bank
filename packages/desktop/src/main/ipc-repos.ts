import { ipcMain } from "electron";
import {
  fetchRemoteManifest,
  fetchRepoDefaultBranch,
  fetchUserRepos,
  fromCaught,
  reconcileRegistryToManifest,
  writeMergeBase,
} from "@skills-bank/core";
import { getStoredToken } from "./auth.js";
import {
  applyRestoredLabels,
  getLinkedRepo,
  getRegistryRoot,
  mutatingHandle,
  NO_ROOT_MSG,
  persistConfig,
  setLinkedRepo,
  setRegistrySource,
} from "./main-state.js";
import { IPC, type LinkedRepoMetadata, type UserRepo } from "../shared/ipc.js";

/**
 * v0.11.9 M8: commit the github-linked-mode flip atomically.
 */
function commitGithubLinkage(meta: LinkedRepoMetadata): void {
  setRegistrySource("github");
  setLinkedRepo(meta);
  persistConfig();
}

/**
 * Link (or re-link) the registry to `fullName` and pull its manifest —
 * the one manifest engine that backs both first-link and ongoing pulls
 * (ADR-0021). Fetches the remote `registry-manifest.json`, reconciles
 * the local registry to match it (mirrors GitHub-origin adds, applies
 * confirmed removals via the pushed-projection removal basis), then
 * commits the linkage.
 */
export async function replaceRegistryWithRepo(fullName: string): Promise<{
  ok: boolean;
  message: string;
  importedCount?: number;
  conflictCount?: number;
  error?: ReturnType<typeof fromCaught>;
}> {
  const registryRoot = getRegistryRoot();
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  const token = getStoredToken();
  if (!token) return { ok: false, message: "not authenticated" };
  const slash = fullName.indexOf("/");
  if (slash <= 0) {
    return { ok: false, message: `invalid repo: ${fullName}` };
  }

  try {
    const fetchedDefaultBranch = await fetchRepoDefaultBranch(fullName, token);
    const branch = fetchedDefaultBranch ?? "HEAD";
    const remote = await fetchRemoteManifest(fullName, branch, token);
    if (!remote.ok) {
      return { ok: false, message: remote.message };
    }
    const { removed, restoredLabels } = await reconcileRegistryToManifest(
      registryRoot,
      remote.manifest,
      { token, linkedRepo: fullName },
    );
    applyRestoredLabels(restoredLabels);
    // Establish the merge base at link time (finding F3). Without this the
    // first Import runs with readMergeBase() === null → every co-present
    // skill reads as both-added and any signature diff becomes a spurious
    // conflict; the direct-commit guard would also see universal divergence.
    // The fetched remote manifest is exactly that base — mirrors the Import
    // path (ipc-manifest runManifestMerge). syncedFromCommit stays unset:
    // fetchRemoteManifest carries no SHA and the guard compares manifests.
    writeMergeBase(registryRoot, remote.manifest);
    commitGithubLinkage({
      fullName,
      lastFetchedAt: new Date().toISOString(),
      syncedFromCommit: "",
      defaultBranch: fetchedDefaultBranch,
    });
    const importedCount = remote.manifest.skills.length;
    const message =
      removed.length > 0
        ? `linked ${fullName}: ${importedCount} skill(s), removed ${removed.length}`
        : `linked ${fullName}: ${importedCount} skill(s)`;
    return { ok: true, message, importedCount };
  } catch (err) {
    const error = fromCaught("ipc.unknown", err);
    return { ok: false, message: error.message, error };
  }
}

export function registerReposHandlers(): void {
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
    if (!linkedRepo) {
      return { ok: false, message: "no linked repo" };
    }
    return replaceRegistryWithRepo(linkedRepo.fullName);
  });
}
