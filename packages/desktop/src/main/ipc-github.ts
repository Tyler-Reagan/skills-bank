import { ipcMain } from "electron";
import {
  applySkillUpdate as coreApplySkillUpdate,
  fetchOriginTree,
  findFolderHash,
  folderPathFromSkillPath,
  fromCaught,
  hashSkillFolder,
  readLiveManifest,
  setRuntimeEntry,
  walkSkills,
  writeLiveManifest,
} from "@skills-bank/core";
import { getStoredToken } from "./auth.js";
import {
  getRegistryRoot,
  NO_ROOT_MSG,
  notifyProbeComplete,
  probedUpdates,
  runUpstreamProbe,
} from "./main-state.js";
import {
  IPC,
  type OriginLastCommit,
  type OriginManualChoice,
  type OriginRepoMetadata,
} from "../shared/ipc.js";

// ─── Repo-metadata enrichment ────────────────────────────────────────────────

interface RepoMetadataCacheEntry {
  metadata: OriginRepoMetadata;
  fetchedAt: number;
}

const repoMetadataCache = new Map<string, RepoMetadataCacheEntry>();
const REPO_METADATA_TTL_MS = 15 * 60 * 1000;

async function getRepoMetadata(repo: string): Promise<OriginRepoMetadata> {
  const cached = repoMetadataCache.get(repo);
  if (cached && Date.now() - cached.fetchedAt < REPO_METADATA_TTL_MS) {
    return cached.metadata;
  }
  const empty: OriginRepoMetadata = {
    stars: null,
    description: null,
    defaultBranch: null,
  };
  try {
    const token = getStoredToken();
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "skills-bank",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers,
    });
    if (!res.ok) {
      repoMetadataCache.set(repo, { metadata: empty, fetchedAt: Date.now() });
      return empty;
    }
    const body = (await res.json()) as {
      stargazers_count?: number;
      description?: string | null;
      default_branch?: string;
    };
    const metadata: OriginRepoMetadata = {
      stars:
        typeof body.stargazers_count === "number"
          ? body.stargazers_count
          : null,
      description:
        typeof body.description === "string" ? body.description : null,
      defaultBranch:
        typeof body.default_branch === "string" ? body.default_branch : null,
    };
    repoMetadataCache.set(repo, { metadata, fetchedAt: Date.now() });
    return metadata;
  } catch {
    repoMetadataCache.set(repo, { metadata: empty, fetchedAt: Date.now() });
    return empty;
  }
}

// ─── Last-commit enrichment ───────────────────────────────────────────────────

interface LastCommitCacheEntry {
  commit: OriginLastCommit;
  fetchedAt: number;
}

const lastCommitCache = new Map<string, LastCommitCacheEntry>();
const LAST_COMMIT_TTL_MS = 15 * 60 * 1000;

async function getLastCommit(
  repo: string,
  skillPath: string,
): Promise<OriginLastCommit> {
  const key = `${repo}:${skillPath}`;
  const cached = lastCommitCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < LAST_COMMIT_TTL_MS) {
    return cached.commit;
  }
  const empty: OriginLastCommit = {
    sha: null,
    date: null,
    message: null,
  };
  try {
    const token = getStoredToken();
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "skills-bank",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const folder = skillPath.replace(/\/SKILL\.md$/, "");
    const url = `https://api.github.com/repos/${repo}/commits?path=${encodeURIComponent(
      folder,
    )}&per_page=1`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      lastCommitCache.set(key, { commit: empty, fetchedAt: Date.now() });
      return empty;
    }
    const body = (await res.json()) as Array<{
      sha?: string;
      commit?: {
        author?: { date?: string };
        message?: string;
      };
    }>;
    if (!Array.isArray(body) || body.length === 0) {
      lastCommitCache.set(key, { commit: empty, fetchedAt: Date.now() });
      return empty;
    }
    const top = body[0]!;
    const message = top.commit?.message;
    const commit: OriginLastCommit = {
      sha: typeof top.sha === "string" ? top.sha : null,
      date:
        typeof top.commit?.author?.date === "string"
          ? top.commit.author.date
          : null,
      message:
        typeof message === "string"
          ? (message.split("\n")[0]?.slice(0, 120) ?? null)
          : null,
    };
    lastCommitCache.set(key, { commit, fetchedAt: Date.now() });
    return commit;
  } catch {
    lastCommitCache.set(key, { commit: empty, fetchedAt: Date.now() });
    return empty;
  }
}

// ─── Skill update ─────────────────────────────────────────────────────────────

async function applySkillUpdate(
  name: string,
): Promise<import("../shared/ipc.js").SkillUpdateResult> {
  const registryRoot = getRegistryRoot();
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  const result = await coreApplySkillUpdate({
    registryRoot,
    name,
    token: getStoredToken(),
  });
  if (result.ok) {
    probedUpdates.delete(name);
    notifyProbeComplete();
  }
  return result;
}

// ─── Manual origin picker ─────────────────────────────────────────────────────

async function setManualOrigin(
  name: string,
  choice: OriginManualChoice,
): Promise<{ ok: boolean; message: string }> {
  const registryRoot = getRegistryRoot();
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  const ref = walkSkills(registryRoot).find((r) => r.name === name);
  if (!ref) {
    return { ok: false, message: `${name} is not in the registry` };
  }
  const skillDir = ref.dir;

  function upsertOrigin(origin: {
    url: string | null;
    skillPath?: string;
    hash?: string;
  }): void {
    const manifest = readLiveManifest(registryRoot!);
    const idx = manifest.skills.findIndex((s) => s.name === name);
    if (idx >= 0) {
      manifest.skills[idx] = { ...manifest.skills[idx]!, origin };
    } else {
      manifest.skills.push({ name, origin, category: null, tags: [] });
    }
    writeLiveManifest(registryRoot!, manifest);
  }

  if (choice.url === null) {
    upsertOrigin({ url: null });
    return { ok: true, message: `Marked ${name} as local-only (no origin).` };
  }
  const { repo, skillPath } = choice;
  if (!repo || !skillPath) {
    return { ok: false, message: "repo and skillPath are required" };
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return { ok: false, message: `"${repo}" isn't a valid owner/repo` };
  }
  const folder = folderPathFromSkillPath(skillPath);
  const probe = await fetchOriginTree(repo, getStoredToken());
  if (!probe.ok) {
    return {
      ok: false,
      message: `Couldn't probe ${repo}: ${probe.message}`,
    };
  }
  const folderHash = findFolderHash(probe.tree, folder);
  if (!folderHash) {
    return {
      ok: false,
      message: `${repo} has no folder at ${folder}`,
    };
  }
  upsertOrigin({
    url: `https://github.com/${repo}`,
    skillPath,
    hash: folderHash,
  });
  const now = new Date().toISOString();
  setRuntimeEntry(registryRoot, name, { fetchedAt: now });
  const baseline = hashSkillFolder(skillDir);
  if (baseline) setRuntimeEntry(registryRoot, name, { syncedHash: baseline });
  void runUpstreamProbe();
  return { ok: true, message: `Stamped ${name} as from ${repo}.` };
}

export function registerGithubHandlers(): void {
  ipcMain.handle(IPC.originProbe, async () => runUpstreamProbe());

  ipcMain.handle(IPC.skillUpdate, async (_e, name: string) =>
    applySkillUpdate(name),
  );

  ipcMain.handle(IPC.originRepoMetadata, async (_e, repo: string) =>
    getRepoMetadata(repo),
  );

  ipcMain.handle(
    IPC.originLastCommit,
    async (_e, repo: string, skillPath: string) =>
      getLastCommit(repo, skillPath),
  );

  ipcMain.handle(
    IPC.originSetManual,
    async (_e, name: string, choice: OriginManualChoice) =>
      setManualOrigin(name, choice),
  );
}
