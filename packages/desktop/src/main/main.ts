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
  applyRegistration,
  buildRegistryIndex,
  applyOriginUpdate as coreApplyOriginUpdate,
  classifySkillByName,
  createOriginProbeRunner,
  clearPendingConflicts,
  computeFolderDiff,
  deleteUnregisteredSkill,
  exportSkill,
  exportRegistryManifest,
  importRegistryManifest,
  applyManifestResolutions,
  mergeManifests,
  readMergeBase,
  writeMergeBase,
  serializeManifest,
  readPendingManifestConflicts,
  writePendingManifestConflicts,
  clearPendingManifestConflicts,
  resolveRenameTarget,
  type ManifestDecisions,
  type RateLimitInfo,
  MANIFEST_SCHEMA_VERSION,
  parseGithubSkillUrl,
  writeRegistrySnapshot,
  type ManifestSkill,
  type RegistryManifest,
  findSkillFolder,
  readSkillMeta,
  pushSkillFolder,
  hashSkillFolder,
  readSkillSource,
  writeSkillSource,
  writeRuntimeState,
  writeSyncedHash,
  finalizeSkillsDir,
  listTopLevelSymlinks,
  forgetMissingEntry,
  repointExternalEntry,
  fromCaught,
  getExportInfo,
  hideCanonSkill,
  linkSkillToAgents,
  installSkillFiles,
  getAgent,
  getDefaultInstallAgents,
  invalidateCanonCache,
  makeAppError,
  mergeImportRegistry,
  listInstalled,
  readLastSyncReport,
  readPendingConflicts,
  syncTarballToRegistry,
  findFolderHash,
  folderPathFromSkillPath,
  fetchOriginTree,
  readRepoFile,
  writeRepoFile,
  writeRepoFileAsBranch,
  diffManifests,
  GH_API,
  ghFetch as coreGhFetch,
  resolveRegistryRoot,
  scanAndStampUpstreamFromLock,
  scanExistingInstalls,
  walkSkills,
  unlinkSkillFromAgents,
  removeBrokenLinks,
  repairBrokenLinks,
  scanLocalDiagnostics,
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
  type RegistrySource,
  type SkillDiffRequest,
  type SkillDiffResult,
  type SyncStatus,
  type UpdateStatus,
  type OriginLastCommit,
  type OriginManualChoice,
  type OriginProbeCompleteEvent,
  type OriginProbeResult,
  type OriginRepoMetadata,
  type PreviewManifestPushResult,
  type PushManifestToRepoResult,
  type ReadManifestFromRepoResult,
  type ResolveManifestConflictsResult,
  type RunManifestMergeResult,
  type UserRepo,
} from "../shared/ipc.js";
import {
  cancelDeviceFlow,
  clearStoredToken,
  DeviceFlowError,
  getCurrentUser,
  getStorageBackend,
  getStoredToken,
  pollDeviceFlow,
  resumeDeviceFlow,
  startDeviceFlow,
} from "./auth.js";
import { isAuthConfigured } from "./auth-config.js";

// ─── Dev-mode isolation ─────────────────────────────────────────────────────
// When run unpackaged (pnpm dev / pnpm start), redirect every persistent
// side effect into ~/.skills-bank-dev/ so this clone cannot contaminate the
// packaged install's userData or skill-sinks (~/.claude/skills, ~/.cursor/
// skills, etc.). Single root => one `rm -rf` to fully reset dev state.
if (!app.isPackaged) {
  const devHome = path.join(app.getPath("home"), ".skills-bank-dev");
  fs.mkdirSync(devHome, { recursive: true });
  app.setName("Skills Bank (Dev)");
  app.setPath("userData", path.join(devHome, "userData"));
  process.env.SKILLS_BANK_HOME_OVERRIDE = devHome;
}

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
  // ADR-0004. Tracks which weak-storage backends the user has
  // acknowledged the warning for. Keyed by Electron's
  // `safeStorage.getSelectedStorageBackend()` return value
  // (`basic_text` is the obfuscation-only fallback). If the backend
  // changes later (e.g. user installed a keyring), the new value
  // isn't in this set and the notice fires again — fresh consent
  // for fresh state.
  weakStorageNoticeDismissedFor: string[];
}

function emptyConfig(): AppConfig {
  return {
    registryRoot: null,
    registrySource: null,
    dismissedUpdateVersion: null,
    linkedRepo: null,
    weakStorageNoticeDismissedFor: [],
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

/**
 * v0.11.8 M5 — soft validation. Detects paths the user almost
 * certainly didn't mean to pick (the literal filesystem root, their
 * home dir, common system paths). Returns a warning string the
 * caller surfaces in the renderer; the operation still completes,
 * since some users do legitimately want unusual paths (e.g. headless
 * setups, custom partitions). "Warn, don't block."
 *
 * The check is path-shape only — no scanning of the directory's
 * contents. Cheap, fast, runs on every picker submission.
 */
function suspiciousPathWarning(candidate: string): string | null {
  const normalized = path.resolve(candidate);
  const home = app.getPath("home");
  // Filesystem root (`/` on POSIX, `C:\` on Windows).
  if (normalized === path.parse(normalized).root) {
    return `${normalized} is the filesystem root — did you mean a subfolder?`;
  }
  // User's home directory itself (not a subdir).
  if (normalized === path.resolve(home)) {
    return `${normalized} is your home directory — registry roots typically live in a subfolder (e.g. ~/Projects/skills-bank).`;
  }
  // Common POSIX system roots that almost certainly aren't a
  // registry. Conservative list — only paths a misclick would land
  // on, not every system dir.
  const systemRoots = ["/usr", "/etc", "/var", "/bin", "/sbin", "/opt"];
  for (const sys of systemRoots) {
    if (normalized === sys) {
      return `${normalized} is a system directory — registry roots should be a project folder.`;
    }
  }
  return null;
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
          source: "curated",
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

/**
 * Tier 1 v2 manifest-import cancel infrastructure: main holds an
 * at-most-one in-flight AbortController for the manifest-import
 * IPC. Renderer calls `IPC.importManifestCancel` to abort. The
 * import handler clears this back to null in its `finally`, so
 * an early `cancel` while no import is running is a no-op.
 */
let inFlightImportAbort: AbortController | null = null;

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

const PROBE_CADENCE_MS = 6 * 60 * 60 * 1000;
const PROBE_BOOT_DELAY_MS = 5 * 1000;

// v0.11.9 M2: probe scheduler state + cadence loop live in core.
// Desktop wires the BrowserWindow broadcast as the completion sink
// and exposes the runner's surface to the rest of main.ts via the
// shims below (kept for call-site readability — they just delegate).
const probeRunner = createOriginProbeRunner({
  registryRoot: () => registryRoot,
  token: () => getStoredToken(),
  onComplete: (event) => {
    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) {
      if (!win.isDestroyed()) win.webContents.send(IPC.originProbe, event);
    }
  },
});

async function runUpstreamProbe(): Promise<OriginProbeResult> {
  return probeRunner.run();
}

function notifyProbeComplete(event: OriginProbeCompleteEvent = {}): void {
  // Re-emit through the runner's onComplete so empty refresh nudges
  // and probe results follow the same channel.
  if (Object.keys(event).length === 0) {
    probeRunner.notifyRefresh();
    return;
  }
  const wins = BrowserWindow.getAllWindows();
  for (const win of wins) {
    if (!win.isDestroyed()) win.webContents.send(IPC.originProbe, event);
  }
}

function augmentWithProbedUpdates<T extends { name: string }>(
  entries: T[],
): T[] {
  return probeRunner.augmentEntries(entries);
}

// Compatibility shim: the old `probedUpdates.delete(name)` call sites
// keep using a Map-like object so the diff stays small. Implemented
// against the runner's clearUpdate method.
const probedUpdates = {
  delete: (name: string) => probeRunner.clearUpdate(name),
};

ipcMain.handle(IPC.originProbe, async () => runUpstreamProbe());

/**
 * Update backend. Fetches the skill's folder content directly from
 * its authoritative upstream (`entry.source.origin.repo`) via
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
): Promise<import("../shared/ipc.js").OriginUpdateResult> {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  // Core owns the disk-level mirror + marker rewrite. Desktop layers
  // on the probe-cache cleanup + notification (UI concerns).
  const result = await coreApplyOriginUpdate({
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

ipcMain.handle(IPC.originUpdate, async (_e, name: string) =>
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

ipcMain.handle(IPC.originRepoMetadata, async (_e, repo: string) =>
  getRepoMetadata(repo),
);

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

ipcMain.handle(
  IPC.originLastCommit,
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
  choice: OriginManualChoice,
): Promise<{ ok: boolean; message: string }> {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  // Look up the bucket via walkSkills; setManualUpstream is invoked
  // for adopted skills only, so we expect a match.
  const ref = walkSkills(registryRoot).find((r) => r.name === name);
  if (!ref) {
    return { ok: false, message: `${name} is not adopted into the registry` };
  }
  const skillDir = ref.dir;
  const existing = readSkillSource(skillDir);
  if (choice.kind === "none") {
    writeSkillSource(skillDir, { ...existing, origin: { kind: "none" } });
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
  const probe = await fetchOriginTree(choice.repo, getStoredToken());
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
    origin: {
      kind: "github",
      repo: choice.repo,
      skillPath: choice.skillPath,
      skillFolderHash: folderHash,
      installedAt: existing.origin?.installedAt ?? now,
    },
  });
  writeRuntimeState(skillDir, { fetchedAt: now });
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
  IPC.originSetManual,
  async (_e, name: string, choice: OriginManualChoice) =>
    setManualUpstream(name, choice),
);

// Resolve registry source at boot. Stored values are respected; an
// absent value signals a fresh install and is returned as null so the
// renderer can route to the two-card LoginScreen.
//
// Fresh installs no longer auto-coerce to "local" — the user picks
// v1.3 persona collapse: fresh installs land directly on the
// bundled-default ("local", linkedRepo: null) instead of routing to
// the first-launch persona picker. GitHub linking moves to a
// single entry point in Settings → Account. The legacy null state
// (first-launch picker) is no longer reachable from new installs;
// existing v1.2- configs that persist `null` get normalized to
// "local" on the next boot.
function resolveBootRegistrySource(): RegistrySource {
  return readConfig().registrySource ?? "local";
}

let registrySource: RegistrySource = resolveBootRegistrySource();

let dismissedUpdateVersion: string | null = readConfig().dismissedUpdateVersion;
let linkedRepo: LinkedRepoMetadata | null = readConfig().linkedRepo;

// Writes the current in-memory app config. Use this instead of calling
// writeConfig({...}) at sites that only mutate one field, so we don't lose
// the others when fields are added.
function persistConfig(): void {
  // Read first to preserve the weakStorageNoticeDismissedFor list,
  // which only the dedicated IPC handler mutates — `persistConfig`
  // shouldn't clobber the user's prior dismissal when other fields
  // change.
  const existing = readConfig();
  writeConfig({
    registryRoot,
    registrySource,
    dismissedUpdateVersion,
    linkedRepo,
    weakStorageNoticeDismissedFor: existing.weakStorageNoticeDismissedFor,
  });
}

/**
 * Best-effort registry snapshot writer — Phase 1 of the
 * curation-layer-reset plan, section 6. Invoked from every IPC
 * handler that mutates registry membership or per-skill metadata.
 *
 * Failures are intentionally swallowed: a snapshot rotation glitch
 * must never break the user's actual mutation. The on-disk artifact
 * is purely a backup affordance.
 */
function snapshotAfterMutation(): void {
  if (!registryRoot) return;
  try {
    const manifest = exportRegistryManifest(registryRoot, {
      sourceBankVersion: app.getVersion(),
      ...manifestExportContext(),
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
 * or per-skill metadata. The snapshot itself is best-effort
 * (see `snapshotAfterMutation`'s JSDoc), so wrapping is non-fatal
 * even on read-only no-op invocations.
 */
function mutatingHandle<P extends unknown[], R>(
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
      // Strip embedded quotes/control chars before interpolation —
      // `registryRoot` is user-set but we still don't want a literal
      // quote in the path to break out of the cmd.exe string.
      const safeCwd = cwd ? cwd.replace(/["\r\n]/g, "") : "";
      const command = safeCwd
        ? `start "" wt.exe -d "${safeCwd}" || start "" cmd.exe /K cd /D "${safeCwd}"`
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
        // ADR-0005: DevTools menu role only in dev. End-user packaged
        // builds keep the social-engineering "paste-this-in-console"
        // vector off-surface. Maintainers debugging a packaged build
        // use SKILLS_BANK_DEVTOOLS=1 to auto-open at launch.
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
    title: app.getName(),
    webPreferences: {
      preload: path.join(__dirname, "..", "main", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Sandbox the renderer. The preload is bundled to CJS by esbuild
      // (see build:preload) — sandboxed preloads don't support ES
      // modules, so the .mjs that tsc emits from preload.mts is unused
      // and we load the bundled .cjs instead. Defense-in-depth against
      // renderer RCE: a compromised renderer can't reach Node primitives
      // even via the preload's import graph.
      sandbox: true,
    },
  });
  if (!app.isPackaged) {
    // The renderer's <title>Skills Bank</title> would otherwise overwrite
    // the dev-mode label as soon as the page loads. Suppress in dev only;
    // packaged mode lets the renderer drive the title normally.
    win.on("page-title-updated", (event) => event.preventDefault());
  }
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

ipcMain.handle(IPC.getConfig, () => {
  // ADR-0004: surface a weak-storage notice when `safeStorage`
  // resolved to `basic_text` (Linux without a keyring) and the user
  // hasn't already dismissed the warning for this backend.
  const backend = getStorageBackend();
  const cfg = readConfig();
  const showWeakStorageNotice =
    backend === "basic_text" &&
    !cfg.weakStorageNoticeDismissedFor.includes(backend);
  return {
    registryRoot,
    configValid: registryRoot !== null,
    isPackaged: app.isPackaged,
    registrySource,
    dismissedUpdateVersion,
    storageBackend: backend,
    showWeakStorageNotice,
  };
});

ipcMain.handle(IPC.dismissWeakStorageNotice, () => {
  const backend = getStorageBackend();
  if (!backend) return;
  const cfg = readConfig();
  if (!cfg.weakStorageNoticeDismissedFor.includes(backend)) {
    cfg.weakStorageNoticeDismissedFor = [
      ...cfg.weakStorageNoticeDismissedFor,
      backend,
    ];
    writeConfig(cfg);
  }
});

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
  const warning = suspiciousPathWarning(candidate);
  return {
    ok: true,
    message: `registry set to ${candidate}`,
    registryRoot,
    ...(warning ? { warning } : {}),
  };
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
  const chosen = result.filePaths[0]!;
  const warning = suspiciousPathWarning(chosen);
  return {
    ok: true,
    path: chosen,
    message: "ok",
    ...(warning ? { warning } : {}),
  };
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

mutatingHandle(
  IPC.install,
  async (_e, name: string, force?: boolean, agents?: AgentId[]) => {
    if (!registryRoot) return { ok: false, message: NO_ROOT_MSG, errors: [] };
    try {
      const found = findSkillFolder(registryRoot, name);
      if (!found) throw new Error(`Skill "${name}" not found in registry.`);
      const skillPath = found.dir;
      const source = readSkillSource(skillPath);

      // Ensure files are on disk (idempotent — skips if already present).
      if (
        source.origin?.kind === "github" &&
        source.origin.repo &&
        source.origin.skillPath
      ) {
        await installSkillFiles(
          source.origin.repo,
          folderPathFromSkillPath(source.origin.skillPath),
          skillPath,
          getStoredToken(),
        );
      }

      const targetAgents =
        agents && agents.length > 0
          ? agents.map(getAgent)
          : getDefaultInstallAgents();
      const r = linkSkillToAgents(skillPath, targetAgents, {
        force: force ?? false,
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
// M5: hide a canon skill from the default views. Canon skills can't
// be unregistered or deleted from the UI (those would be irrecoverable
// — the upstream owns them), so Hide is the only canon-side action a
// non-power user can take.
mutatingHandle(IPC.hide, (_e, name: string) => {
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

mutatingHandle(IPC.unhide, (_e, name: string) => {
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

// M6: missing-entry heal — drop the registry record. For non-
// adopted (external), removes the external.json row. For adopted,
// the entry naturally drops on the next index build (folder was
// gone); we trigger that rebuild here.
mutatingHandle(IPC.forgetMissing, (_e, name: string) => {
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
mutatingHandle(IPC.repointExternal, async (_e, name: string) => {
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
mutatingHandle(IPC.deleteUnregistered, (_e, name: string) => {
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
mutatingHandle(
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
mutatingHandle(IPC.uninstall, (_e, name: string, agents?: AgentId[]) => {
  try {
    const r = unlinkSkillFromAgents(
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

mutatingHandle(
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
    // When the same skill name appears in multiple agent dirs, the
    // renderer (post-fix) sends a per-entry action with `agent` (and
    // `customDir` for non-agent custom scans) attached so we can route
    // to the exact entry the user picked. For legacy callers that send
    // name only, fall back to a kindRank-based dedup that prefers the
    // most actionable entry: real-directory > ours > foreign-symlink >
    // broken-symlink. The legacy fallback masked entries — that's the
    // bug the wire-format addition fixes — so the renderer should
    // always send `agent` now; we keep the fallback for back-compat
    // with any external IPC caller and for the setAgents action which
    // is intentionally name-only (it fans out across agents).
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
    const findEntry = (
      name: string,
      target: { agent?: string; customDir?: string },
    ): (typeof report.entries)[number] | undefined => {
      if (target.agent === undefined) return byName.get(name);
      return report.entries.find(
        (e) =>
          e.name === name &&
          e.agent === target.agent &&
          (e.customDir ?? undefined) === (target.customDir ?? undefined),
      );
    };
    return items.map(({ name, action }) => {
      const target =
        action.type === "setAgents"
          ? {}
          : { agent: action.agent, customDir: action.customDir };
      const entry = findEntry(name, target);
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

mutatingHandle(IPC.rebuildIndex, () => {
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

async function writeManifestToDisk(): Promise<{
  ok: boolean;
  message: string;
  skillCount?: number;
  destPath?: string;
  error?: ReturnType<typeof fromCaught>;
}> {
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

async function runManifestImportCore(manifest: RegistryManifest): Promise<
  | { ok: false; message: string; error?: ReturnType<typeof fromCaught> }
  | {
      ok: true;
      message: string;
      result: Awaited<ReturnType<typeof importRegistryManifest>>;
    }
> {
  if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
  // Accept v2 and v3 (coerced by importRegistryManifest). v1 is no
  // longer readable per MANIFEST_OLDEST_READABLE_VERSION. Newer
  // schemaVersions are refused so a future-incompatible manifest
  // doesn't silently mismap fields.
  const sv = (manifest as unknown as { schemaVersion: unknown }).schemaVersion;
  if (sv !== 2 && sv !== 3 && sv !== 4) {
    return {
      ok: false,
      message: `Unsupported manifest schemaVersion ${String(sv)} — this build understands v2, v3, and v4.`,
    };
  }
  const controller = new AbortController();
  inFlightImportAbort = controller;
  let importResult;
  try {
    importResult = await importRegistryManifest(registryRoot, manifest, {
      token: getStoredToken(),
      signal: controller.signal,
      onProgress: (event) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed())
            win.webContents.send(IPC.manifestImportProgress, event);
        }
      },
    });
  } finally {
    inFlightImportAbort = null;
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

/**
 * Reconcile the local registry to `manifest`: import adds + restore aux
 * state, then delete every local skill the manifest no longer lists.
 * The removal set is `localNames − manifestNames`, which captures BOTH
 * conflict-confirmed deletions AND the auto-resolved deletions the merge
 * already dropped (importRegistryManifest is otherwise additive).
 * Returns the names actually removed. Caller owns base-snapshot advance.
 */
async function reconcileLocalToManifest(
  root: string,
  manifest: RegistryManifest,
): Promise<string[]> {
  const finalNames = new Set(manifest.skills.map((s) => s.name));
  const removeNames = walkSkills(root)
    .map((r) => r.name)
    .filter((n) => !finalNames.has(n));
  const result = await importRegistryManifest(root, manifest, {
    token: getStoredToken(),
    ...(removeNames.length > 0 ? { removeNames } : {}),
    onProgress: (event) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed())
          win.webContents.send(IPC.manifestImportProgress, event);
      }
    },
  });
  applyRestoredLabels(result.restoredLabels);
  buildRegistryIndex(root, { includeGitInfo: true, writeFile: true });
  invalidateCanonCache(root);
  return (result.removed ?? []).filter((r) => r.ok).map((r) => r.name);
}

/**
 * Fetch the linked repo's `registry-manifest.json`. A 404 resolves to
 * an empty manifest (the repo has no manifest yet — everything is an
 * add); other failures propagate so the caller can surface them.
 */
async function fetchRemoteManifest(
  repo: string,
  branch: string,
  token: string,
): Promise<
  | { ok: true; manifest: RegistryManifest }
  | {
      ok: false;
      reason: "rate-limit" | "read-failed";
      message: string;
      rateLimit?: RateLimitInfo;
    }
> {
  const res = await readRepoFile({
    repo,
    path: "registry-manifest.json",
    ref: branch,
    token,
  });
  const empty: RegistryManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    exportedAt: "",
    sourceBankVersion: "",
    skills: [],
  };
  if (!res.ok) {
    if (res.status === 404) return { ok: true, manifest: empty };
    return res.rateLimit
      ? {
          ok: false,
          reason: "rate-limit",
          message: res.message,
          rateLimit: res.rateLimit,
        }
      : { ok: false, reason: "read-failed", message: res.message };
  }
  try {
    return { ok: true, manifest: JSON.parse(res.content) as RegistryManifest };
  } catch {
    // A corrupt/unparseable remote manifest is treated as empty rather
    // than aborting — the merge then reads every local skill as an add,
    // which the user reviews before any push.
    return { ok: true, manifest: empty };
  }
}

ipcMain.handle(IPC.exportManifest, writeManifestToDisk);
ipcMain.handle(IPC.importManifest, readManifestFromDisk);

ipcMain.handle(IPC.importManifestCancel, () => {
  inFlightImportAbort?.abort();
  return { ok: true };
});

ipcMain.handle(
  IPC.previewManifestPush,
  async (): Promise<PreviewManifestPushResult> => {
    if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
    if (!linkedRepo) return { ok: false, message: "no linked repo" };
    const token = getStoredToken();
    if (!token) return { ok: false, message: "not authenticated" };
    const branch = linkedRepo.defaultBranch ?? "main";
    const sourceBankVersion = app.getVersion();
    const localManifest = exportRegistryManifest(registryRoot, {
      sourceBankVersion,
      ...manifestExportContext(),
    });
    const remoteRes = await readRepoFile({
      repo: linkedRepo.fullName,
      path: "registry-manifest.json",
      ref: branch,
      token,
    });
    let remoteManifest: import("@skills-bank/core").RegistryManifest;
    if (!remoteRes.ok) {
      if (remoteRes.status === 404) {
        remoteManifest = {
          schemaVersion: MANIFEST_SCHEMA_VERSION,
          exportedAt: "",
          sourceBankVersion: "",
          skills: [],
        };
      } else {
        return {
          ok: false,
          message: remoteRes.message,
          rateLimit: remoteRes.rateLimit,
        };
      }
    } else {
      try {
        remoteManifest = JSON.parse(remoteRes.content) as typeof remoteManifest;
      } catch {
        remoteManifest = {
          schemaVersion: MANIFEST_SCHEMA_VERSION,
          exportedAt: "",
          sourceBankVersion: "",
          skills: [],
        };
      }
    }
    const diff = diffManifests(localManifest, remoteManifest);
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
    if (!registryRoot)
      return { ok: false, reason: "write-failed", message: NO_ROOT_MSG };
    if (!linkedRepo)
      return { ok: false, reason: "write-failed", message: "no linked repo" };
    const token = getStoredToken();
    if (!token)
      return {
        ok: false,
        reason: "write-failed",
        message: "not authenticated",
      };
    const branch = linkedRepo.defaultBranch ?? "main";
    const sourceBankVersion = app.getVersion();
    const manifest = exportRegistryManifest(registryRoot, {
      sourceBankVersion,
      ...manifestExportContext(),
    });
    // Canonical serialization — sorted, stable keys, no `exportedAt`
    // churn (the v4 committed form). This is also the byte-for-byte form
    // the merge base is stored in, so the divergence check below compares
    // apples to apples.
    const content = serializeManifest(manifest);
    const commitMessage = "chore: update registry manifest";

    if (!opts.asPR) {
      // Non-fast-forward guard — the fix for the originating clobber bug.
      // A direct commit overwrites the branch wholesale, so refuse when
      // the remote no longer matches our merge base: that means the repo
      // changed since our last sync (or we've never synced a repo that
      // already has a manifest), and pushing would silently delete the
      // other machine's skills. The user must pull-merge first.
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
        serializeManifest(remote.manifest) !== serializeManifest(baseManifest)
      ) {
        return {
          ok: false,
          reason: "diverged",
          message:
            "The linked repo changed since your last sync — pull & merge before pushing.",
        };
      }
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
      // Remote now equals what we pushed — advance the base so the next
      // push fast-forwards and the next pull sees no spurious diff.
      writeMergeBase(registryRoot, manifest);
      return {
        ok: true,
        commitSha: res.commitSha,
        htmlUrl: res.htmlUrl,
        skillCount: manifest.skills.length,
      };
    }

    // PR path — check for an open PR on the stable manifest branch first.
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
      return { ok: false, reason: "write-failed", message: writeRes.message };
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

    // No open PR — create one.
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
    if (!registryRoot)
      return { ok: false, reason: "read-failed", message: NO_ROOT_MSG };
    if (!linkedRepo)
      return { ok: false, reason: "read-failed", message: "no linked repo" };
    const token = getStoredToken();
    if (!token)
      return { ok: false, reason: "read-failed", message: "not authenticated" };
    const branch = linkedRepo.defaultBranch ?? "main";
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
  if (!registryRoot) return null;
  return readPendingManifestConflicts(registryRoot);
});

ipcMain.handle(IPC.clearPendingManifestConflicts, () => {
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

    // keep-both forks: rename the local skill out of the way BEFORE the
    // import re-materializes theirs at the original name. resolveRename-
    // Target guards against a pre-existing `<name>-local`; when it picks
    // a different target than the pure layer assumed, patch the manifest
    // entry so the registered fork matches what landed on disk.
    const renamed: { from: string; to: string }[] = [];
    for (const { from, to } of resolved.renamed) {
      const ref = findSkillFolder(root, from);
      if (!ref) continue; // nothing local to fork
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
      // Local now fully incorporates `theirs` (plus our resolutions), so
      // it becomes the new merge base — the next pull compares against it.
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
      // Clean merge — local now reflects everything in `theirs`, so it
      // becomes the new base.
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

// Tier-3 retry: re-mirror a single skill that errored during a prior
// import. Wraps the entry in a one-skill manifest so it reuses the
// full mirror + stamp + aux-state pipeline. No progress events fire —
// retry is single-shot; renderer awaits the IPC's single outcome.
ipcMain.handle(
  IPC.manifestImportRetrySkill,
  async (_e, skill: ManifestSkill) => {
    if (!registryRoot) return { ok: false, message: NO_ROOT_MSG };
    if (!skill || typeof skill !== "object" || typeof skill.name !== "string") {
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

// Phase 4 (v1.5): one-shot install from a pasted GitHub URL.
// Parses the URL, composes the core install primitive, rebuilds
// Discover tab install: mirror from GitHub directly into the shared
// ~/.agents/skills/ directory. No bank entry created — the skill lands
// as an "unregistered" real directory, identical to a terminal install.
mutatingHandle(IPC.installSkillFromGithub, async (_e, url: string) => {
  const parsed = parseGithubSkillUrl(url);
  if ("kind" in parsed) {
    return {
      ok: false,
      reason: "url-parse-error",
      message: parsed.message,
    } as const;
  }

  const folderPath = folderPathFromSkillPath(parsed.skillPath);
  const provisionalName =
    folderPath.split("/").filter(Boolean).pop() ?? "skill";
  const destDir = path.join(
    getAgentSkillsDir(getAgent("agents")),
    provisionalName,
  );

  let mirror: Awaited<ReturnType<typeof installSkillFiles>>;
  try {
    mirror = await installSkillFiles(
      parsed.repo,
      folderPath,
      destDir,
      getStoredToken(),
    );
  } catch (err) {
    return {
      ok: false,
      reason: "mirror-failed",
      message:
        err instanceof Error ? err.message : "Unexpected error during install.",
    } as const;
  }
  if (!mirror.ok) {
    return {
      ok: false,
      reason: "mirror-failed",
      message: mirror.message,
      rateLimit: mirror.rateLimit,
    } as const;
  }

  const meta = readSkillMeta(destDir);
  if (!meta) {
    fs.rmSync(destDir, { recursive: true, force: true });
    return {
      ok: false,
      reason: "no-skill-md",
      message: `${parsed.repo}/${folderPath} doesn't contain a SKILL.md with frontmatter.`,
    } as const;
  }

  // Rename to canonical name if frontmatter declares one.
  let finalName = provisionalName;
  if (meta.name && meta.name !== provisionalName) {
    const canonDest = path.join(
      getAgentSkillsDir(getAgent("agents")),
      meta.name,
    );
    fs.renameSync(destDir, canonDest);
    finalName = meta.name;
  }

  return { ok: true, name: finalName } as const;
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
    // Re-validate the renderer-supplied path. The picker IPC normally
    // guarantees a real directory with a skills/ child, but a
    // misbehaving renderer could call this handler with arbitrary
    // input; the merge implementation walks the path with fs ops, so
    // we refuse non-existent or skills-less paths up front.
    if (
      typeof sourcePath !== "string" ||
      !path.isAbsolute(sourcePath) ||
      !fs.existsSync(sourcePath) ||
      !fs.statSync(sourcePath).isDirectory() ||
      !fs.existsSync(path.join(sourcePath, "skills"))
    ) {
      return {
        ok: false,
        message: `Invalid merge source path: ${String(sourcePath)}`,
        report: { imported: [], conflicts: [], keptMine: [], renamed: [] },
      };
    }
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

/**
 * Compute the set of root directories the renderer is allowed to ask us
 * to reveal in Finder/Explorer. Anything outside this allowlist is
 * refused — a compromised or misbehaving renderer cannot use
 * `shell.openPath` as a generic file-open primitive.
 */
function allowedRevealRoots(): string[] {
  const roots: string[] = [];
  if (registryRoot) roots.push(path.resolve(registryRoot));
  for (const agent of AGENTS) {
    try {
      const dir = getAgentSkillsDir(agent);
      if (dir) roots.push(path.resolve(dir));
    } catch {
      // Ignore agents that aren't configured on this host.
    }
  }
  return roots;
}

/**
 * Returns true when `candidate` (after symlink-free normalization) sits
 * inside one of `roots`. Uses path.relative + boundary checks so
 * `/foo/bar-attacker` doesn't pass against root `/foo/bar`. Symlinks
 * are NOT pre-resolved (realpath would force the candidate to exist);
 * callers should assume the renderer cannot use this to traverse out
 * of the allowlist via `..` because we reject any normalized path
 * outside the listed roots.
 */
function isInsideAnyRoot(candidate: string, roots: string[]): boolean {
  const normalized = path.resolve(candidate);
  for (const root of roots) {
    const rel = path.relative(root, normalized);
    if (rel === "") return true;
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) return true;
  }
  return false;
}

ipcMain.handle(IPC.openInFinder, async (_e, absolutePath: string) => {
  if (typeof absolutePath !== "string" || absolutePath.length === 0) {
    return;
  }
  // Refuse anything that isn't an absolute, normalized path. Belt-and-
  // suspenders alongside the root check below.
  if (!path.isAbsolute(absolutePath)) return;
  if (!isInsideAnyRoot(absolutePath, allowedRevealRoots())) {
    console.warn(
      `openInFinder: refused path outside allowlist: ${absolutePath}`,
    );
    return;
  }
  await shell.openPath(absolutePath);
});

mutatingHandle(
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
    // Opportunistically authenticate the tarball fetch when a token is
    // already on disk (typically from a prior GitHub-linked session).
    // Unauthenticated GitHub API calls share a 60 req/hr ceiling per IP
    // — easy to exhaust on NAT'd networks. The token is irrelevant to
    // local-bundled semantics; it just raises the ceiling to 5000/hr.
    const token = getStoredToken();
    // syncCanonical mirrors the curated/bundled repo; its discovered
    // skills land in the vendored bucket per the bucket UL (curated
    // origin → vendored locally).
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

mutatingHandle(IPC.syncCanonical, () => runSync());

ipcMain.handle(IPC.getSyncReport, () => {
  if (!registryRoot) return null;
  return readLastSyncReport(registryRoot);
});

ipcMain.handle(IPC.getPendingConflicts, () => {
  if (!registryRoot) return null;
  return readPendingConflicts(registryRoot);
});

// Persist user choices and immediately re-run sync so the resolutions
// take effect without a separate user action. The re-run reads the
// just-written decisions inside syncTarballToRegistry.
mutatingHandle(IPC.resolveConflicts, async (_e, decisions: SyncDecisions) => {
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
 * v0.11.9 M8: commit the github-linked-mode flip. Replacing the registry
 * with a repo, restoring a session after relaunch, and any future
 * re-link path all use this to atomically promote (registrySource,
 * linkedRepo) to the authed/linked tuple — the "authed-but-unlinked"
 * interstitial in AccountModal was the symptom of these two fields
 * drifting out of sync.
 */
function commitGithubLinkage(meta: LinkedRepoMetadata): void {
  registrySource = "github";
  linkedRepo = meta;
  persistConfig();
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
    // v1.5: dropped the migrateLegacyGithubMarkers call. The pre-v0.11
    // heuristic ("source: user + syncedFromCommit ⇒ legacy linked-repo
    // entry ⇒ stamp curated") was inverted by Phase 1's mountTo policy —
    // linked-repo skills are now correctly stamped `user`, so re-stamping
    // them to `curated` is destructive. Any v0.10-era config that still
    // needed the migration has been through multiple minor cycles by now.
    //
    // Linking a user's own GitHub repo: discovered skills land in the
    // personal bucket. Discovery walks the whole repo tree by file
    // convention, so flat / bucketed / nested remote layouts all link.
    const report = await syncTarballToRegistry({
      registryRoot,
      owner,
      repo,
      token,
      mountTo: "personal",
      onStatus: (phase) => broadcastSyncStatus({ kind: phase }),
    });
    // Only a report with zero discoveries means "no recognizable
    // skills". A pull where every skill matched its local content
    // hash also upserts nothing (`unchanged` carries the skips) —
    // that's a successful no-op, handled by the success path below.
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
    // v0.11.9 M8: linkage commit step extracted so other paths
    // (re-link, restore from session) can reuse it.
    // Fetch the repo's default branch so push/read operations can
    // target the correct base without hardcoding "main".
    let fetchedDefaultBranch: string | undefined;
    try {
      const repoMetaRes = await coreGhFetch<{ default_branch: string }>(
        `${GH_API}/repos/${fullName}`,
        { method: "GET" },
        token,
      );
      if (repoMetaRes.ok)
        fetchedDefaultBranch = repoMetaRes.body.default_branch;
    } catch {
      // Non-fatal — defaultBranch stays undefined; handlers fall back to "main".
    }
    commitGithubLinkage({
      fullName,
      lastFetchedAt: report.syncedAt,
      syncedFromCommit: report.commitSha,
      defaultBranch: fetchedDefaultBranch,
    });
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

mutatingHandle(IPC.reposReplaceRegistry, async (_e, fullName: string) =>
  replaceRegistryWithRepo(fullName),
);

mutatingHandle(IPC.reposRefreshCurrent, async () => {
  // Refresh is universal: bundled-default users (`linkedRepo` null)
  // fall through to the canonical bundled repo, so the same diff-
  // before-apply path serves every refresh — no separate Sync code
  // path and no mode conditional in the renderer.
  const target = linkedRepo?.fullName ?? BUNDLED_REPO;
  return replaceRegistryWithRepo(target);
});

/**
 * Restrict `shell.openExternal` to http(s) URLs. Without this guard a
 * compromised renderer could ship `file://`, `javascript:`, custom
 * URI schemes, or registered protocol handlers to escape the sandbox.
 * Anything that fails the URL parse or scheme check is silently dropped
 * and logged.
 */
function isSafeExternalUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length === 0) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

ipcMain.handle(IPC.openExternal, async (_e, url: string) => {
  if (!isSafeExternalUrl(url)) {
    console.warn(`openExternal: refused non-http(s) URL: ${String(url)}`);
    return;
  }
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

mutatingHandle(IPC.removeBrokenLinks, (_e, name: string, agents: AgentId[]) => {
  if (!registryRoot)
    return { removed: [], errors: [{ agent: "claude", message: NO_ROOT_MSG }] };
  return removeBrokenLinks(registryRoot, name, agents);
});

ipcMain.handle(IPC.localDiagnosticsScan, (_e, customDirs?: string[]) => {
  if (!registryRoot) {
    return { items: [], scannedAt: new Date().toISOString() };
  }
  return scanLocalDiagnostics(registryRoot, {
    ...(customDirs ? { customSkillsDirs: customDirs } : {}),
  });
});

mutatingHandle(
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

// Open the self-host docs. Prefer the live docs site (the source of
// truth for user-facing docs) and fall back to the bundled markdown
// copy if the site is unreachable (offline). The self-host.md file
// ships via electron-builder's `extraResources` for packaged builds;
// in dev we resolve relative to the desktop package's app path
// (`<repo>/packages/desktop/`).
const SELF_HOST_URL = "https://skills-bank-desktop.vercel.app/self-host";

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
    : path.join(app.getAppPath(), "..", "docs", "self-host.md");
  if (!fs.existsSync(docPath)) {
    return { ok: false, message: `self-host docs not found at ${docPath}` };
  }
  const error = await shell.openPath(docPath);
  if (error) return { ok: false, message: error };
  return { ok: true };
});

// App-wide WebContents hardening. Every web contents (main window,
// Discover view, future windows) gets:
//   - `setWindowOpenHandler` defaulted to "deny + route http(s) to the
//     OS browser" so a renderer can't pop a new BrowserWindow.
//   - `will-navigate` cancelled for anything outside file:// (main
//     bundle) or the Discover host allowlist — defends against a
//     compromised renderer chasing a malicious href.
// The Discover view installs its own handlers (above) that match this
// default; the duplication is harmless and the order is unimportant.
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, navUrl) => {
    try {
      const parsed = new URL(navUrl);
      // Local app bundle (loadFile) — always allowed.
      if (parsed.protocol === "file:") return;
      // Discover view's host allowlist.
      if (
        (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        DISCOVER_HOSTS.has(parsed.hostname)
      ) {
        return;
      }
      // Anything else: cancel + route http(s) to the OS browser.
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
  // Curated auto-refresh on boot. Per v1.3 persona collapse, curated is
  // an app-managed dependency rather than a primary user surface — the
  // manual "Refresh from bank" button retired in v1.7+. A silent runSync
  // a beat after the probe keeps curated fresh against
  // Tyler-Reagan/skills-bank without a user lever. Surfaced read-only
  // in Settings → Curated skills via getSyncReport().syncedAt.
  setTimeout(() => {
    void runSync().catch(() => {
      // Auto-refresh failure stays silent; the user sees the stale
      // `Last checked` timestamp in Settings and can rerun on next
      // app launch.
    });
  }, PROBE_BOOT_DELAY_MS + 2_000);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ── Labels ────────────────────────────────────────────────────────────────────

function labelsFilePath(): string {
  return path.join(app.getPath("userData"), "labels.json");
}

function readLabelsFile(): import("@skills-bank/core").LabelsMap {
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

function writeLabelsFile(data: import("@skills-bank/core").LabelsMap): void {
  fs.writeFileSync(labelsFilePath(), JSON.stringify(data, null, 2) + "\n");
}

/**
 * Merge the label overrides an import reconstructed from a manifest into
 * the local `labels.json`. Per-skill, the pulled override replaces the
 * local one (the manifest is the authority being applied). No-op when the
 * import reconstructed nothing.
 */
function applyRestoredLabels(
  restored: import("@skills-bank/core").LabelsMap | undefined,
): void {
  if (!restored || Object.keys(restored).length === 0) return;
  const data = readLabelsFile();
  for (const [name, override] of Object.entries(restored)) {
    data[name] = override;
  }
  writeLabelsFile(data);
}

/**
 * Shared `exportRegistryManifest` inputs sourced from app state: the
 * active linked repo (drives self-origin synthesis + bucket derivation)
 * and the local curation labels (fill each entry's category + tags).
 * Spread into every export call site so the manifest is consistent
 * regardless of which flow produced it.
 */
function manifestExportContext(): {
  registryRootLabel?: string;
  linkedRepo?: string;
  labels: import("@skills-bank/core").LabelsMap;
} {
  const full = linkedRepo?.fullName ?? undefined;
  return {
    ...(full ? { registryRootLabel: full, linkedRepo: full } : {}),
    labels: readLabelsFile(),
  };
}

ipcMain.handle(IPC.readLabels, (): import("@skills-bank/core").LabelsMap => {
  return readLabelsFile();
});

ipcMain.handle(
  IPC.updateLabel,
  (
    _e,
    name: string,
    patch: import("@skills-bank/core").SkillLabelOverride,
  ): void => {
    const data = readLabelsFile();
    data[name] = { ...(data[name] ?? {}), ...patch };
    writeLabelsFile(data);
  },
);

ipcMain.handle(IPC.resetLabel, (_e, name: string): void => {
  const data = readLabelsFile();
  delete data[name];
  writeLabelsFile(data);
});

ipcMain.handle(
  IPC.bulkUpdateLabels,
  (_e, updates: import("@skills-bank/core").LabelsMap): void => {
    const data = readLabelsFile();
    for (const [name, override] of Object.entries(updates)) {
      data[name] = { ...(data[name] ?? {}), ...override };
    }
    writeLabelsFile(data);
  },
);
