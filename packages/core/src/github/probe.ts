import fs from "node:fs";
import path from "node:path";
import type { RateLimitInfo } from "./http.js";
import {
  folderPathFromSkillPath,
  fetchOriginTree,
  type GitTreeEntry,
} from "./origin.js";
import { buildRegistryIndex } from "../build.js";
import { readRuntimeState, writeRuntimeState } from "../heal.js";
import { getStateDir } from "../paths.js";
import { ORIGIN_UNREACHABLE_THRESHOLD } from "../skill-state.js";

/**
 * The origin probe scheduler. Lifted from
 * `packages/desktop/src/main/main.ts` in v0.11.9 M2 so the CLI and
 * future test surfaces can drive a probe without an Electron host.
 *
 * State lives in the runner instance, not module-level — multiple
 * runners can coexist (the desktop has exactly one; tests can spin
 * up disposable ones with synthetic registries).
 *
 * Notification of probe completion runs through the
 * `onComplete` callback the caller injects. The desktop wires it
 * to a BrowserWindow broadcast; the CLI could log; tests can
 * collect events into an array.
 */

export interface RepoProbeCacheEntry {
  rootSha: string;
  folderHashes: Map<string, string>;
  fetchedAt: number;
}

export interface SkillProbeResult {
  latestHash: string;
  probedAt: number;
}

export interface ProbeCompleteEvent {
  rateLimit?: RateLimitInfo;
  failedRepos?: string[];
  updates?: number;
}

export interface ProbeResultSummary {
  probed: number;
  updates: number;
  probedAt: string;
}

export interface OriginProbeRunnerOpts {
  /** Resolve the active registry root at call time — null = no-op. */
  registryRoot: () => string | null;
  /** Resolve the OAuth token at call time. Null = unauthenticated. */
  token: () => string | null;
  /** Fire after every probe (including refresh nudges). */
  onComplete: (event: ProbeCompleteEvent) => void;
  /** Per-repo cache TTL. Default 5 minutes — the upstream tree
   *  rarely changes more than once per coffee break, and the
   *  cache survives only within a single session anyway. */
  cacheTtlMs?: number;
}

export interface OriginProbeRunner {
  /** Run a probe. Coalesces concurrent calls — a second call while
   *  one is in flight returns the in-flight promise. */
  run(): Promise<ProbeResultSummary>;
  /** Has the probe seen an upstream change for this skill since the
   *  last `clearUpdate` for it? */
  hasUpdate(name: string): boolean;
  /** Drop the recorded update flag for a name. Called by the
   *  desktop's `applyUpstreamUpdate` wrapper after a successful
   *  Update — the user has consumed the indicator. */
  clearUpdate(name: string): void;
  /** Augment an entries list with `originUpdateAvailable: true` for
   *  any name the probe has flagged. Pure read; cheap. */
  augmentEntries<T extends { name: string }>(entries: T[]): T[];
  /** Fire `onComplete` with an empty payload — used by call sites
   *  that mutate registry state and want the renderer to refresh
   *  without re-probing upstream. */
  notifyRefresh(): void;
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_FILE = "upstream-probe-cache.json";

interface PersistedCache {
  // Map<repo, RepoProbeCacheEntry> serialized as a plain object.
  // folderHashes is also serialized as a plain object (Maps don't
  // JSON-serialize natively).
  entries: Record<
    string,
    {
      rootSha: string;
      folderHashes: Record<string, string>;
      fetchedAt: number;
    }
  >;
}

function loadPersistedCache(
  registryRoot: string,
): Map<string, RepoProbeCacheEntry> {
  const out = new Map<string, RepoProbeCacheEntry>();
  const p = path.join(getStateDir(registryRoot), CACHE_FILE);
  if (!fs.existsSync(p)) return out;
  try {
    const raw = JSON.parse(
      fs.readFileSync(p, "utf8"),
    ) as Partial<PersistedCache>;
    if (!raw.entries || typeof raw.entries !== "object") return out;
    for (const [repo, entry] of Object.entries(raw.entries)) {
      if (
        !entry ||
        typeof entry.rootSha !== "string" ||
        typeof entry.fetchedAt !== "number" ||
        !entry.folderHashes ||
        typeof entry.folderHashes !== "object"
      ) {
        continue;
      }
      const folderHashes = new Map<string, string>();
      for (const [folder, sha] of Object.entries(entry.folderHashes)) {
        if (typeof sha === "string") folderHashes.set(folder, sha);
      }
      out.set(repo, {
        rootSha: entry.rootSha,
        folderHashes,
        fetchedAt: entry.fetchedAt,
      });
    }
  } catch {
    // Corrupt cache → start fresh. Failure mode is one extra probe
    // round-trip, not a broken app.
  }
  return out;
}

function persistCache(
  registryRoot: string,
  cache: Map<string, RepoProbeCacheEntry>,
): void {
  const payload: PersistedCache = { entries: {} };
  for (const [repo, entry] of cache.entries()) {
    const folderHashes: Record<string, string> = {};
    for (const [folder, sha] of entry.folderHashes.entries()) {
      folderHashes[folder] = sha;
    }
    payload.entries[repo] = {
      rootSha: entry.rootSha,
      folderHashes,
      fetchedAt: entry.fetchedAt,
    };
  }
  const dir = getStateDir(registryRoot);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, CACHE_FILE),
      JSON.stringify(payload, null, 2) + "\n",
    );
  } catch {
    // Failure to persist is non-fatal — the in-memory cache is the
    // authoritative copy within a session.
  }
}

/**
 * v1.4: increment a skill's runtime `probeFailureCount` after a
 * non-rate-limit probe failure. Saturates at the unreachable
 * threshold so the counter doesn't grow unboundedly — once the
 * drawer state has flipped, the precise value above the threshold
 * isn't meaningful, and skipping the disk write after saturation
 * avoids churning the runtime sidecar on every probe pass.
 *
 * Exported for the dedicated test suite (`origin-probe.test.ts`);
 * production callers are inside this module's probe loop.
 */
export function recordProbeFailure(
  registryRoot: string,
  skill: { path: string },
): void {
  try {
    const skillDir = path.resolve(registryRoot, skill.path);
    const runtime = readRuntimeState(skillDir);
    const current = runtime.probeFailureCount ?? 0;
    if (current >= ORIGIN_UNREACHABLE_THRESHOLD) return;
    writeRuntimeState(skillDir, {
      ...runtime,
      probeFailureCount: current + 1,
      lastProbeFailureAt: new Date().toISOString(),
    });
  } catch {
    // Counter is purely an indicator — don't surface failures from
    // the runtime sidecar back into the probe loop.
  }
}

/**
 * v1.4: reset a skill's runtime `probeFailureCount` after a
 * successful per-skill probe. No-op when the counter is already
 * zero — avoid unnecessary sidecar writes.
 *
 * Exported for the dedicated test suite (`origin-probe.test.ts`).
 */
export function recordProbeSuccess(
  registryRoot: string,
  skill: { path: string },
): void {
  try {
    const skillDir = path.resolve(registryRoot, skill.path);
    const runtime = readRuntimeState(skillDir);
    if (!runtime.probeFailureCount) return;
    const {
      probeFailureCount: _drop,
      lastProbeFailureAt: _drop2,
      ...rest
    } = runtime;
    void _drop;
    void _drop2;
    writeRuntimeState(skillDir, rest);
  } catch {
    // See recordProbeFailure.
  }
}

export function createOriginProbeRunner(
  opts: OriginProbeRunnerOpts,
): OriginProbeRunner {
  const repoProbeCache = new Map<string, RepoProbeCacheEntry>();
  const probedUpdates = new Map<string, SkillProbeResult>();
  const ttl = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  let inFlight: Promise<ProbeResultSummary> | null = null;
  let cacheLoadedForRoot: string | null = null;

  /**
   * Lazy-load the persisted cache the first time we see each registry
   * root. v0.11.9 M7: relaunching within the TTL window no longer
   * re-probes upstream — the previous session's tree responses are
   * still valid.
   */
  function ensureLoaded(): void {
    const root = opts.registryRoot();
    if (!root) return;
    if (cacheLoadedForRoot === root) return;
    const loaded = loadPersistedCache(root);
    for (const [repo, entry] of loaded.entries()) {
      // Don't overwrite an entry we already probed in this session —
      // in-memory always wins.
      if (!repoProbeCache.has(repo)) {
        repoProbeCache.set(repo, entry);
      }
    }
    cacheLoadedForRoot = root;
  }

  function buildFolderHashMap(tree: GitTreeEntry[]): Map<string, string> {
    const m = new Map<string, string>();
    for (const entry of tree) {
      if (entry.type === "tree") m.set(entry.path, entry.sha);
    }
    return m;
  }

  async function runOnce(): Promise<ProbeResultSummary> {
    const probedAt = new Date().toISOString();
    const root = opts.registryRoot();
    if (!root) {
      // Emit a no-updates completion so the renderer's Rescan state
      // machine can advance from `working` → `done` → `idle`. Without
      // this, an early return here leaves the button stuck spinning.
      opts.onComplete({});
      return { probed: 0, updates: 0, probedAt };
    }
    ensureLoaded();
    let index;
    try {
      index = buildRegistryIndex(root);
    } catch (err) {
      console.warn("upstream probe: failed to read registry:", err);
      // Same rationale as the no-root branch — the renderer is waiting
      // on this event before it'll transition out of `working`.
      opts.onComplete({});
      return { probed: 0, updates: 0, probedAt };
    }
    const candidates = index.entries.filter(
      (e) =>
        e.source.origin?.kind === "github" &&
        typeof e.source.origin.repo === "string" &&
        typeof e.source.origin.skillPath === "string" &&
        typeof e.source.origin.skillFolderHash === "string",
    );
    if (candidates.length === 0) {
      // Most-common early-return: registries with no baselined origin
      // markers have nothing for the probe to do, but the renderer
      // still needs a completion event to leave `working`.
      opts.onComplete({});
      return { probed: 0, updates: 0, probedAt };
    }
    const byRepo = new Map<string, typeof candidates>();
    for (const e of candidates) {
      const repo = e.source.origin!.repo!;
      const bucket = byRepo.get(repo);
      if (bucket) bucket.push(e);
      else byRepo.set(repo, [e]);
    }
    const token = opts.token();
    let updates = 0;
    let rateLimitInfo: RateLimitInfo | undefined;
    const failedRepos: string[] = [];
    for (const [repo, skills] of byRepo) {
      let cache = repoProbeCache.get(repo);
      const now = Date.now();
      if (!cache || now - cache.fetchedAt > ttl) {
        const res = await fetchOriginTree(repo, token);
        if (!res.ok) {
          console.warn(
            `upstream probe: ${repo} failed (${res.status}): ${res.message}`,
          );
          if (res.status === 429 && res.rateLimit) {
            // First rate-limit hit wins — all carry the same window
            // state (limit/remaining/resetAt are repo-agnostic for
            // unauth-per-IP). v1.4: rate-limit doesn't reflect origin
            // reachability, so per-skill counters are untouched.
            if (!rateLimitInfo) rateLimitInfo = res.rateLimit;
          } else {
            failedRepos.push(repo);
            // v1.4: persistent non-429 failure on the per-repo tree
            // fetch counts as a probe failure for every skill in
            // that repo.
            for (const skill of skills) {
              recordProbeFailure(root, skill);
            }
          }
          continue;
        }
        const folderHashes = buildFolderHashMap(res.tree);
        cache = { rootSha: res.rootSha, folderHashes, fetchedAt: now };
        repoProbeCache.set(repo, cache);
      }
      for (const skill of skills) {
        const origin = skill.source.origin!;
        const folderPath = folderPathFromSkillPath(origin.skillPath!);
        const currentHash = cache.folderHashes.get(folderPath);
        if (currentHash) {
          // Probe surfaced a folder hash — origin is reachable. Reset
          // any pre-existing failure counter even when the hashes
          // match (no update). v1.4.
          recordProbeSuccess(root, skill);
          if (currentHash !== origin.skillFolderHash) {
            probedUpdates.set(skill.name, {
              latestHash: currentHash,
              probedAt: now,
            });
            updates++;
          } else {
            probedUpdates.delete(skill.name);
          }
        } else {
          // Tree fetch succeeded but the skill's folder isn't in it
          // — moved, renamed, or removed upstream. Per-skill probe
          // failure. v1.4.
          probedUpdates.delete(skill.name);
          recordProbeFailure(root, skill);
        }
      }
    }
    // Persist the cache so a relaunch within the TTL window reuses
    // the trees we just fetched. Best-effort — failure isn't fatal.
    persistCache(root, repoProbeCache);
    opts.onComplete({
      updates,
      ...(rateLimitInfo ? { rateLimit: rateLimitInfo } : {}),
      ...(failedRepos.length > 0 ? { failedRepos } : {}),
    });
    return { probed: byRepo.size, updates, probedAt };
  }

  return {
    async run() {
      if (inFlight) return inFlight;
      inFlight = runOnce();
      try {
        return await inFlight;
      } finally {
        inFlight = null;
      }
    },
    hasUpdate(name) {
      return probedUpdates.has(name);
    },
    clearUpdate(name) {
      probedUpdates.delete(name);
    },
    augmentEntries(entries) {
      if (probedUpdates.size === 0) return entries;
      return entries.map((e) =>
        probedUpdates.has(e.name)
          ? ({ ...e, originUpdateAvailable: true } as typeof e)
          : e,
      );
    },
    notifyRefresh() {
      opts.onComplete({});
    },
  };
}
