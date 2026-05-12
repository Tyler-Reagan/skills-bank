import fs from "node:fs";
import path from "node:path";
import { getStateDir } from "./paths.js";

const UPSTREAM_CANON_FILE = "upstream-canon.json";
const CACHE_TTL_MS = 30_000;

/**
 * Snapshot of the upstream canonical name set for a linked registry.
 *
 * Written:
 *   - by sync after a successful canonical pull (`source: "synced"`)
 *   - at first-run seed from the bundled `seed/index.json` (`source: "bundled"`)
 *   - by merge-import (M8) when adding entries from another registry (`source: "imported"`)
 *
 * Read by `buildRegistryIndex` to populate `RegistryEntry.canon`.
 * Absent for power-persona repos — those derive canon from `publishState`.
 */
interface UpstreamCanonFile {
  names: string[];
  source: "bundled" | "synced" | "imported";
  updatedAt: string;
}

interface CacheEntry {
  names: Set<string>;
  expires: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Read the cached upstream name set for `registryRoot`. Returns an
 * empty set when no snapshot exists — callers fall back to publishState
 * (power-persona path) or treat the result as "nothing is canon here."
 *
 * TTL keeps repeated reads cheap when buildRegistryIndex fires on every
 * IPC; an explicit write invalidates the cache so the next read picks
 * up changes immediately.
 */
export function readUpstreamCanonNames(registryRoot: string): Set<string> {
  const now = Date.now();
  const cached = cache.get(registryRoot);
  if (cached && cached.expires > now) return cached.names;

  const p = path.join(getStateDir(registryRoot), UPSTREAM_CANON_FILE);
  let names = new Set<string>();
  if (fs.existsSync(p)) {
    try {
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<UpstreamCanonFile>;
      if (Array.isArray(raw.names)) {
        names = new Set(
          raw.names.filter((n): n is string => typeof n === "string"),
        );
      }
    } catch {
      // Corrupt or partial write — treat as empty so we don't lock the
      // user out of canon-gated actions on a recoverable parse error.
    }
  }
  cache.set(registryRoot, { names, expires: now + CACHE_TTL_MS });
  return names;
}

/**
 * Replace the upstream snapshot with `names`. Invalidates the cache so
 * the next `readUpstreamCanonNames` reflects the write immediately.
 *
 * Idempotent: writes are de-duplicated and sorted so two syncs producing
 * the same set yield byte-identical files.
 */
export function writeUpstreamCanonNames(
  registryRoot: string,
  names: string[],
  source: UpstreamCanonFile["source"],
): void {
  const dir = getStateDir(registryRoot);
  fs.mkdirSync(dir, { recursive: true });
  const payload: UpstreamCanonFile = {
    names: [...new Set(names)].sort(),
    source,
    updatedAt: new Date().toISOString(),
  };
  const p = path.join(dir, UPSTREAM_CANON_FILE);
  fs.writeFileSync(p, JSON.stringify(payload, null, 2) + "\n");
  cache.delete(registryRoot);
}

/**
 * Drop cached upstream-canon state. Call on repo switch so the next
 * build doesn't classify the new repo's skills against the old repo's
 * canon set.
 */
export function invalidateCanonCache(registryRoot?: string): void {
  if (registryRoot) cache.delete(registryRoot);
  else cache.clear();
}
