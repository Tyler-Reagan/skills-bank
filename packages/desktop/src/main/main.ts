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
  acceptDriftSeverUpstream,
  hashSkillFolder,
  readSkillSource,
  writeSkillSource,
  writeSyncedHash,
  acceptDriftTakeCanonical,
  finalizeSkillsDir,
  listTopLevelSymlinks,
  forgetMissingEntry,
  repointExternalEntry,
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
  findFolderHash,
  mirrorSkillFolder,
  folderPathFromSkillPath,
  probeRepoTree,
  resolveRegistryRoot,
  scanAndStampUpstreamFromLock,
  scanExistingInstalls,
  type GitTreeEntry,
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
  BUNDLED_REPO,
  IPC,
  type AuthStatus,
  type Bounds,
  type DiscoverStatus,
  type HeaderMenuAction,
  type LinkedRepoMetadata,
  type SkillDiffFile,
  type SkillDiffRequest,
  type SkillDiffResult,
  type SyncStatus,
  type UpdateStatus,
  type UpstreamLastCommit,
  type UpstreamManualChoice,
  type UpstreamProbeResult,
  type UpstreamRepoMetadata,
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
  resumeDeviceFlow,
  startDeviceFlow,
} from "./auth.js";
import { isAuthConfigured } from "./auth-config.js";

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
  // re-summon the modal via the "Check for Updates" menu item.
  dismissedUpdateVersion: string | null;
  // Identity + freshness of the GitHub repo backing the registry when
  // registrySource === "github". Null in local-bundled mode.
  linkedRepo: LinkedRepoMetadata | null;
}

function emptyConfig(): AppConfig {
  return {
    registryRoot: null,
    registrySource: null,
    dismissedUpdateVersion: null,
    linkedRepo: null,
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
      linkedRepo: readLinkedRepo(raw.linkedRepo),
    };
  } catch {
    return emptyConfig();
  }
}

function readLinkedRepo(raw: unknown): LinkedRepoMetadata | null {
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

// Fallback origin-capture scanner: stamp upstream pointers onto any
// registry skill that has a matching entry in the `vercel-labs/skills`
// CLI's lock file but no existing `upstream` field. Run once at boot
// as a deliberate sync point — index reads stay pure. Re-runs on
// explicit Rebuild via the `rebuildIndex` IPC. Silent no-op when the
// CLI isn't installed.
scanAndStampUpstreamFromLock(registryRoot);

// ─── Upstream probe ─────────────────────────────────────────────────────────
//
// Periodic detection of upstream changes for skills with a `github`
// upstream pointer. Probes are per-repo (one GitHub Git Trees fetch
// covers every skill from that repo) and gated by a 5-minute TTL
// cache so a burst of `upstream:probe` invocations doesn't hammer
// the user's rate limit. Run at boot (after a brief warmup delay to
// let the renderer paint) and every 6h thereafter; surfaced to the
// renderer as `entry.upstreamUpdateAvailable` on `listRegistry`.
//
// Auth is the user's plan-02 OAuth token (5000/hr authenticated).
// Unauthed users still see probes attempt against the unauth ceiling
// (60/hr per IP) — usable for a small set of public repos, fragile
// beyond that. AccountModal's "Sign in for 5000/hr" affordance is
// the documented escape hatch.

interface RepoProbeCacheEntry {
  rootSha: string;
  folderHashes: Map<string, string>;
  fetchedAt: number;
}

interface SkillProbeResult {
  latestHash: string;
  probedAt: number;
}

const repoProbeCache = new Map<string, RepoProbeCacheEntry>();
const probedUpdates = new Map<string, SkillProbeResult>();

const PROBE_CACHE_TTL_MS = 5 * 60 * 1000;
const PROBE_CADENCE_MS = 6 * 60 * 60 * 1000;
const PROBE_BOOT_DELAY_MS = 5 * 1000;

let probeInFlight: Promise<UpstreamProbeResult> | null = null;

async function runUpstreamProbe(): Promise<UpstreamProbeResult> {
  if (probeInFlight) return probeInFlight;
  probeInFlight = (async () => {
    const probedAt = new Date().toISOString();
    if (!registryRoot) return { probed: 0, updates: 0, probedAt };
    let index;
    try {
      index = buildRegistryIndex(registryRoot);
    } catch (err) {
      console.warn("upstream probe: failed to read registry:", err);
      return { probed: 0, updates: 0, probedAt };
    }
    const candidates = index.entries.filter(
      (e) =>
        e.source.upstream?.kind === "github" &&
        typeof e.source.upstream.repo === "string" &&
        typeof e.source.upstream.skillPath === "string" &&
        typeof e.source.upstream.skillFolderHash === "string",
    );
    if (candidates.length === 0) {
      return { probed: 0, updates: 0, probedAt };
    }
    const byRepo = new Map<string, typeof candidates>();
    for (const e of candidates) {
      const repo = e.source.upstream!.repo!;
      const bucket = byRepo.get(repo);
      if (bucket) bucket.push(e);
      else byRepo.set(repo, [e]);
    }
    const token = getStoredToken();
    let updates = 0;
    let rateLimitInfo:
      | import("../shared/ipc.js").UpstreamProbeCompleteEvent["rateLimit"]
      | undefined;
    const failedRepos: string[] = [];
    for (const [repo, skills] of byRepo) {
      let cache = repoProbeCache.get(repo);
      const now = Date.now();
      if (!cache || now - cache.fetchedAt > PROBE_CACHE_TTL_MS) {
        const res = await probeRepoTree(repo, token);
        if (!res.ok) {
          console.warn(
            `upstream probe: ${repo} failed (${res.status}): ${res.message}`,
          );
          if (res.status === 429 && res.rateLimit) {
            // First rate-limit hit wins — they all carry the same
            // window state (limit/remaining/resetAt are repo-agnostic
            // for unauth-per-IP).
            if (!rateLimitInfo) rateLimitInfo = res.rateLimit;
          } else {
            failedRepos.push(repo);
          }
          continue;
        }
        const folderHashes = buildFolderHashMap(res.tree);
        cache = { rootSha: res.rootSha, folderHashes, fetchedAt: now };
        repoProbeCache.set(repo, cache);
      }
      for (const skill of skills) {
        const upstream = skill.source.upstream!;
        const folderPath = folderPathFromSkillPath(upstream.skillPath!);
        const currentHash = cache.folderHashes.get(folderPath);
        if (currentHash && currentHash !== upstream.skillFolderHash) {
          probedUpdates.set(skill.name, {
            latestHash: currentHash,
            probedAt: now,
          });
          updates++;
        } else {
          probedUpdates.delete(skill.name);
        }
      }
    }
    notifyProbeComplete({
      updates,
      ...(rateLimitInfo ? { rateLimit: rateLimitInfo } : {}),
      ...(failedRepos.length > 0 ? { failedRepos } : {}),
    });
    return { probed: byRepo.size, updates, probedAt };
  })();
  try {
    return await probeInFlight;
  } finally {
    probeInFlight = null;
  }
}

function buildFolderHashMap(tree: GitTreeEntry[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const entry of tree) {
    if (entry.type === "tree") m.set(entry.path, entry.sha);
  }
  return m;
}

function notifyProbeComplete(
  event: import("../shared/ipc.js").UpstreamProbeCompleteEvent = {},
): void {
  const wins = BrowserWindow.getAllWindows();
  for (const win of wins) {
    if (!win.isDestroyed()) win.webContents.send(IPC.upstreamProbe, event);
  }
}

function augmentWithProbedUpdates<T extends { name: string }>(
  entries: T[],
): T[] {
  if (probedUpdates.size === 0) return entries;
  return entries.map((e) =>
    probedUpdates.has(e.name) ? { ...e, upstreamUpdateAvailable: true } : e,
  );
}

ipcMain.handle(IPC.upstreamProbe, async () => runUpstreamProbe());

/**
 * Update backend. Fetches the skill's folder content directly from
 * its authoritative upstream (`entry.source.upstream.repo`) via
 * GitHub's REST API and mirrors it into our registry. Replaces the
 * prior `npx skills update <name>` shell-out (see PR γ of
 * docs/plans/origin-paradigm-reframe.md).
 *
 * Why direct fetch:
 *   - Origin under the new paradigm is the authoritative author's
 *     repo, not the CLI's recorded source. For bundled-vendored
 *     skills the user never CLI-installed, npx update would 404 on
 *     the lock file. Direct fetch works uniformly.
 *   - Severs a load-bearing dependency on `npx` being on PATH inside
 *     packaged Electron builds (an enduring source of bug reports).
 *   - Never writes the CLI's `~/.agents/.skill-lock.json` — that's
 *     the CLI's database, not ours.
 *
 * The fetch is a single recursive Git Trees probe + one blob fetch
 * per file. For typical skill folders (≤10 files) that's ~11 API
 * calls, well within the user's authenticated rate-limit budget.
 *
 * Mirror semantics: wipe + recopy. After the fetch we delete any
 * local file the upstream tree doesn't contain, so a removed-upstream
 * file is reflected locally. Our app-state sidecars
 * (`.skills-bank.json`, `.skills-bank-hash`) are rewritten after
 * the mirror so they survive the wipe.
 */
async function applyUpstreamUpdate(
  name: string,
): Promise<import("../shared/ipc.js").UpstreamUpdateResult> {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  const index = buildRegistryIndex(registryRoot);
  const entry = index.entries.find((e) => e.name === name);
  if (!entry) {
    return { ok: false, message: `${name} is not in the registry` };
  }
  const upstream = entry.source.upstream;
  if (upstream?.kind !== "github" || !upstream.repo || !upstream.skillPath) {
    return {
      ok: false,
      message: `${name} has no GitHub upstream — nothing to update`,
    };
  }

  const folderPath = folderPathFromSkillPath(upstream.skillPath);
  const registrySkillDir = path.join(registryRoot, "skills", name);
  const existingSource = readSkillSource(registrySkillDir);

  const mirror = await mirrorSkillFolder(
    upstream.repo,
    folderPath,
    registrySkillDir,
    getStoredToken(),
  );
  if (!mirror.ok) {
    if (mirror.status === 429 && mirror.rateLimit) {
      // Hand the renderer everything it needs to render a tailored
      // sticky toast — no inline copy-mangling. Sign-in affordance
      // surfaces only for unauth hits.
      return {
        ok: false,
        message: mirror.message,
        rateLimit: mirror.rateLimit,
      };
    }
    const recoveryHint = mirror.status === 404
      ? " Sever to keep local, or Unlink the pointer."
      : "";
    return {
      ok: false,
      message: `Update failed: ${mirror.message}.${recoveryHint}`,
      diagnostic:
        `name=${name}\n` +
        `repo=${upstream.repo}\n` +
        `skillPath=${upstream.skillPath}\n` +
        `status=${mirror.status}\n` +
        `message=${mirror.message}`,
    };
  }

  // Refresh marker with the new probed folder hash + fetchedAt.
  const now = new Date().toISOString();
  writeSkillSource(registrySkillDir, {
    ...existingSource,
    upstream: {
      ...upstream,
      skillFolderHash: mirror.folderHash,
      fetchedAt: now,
    },
  });
  const newBaseline = hashSkillFolder(registrySkillDir);
  if (newBaseline) writeSyncedHash(registrySkillDir, newBaseline);

  probedUpdates.delete(name);
  notifyProbeComplete();
  return { ok: true, message: `Updated ${name} from ${upstream.repo}.` };
}

ipcMain.handle(IPC.upstreamUpdate, async (_e, name: string) =>
  applyUpstreamUpdate(name),
);

// ─── Repo-metadata enrichment ───────────────────────────────────────────────
//
// Display-time fetch for source-repo info that doesn't fit the probe
// runner's purpose (probe = "did the tree change?", metadata =
// "what is this repo's identity?"). Cached per-repo with a 15-min
// TTL — repo identity changes orders of magnitude less often than
// content. Errors degrade to nulls so the drawer just omits missing
// chips.

interface RepoMetadataCacheEntry {
  metadata: UpstreamRepoMetadata;
  fetchedAt: number;
}

const repoMetadataCache = new Map<string, RepoMetadataCacheEntry>();
const REPO_METADATA_TTL_MS = 15 * 60 * 1000;

async function getRepoMetadata(repo: string): Promise<UpstreamRepoMetadata> {
  const cached = repoMetadataCache.get(repo);
  if (cached && Date.now() - cached.fetchedAt < REPO_METADATA_TTL_MS) {
    return cached.metadata;
  }
  const empty: UpstreamRepoMetadata = {
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
    const metadata: UpstreamRepoMetadata = {
      stars: typeof body.stargazers_count === "number"
        ? body.stargazers_count
        : null,
      description: typeof body.description === "string"
        ? body.description
        : null,
      defaultBranch: typeof body.default_branch === "string"
        ? body.default_branch
        : null,
    };
    repoMetadataCache.set(repo, { metadata, fetchedAt: Date.now() });
    return metadata;
  } catch {
    repoMetadataCache.set(repo, { metadata: empty, fetchedAt: Date.now() });
    return empty;
  }
}

ipcMain.handle(IPC.upstreamRepoMetadata, async (_e, repo: string) =>
  getRepoMetadata(repo),
);

interface LastCommitCacheEntry {
  commit: UpstreamLastCommit;
  fetchedAt: number;
}

const lastCommitCache = new Map<string, LastCommitCacheEntry>();
const LAST_COMMIT_TTL_MS = 15 * 60 * 1000;

async function getLastCommit(
  repo: string,
  skillPath: string,
): Promise<UpstreamLastCommit> {
  const key = `${repo}:${skillPath}`;
  const cached = lastCommitCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < LAST_COMMIT_TTL_MS) {
    return cached.commit;
  }
  const empty: UpstreamLastCommit = {
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
    // Query the folder (strip the `/SKILL.md` leaf) so the result
    // reflects any change in the skill's content, not just changes
    // to SKILL.md itself.
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
    const commit: UpstreamLastCommit = {
      sha: typeof top.sha === "string" ? top.sha : null,
      date: typeof top.commit?.author?.date === "string"
        ? top.commit.author.date
        : null,
      message: typeof message === "string"
        ? message.split("\n")[0]?.slice(0, 120) ?? null
        : null,
    };
    lastCommitCache.set(key, { commit, fetchedAt: Date.now() });
    return commit;
  } catch {
    lastCommitCache.set(key, { commit: empty, fetchedAt: Date.now() });
    return empty;
  }
}

ipcMain.handle(
  IPC.upstreamLastCommit,
  async (_e, repo: string, skillPath: string) => getLastCommit(repo, skillPath),
);

/**
 * Manual upstream picker handler. Stamps the user's choice into the
 * skill's `.skills-bank.json` after validating (for the github case)
 * that the supplied repo + path actually resolves on GitHub. Failures
 * report a clear error rather than writing a bogus marker.
 */
async function setManualUpstream(
  name: string,
  choice: UpstreamManualChoice,
): Promise<{ ok: boolean; message: string }> {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  const skillDir = path.join(registryRoot, "skills", name);
  if (!fs.existsSync(skillDir)) {
    return { ok: false, message: `${name} is not adopted into the registry` };
  }
  const existing = readSkillSource(skillDir);
  if (choice.kind === "none") {
    writeSkillSource(skillDir, { ...existing, upstream: { kind: "none" } });
    return { ok: true, message: `Marked ${name} as not from any upstream.` };
  }
  if (!choice.repo || !choice.skillPath) {
    return { ok: false, message: "repo and skillPath are required" };
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(choice.repo)) {
    return { ok: false, message: `"${choice.repo}" isn't a valid owner/repo` };
  }
  // Validate against GitHub: probe the folder. Anything other than
  // an ok response is treated as "couldn't verify" and rejected.
  const folder = folderPathFromSkillPath(choice.skillPath);
  const probe = await probeRepoTree(choice.repo, getStoredToken());
  if (!probe.ok) {
    return {
      ok: false,
      message: `Couldn't probe ${choice.repo}: ${probe.message}`,
    };
  }
  const folderHash = findFolderHash(probe.tree, folder);
  if (!folderHash) {
    return {
      ok: false,
      message: `${choice.repo} has no folder at ${folder}`,
    };
  }
  const now = new Date().toISOString();
  writeSkillSource(skillDir, {
    ...existing,
    upstream: {
      kind: "github",
      repo: choice.repo,
      skillPath: choice.skillPath,
      skillFolderHash: folderHash,
      installedAt: existing.upstream?.installedAt ?? now,
      fetchedAt: now,
    },
  });
  // Baseline the current on-disk content so drift detection
  // disengages until the user actually edits.
  const baseline = hashSkillFolder(skillDir);
  if (baseline) writeSyncedHash(skillDir, baseline);
  // Re-fire the probe so this newly-linked skill is compared against
  // upstream immediately, instead of waiting for the periodic 6h tick.
  // Per-repo cache absorbs the cost; if the user just probed this repo
  // via the picker validation above, the runner reuses it.
  void runUpstreamProbe();
  return { ok: true, message: `Stamped ${name} as from ${choice.repo}.` };
}

ipcMain.handle(
  IPC.upstreamSetManual,
  async (_e, name: string, choice: UpstreamManualChoice) =>
    setManualUpstream(name, choice),
);

// Resolve registry source at boot. Stored values are respected; an
// absent value signals a fresh install and is returned as null so the
// renderer can route to the two-card LoginScreen.
//
// Fresh installs no longer auto-coerce to "local" — the user picks
// **Use the public skills bank** (→ "local", linkedRepo stays null) or
// **Connect with GitHub** (→ Device Flow → RepoPickerModal with the
// bundled repo pre-listed as Recommended). Existing users — anyone
// with a config file from v0.10.0 or earlier — already have a
// persisted value, so the LoginScreen path doesn't fire for them and
// there's nothing to migrate. (See `docs/plans/github-first-onboarding.md`.)
function resolveBootRegistrySource(): RegistrySource | null {
  return readConfig().registrySource;
}

let registrySource: RegistrySource | null = resolveBootRegistrySource();

let dismissedUpdateVersion: string | null = readConfig().dismissedUpdateVersion;
let linkedRepo: LinkedRepoMetadata | null = readConfig().linkedRepo;

// Writes the current in-memory app config. Use this instead of calling
// writeConfig({...}) at sites that only mutate one field, so we don't lose
// the others when fields are added.
function persistConfig(): void {
  writeConfig({
    registryRoot,
    registrySource,
    dismissedUpdateVersion,
    linkedRepo,
  });
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
    return (() => {
      const error = fromCaught("ipc.unknown", err);
      return { ok: false, message: error.message, error };
    })();
  }
});

// Header native popup-menu retired with the Account/Settings
// decomposition — the header now renders two React-side triggers
// (AccountTrigger + SettingsTrigger). The macOS menubar still
// dispatches via the headerMenuAction IPC, handled below.

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

  // DevTools is opt-in via env var to keep `pnpm dev` quiet.
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
  // Read path — do not write index.json. The renderer hits this on
  // every refresh; writing here was producing dozens of disk writes per
  // session and silently overwriting git info that the explicit
  // Rebuild-index button had persisted. Mutation handlers and the
  // explicit rebuildIndex IPC are responsible for writing.
  return augmentWithProbedUpdates(buildRegistryIndex(registryRoot).entries);
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

function computeFolderDiff(
  leftRoot: string,
  rightRoot: string,
): SkillDiffFile[] {
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
      return (() => {
        const error = fromCaught("ipc.unknown", err);
        return { ok: false, message: error.message, error, errors: [] };
      })();
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
    return (() => {
      const error = fromCaught("ipc.unknown", err);
      return { ok: false, message: error.message, error, errors: [] };
    })();
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
    return (() => {
      const error = fromCaught("ipc.unknown", err);
      return { ok: false, message: error.message, error };
    })();
  }
});

ipcMain.handle(IPC.unhide, (_e, name: string) => {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  try {
    unhideCanonSkill(registryRoot, name);
    return { ok: true, message: `Unhid ${name}.` };
  } catch (err) {
    return (() => {
      const error = fromCaught("ipc.unknown", err);
      return { ok: false, message: error.message, error };
    })();
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
  // Dispatch based on the source axis carrying the drift signal.
  // - Skills with a per-skill `upstream` pointer route through
  //   `acceptDriftSeverUpstream` — clears the upstream and drops
  //   the baseline so future probes don't surface it as having an
  //   update available. Source axis (bundled/yours) is preserved.
  // - Skills without an upstream (the original bundled-sync drift
  //   case) route through `acceptDriftKeepLocal` as before — flips
  //   source to "yours" so future syncs leave the skill alone.
  const isUpstream = entry.source.upstream?.kind === "github";
  try {
    if (isUpstream) acceptDriftSeverUpstream(skillDir);
    else acceptDriftKeepLocal(skillDir);
    buildRegistryIndex(registryRoot, {
      includeGitInfo: true,
      writeFile: true,
    });
    return {
      ok: true,
      message: isUpstream
        ? `Severed upstream link on ${name}; future probes will leave it alone.`
        : `Kept local edits to ${name}; future syncs will leave it alone.`,
    };
  } catch (err) {
    return (() => {
      const error = fromCaught("ipc.unknown", err);
      return { ok: false, message: error.message, error };
    })();
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
    return (() => {
      const error = fromCaught("ipc.unknown", err);
      return { ok: false, message: error.message, error };
    })();
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
    return (() => {
      const error = fromCaught("ipc.unknown", err);
      return { ok: false, message: error.message, error };
    })();
  }
});

// external-target-missing heal — let the user pick the new location
// of a non-adopted skill they moved on disk. Picker → validate →
// rewrite external.json target → rebuild index so `missing` clears.
ipcMain.handle(IPC.repointExternal, async (_e, name: string) => {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  const win = BrowserWindow.getFocusedWindow();
  const picker = await dialog.showOpenDialog(win ?? undefined!, {
    title: `Pick the new location for "${name}"`,
    message: "Choose the folder that contains the skill's SKILL.md.",
    properties: ["openDirectory"],
  });
  if (picker.canceled || picker.filePaths.length === 0) {
    return { ok: false, message: "cancelled" };
  }
  try {
    const r = repointExternalEntry(registryRoot, name, picker.filePaths[0]!);
    if (r.ok) {
      buildRegistryIndex(registryRoot, {
        includeGitInfo: true,
        writeFile: true,
      });
    }
    return r;
  } catch (err) {
    const error = fromCaught("ipc.unknown", err);
    return { ok: false, message: error.message, error };
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
    return (() => {
      const error = fromCaught("ipc.unknown", err);
      return { ok: false, message: error.message, error };
    })();
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
    return (() => {
      const error = fromCaught("ipc.unknown", err);
      return { ok: false, message: error.message, error, errors: [] };
    })();
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
    // Explicit user-triggered rebuild re-runs the upstream scanner —
    // covers the "I just installed a skill via raw npx" case without
    // requiring an app restart.
    scanAndStampUpstreamFromLock(registryRoot);
    const index = buildRegistryIndex(registryRoot, {
      includeGitInfo: true,
      writeFile: true,
    });
    // Re-fire the probe so any marker edits made since last probe
    // (e.g. a hand-tweaked skillFolderHash, a freshly-stamped
    // upstream pointer, a Tier-1 lock-file pickup just done above)
    // are re-compared against upstream. Fire-and-forget; the renderer
    // re-fetches via the existing onUpstreamProbeComplete subscription.
    // Per-repo TTL cache means no extra GitHub call when the boot
    // probe just ran.
    void runUpstreamProbe();
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

ipcMain.handle(IPC.listTopLevelSymlinks, () => {
  return listTopLevelSymlinks();
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
    return (() => {
      const error = fromCaught("ipc.unknown", err);
      return { ok: false, message: error.message, error };
    })();
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
    return (() => {
      const error = fromCaught("ipc.unknown", err);
      return { ok: false, message: error.message, error };
    })();
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
    return (() => {
      const error = fromCaught("ipc.unknown", err);
      return { ok: false, message: error.message, error };
    })();
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

// Read up to 8 KB of SKILL.md text, with a "(truncated)" marker when
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
    return total > bytes ? text + "\n\n(truncated)" : text;
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
  ): {
    ok: boolean;
    message: string;
    error?: import("@skills-bank/core").AppError;
  } => {
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
          message: `tag "${trimmed.slice(0, 24)}" exceeds 64 chars`,
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
      return (() => {
        const error = fromCaught("ipc.unknown", err);
        return { ok: false, message: error.message, error };
      })();
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
    // Opportunistically authenticate the tarball fetch when a token is
    // already on disk (typically from a prior GitHub-linked session).
    // Unauthenticated GitHub API calls share a 60 req/hr ceiling per IP
    // — easy to exhaust on NAT'd networks. The token is irrelevant to
    // local-bundled semantics; it just raises the ceiling to 5000/hr.
    const token = getStoredToken();
    const fetched = await fetchCanonicalTarball({
      owner: CANONICAL_OWNER,
      repo: CANONICAL_REPO,
      ...(token ? { token } : {}),
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
    return (() => {
      const error = fromCaught("ipc.unknown", err);
      return { ok: false, message: error.message, error };
    })();
  }
  // Re-run against the right upstream. GitHub-linked users sync against
  // their linked repo; local-bundled users sync against the canonical
  // skills-bank tarball.
  if (registrySource === "github" && linkedRepo) {
    return replaceRegistryWithRepo(linkedRepo.fullName);
  }
  return runSync();
});

// ─── Auth + registry source ─────────────────────────────────────────────────
//
// `linkedRepo` is the source of truth for which GitHub repo backs the
// registry; `registrySource` survives as a derived alias on AuthStatus
// for one release to ease migration. `registrySource = null` means
// first-launch (renderer shows LoginScreen); "local" means bundled-
// default; "github" means a repo has been linked (which may be
// `BUNDLED_REPO` or a user-picked custom).

async function buildAuthStatus(): Promise<AuthStatus> {
  // Identity is independent of registry mode: a token persists across
  // mode switches (and is opportunistically used by local-bundled sync
  // for rate-limit headroom), so `user` reflects token validity, not
  // current mode.
  const user = await getCurrentUser();
  return {
    registrySource,
    isAuthConfigured: isAuthConfigured(),
    user,
    // Emit `linkedRepo` unconditionally so the renderer can render the
    // linked-repo label / last-fetched chrome for any user who's bound
    // to an explicit repo. Bundled-default users (`linkedRepo: null`)
    // get the "Bundled (Tyler-Reagan/skills-bank)" label without
    // last-fetched metadata.
    linkedRepo,
  };
}

ipcMain.handle(IPC.authStatus, () => buildAuthStatus());

ipcMain.handle(IPC.authSetRegistrySourceLocal, async () => {
  registrySource = "local";
  linkedRepo = null;
  persistConfig();
  return buildAuthStatus();
});

ipcMain.handle(IPC.authStartDeviceFlow, async () => {
  return startDeviceFlow();
});

ipcMain.handle(IPC.authPollDeviceFlow, async (_e, flowId: string) => {
  try {
    await pollDeviceFlow(flowId);
    // Deferred: registrySource flips to "github" only when a repo is
    // actually linked (see replaceRegistryWithRepo). Successful Device
    // Flow alone just establishes identity; the renderer is expected to
    // route the user through repo selection before considering them
    // github-linked.
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

ipcMain.handle(IPC.authResumeDeviceFlow, () => {
  return resumeDeviceFlow();
});

ipcMain.handle(IPC.authLogout, async () => {
  // Clear the token only — preserve `registrySource` and `linkedRepo`
  // so the user stays in the app shell with anonymized identity rather
  // than being kicked back to LoginScreen. Header Refresh continues to
  // work against the linked repo at the GitHub unauth rate ceiling
  // (60/hr), which is enough for public repos. Private-repo refresh
  // will fail until the user signs in again — surfaced as a clear
  // error, not a state corruption.
  clearStoredToken();
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

/**
 * Pre-applyCanonicalSync migration for legacy github-linked registries.
 *
 * The pre-diff-before-apply implementation of `replaceRegistryWithRepo`
 * wiped the registry and re-imported every skill stamped
 * `source: "yours"` with a `syncedFromCommit`. That's semantically wrong:
 * a skill from the linked upstream is `source: "bundled"` in this
 * codebase's vocabulary (where "bundled" means "from the registry's
 * canonical upstream," not literally "shipped in the app binary").
 *
 * Without this migration, the first re-fetch under the new code path
 * would surface every previously-imported skill as a conflict (because
 * applyCanonicalSync treats non-"bundled" local sources as user-owned
 * and conflicts on overwrite). Re-stamping legacy entries fixes that
 * silently on the next refresh.
 *
 * Heuristic: `source: "yours"` + `syncedFromCommit` present = legacy
 * github-linked import. User-authored skills don't carry
 * `syncedFromCommit`.
 *
 * Idempotent: after the first run every legacy skill is re-stamped,
 * subsequent calls are no-ops.
 */
function migrateLegacyGithubMarkers(registryRoot: string): void {
  const skillsDir = path.join(registryRoot, "skills");
  if (!fs.existsSync(skillsDir)) return;
  for (const ent of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const skillDir = path.join(skillsDir, ent.name);
    const src = readSkillSource(skillDir);
    if (src.source === "yours" && src.syncedFromCommit) {
      writeSkillSource(skillDir, { ...src, source: "bundled" });
    }
  }
}

async function replaceRegistryWithRepo(fullName: string): Promise<{
  ok: boolean;
  message: string;
  importedCount?: number;
  conflictCount?: number;
  error?: ReturnType<typeof fromCaught>;
}> {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  const token = getStoredToken();
  if (!token) return { ok: false, message: "not authenticated" };
  const slash = fullName.indexOf("/");
  if (slash <= 0) {
    return { ok: false, message: `invalid repo: ${fullName}` };
  }
  const owner = fullName.slice(0, slash);
  const repo = fullName.slice(slash + 1);

  try {
    broadcastSyncStatus({ kind: "fetching" });
    const fetched = await fetchCanonicalTarball({ owner, repo, token });
    try {
      const skillsDir = path.join(fetched.extractedRoot, "skills");
      if (!fs.existsSync(skillsDir)) {
        broadcastSyncStatus({ kind: "idle" });
        return {
          ok: false,
          message: `${fullName} has no skills/ directory at the repo root`,
        };
      }
      // Re-stamp any pre-diff-before-apply legacy markers before the
      // diff so they don't surface as fake conflicts.
      migrateLegacyGithubMarkers(registryRoot);

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
      // The link event is what defines github-linked mode (Plan 02
      // structural fix). Flipping registrySource here — atomically with
      // linkedRepo — prevents the "authed-but-unlinked" interstitial
      // that previously misled AccountModal copy.
      registrySource = "github";
      linkedRepo = {
        fullName,
        lastFetchedAt: report.syncedAt,
        syncedFromCommit: fetched.commitSha,
      };
      persistConfig();
      const message =
        report.conflicts.length > 0
          ? `synced ${report.upserted.length} from ${fullName}, ${report.conflicts.length} conflict(s) need review`
          : `synced ${report.upserted.length} skill(s) from ${fullName}`;
      return {
        ok: true,
        message,
        importedCount: report.upserted.length,
        conflictCount: report.conflicts.length,
      };
    } finally {
      fetched.cleanup();
    }
  } catch (err) {
    const error = fromCaught("ipc.unknown", err);
    broadcastSyncStatus({ kind: "error", message: error.message });
    return { ok: false, message: error.message, error };
  }
}

ipcMain.handle(IPC.reposReplaceRegistry, async (_e, fullName: string) =>
  replaceRegistryWithRepo(fullName),
);

ipcMain.handle(IPC.reposRefreshCurrent, async () => {
  // Refresh is universal: bundled-default users (`linkedRepo` null)
  // fall through to the canonical bundled repo, so the same diff-
  // before-apply path serves every refresh — no separate Sync code
  // path and no mode conditional in the renderer.
  const target = linkedRepo?.fullName ?? BUNDLED_REPO;
  return replaceRegistryWithRepo(target);
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
  // Upstream probe: fire once shortly after the renderer paints, then
  // every 6h. Per-repo 5-min TTL cache absorbs back-pressure from
  // user-explicit `upstream:probe` invocations between scheduled runs.
  setTimeout(() => {
    void runUpstreamProbe();
  }, PROBE_BOOT_DELAY_MS);
  setInterval(() => {
    void runUpstreamProbe();
  }, PROBE_CADENCE_MS);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
