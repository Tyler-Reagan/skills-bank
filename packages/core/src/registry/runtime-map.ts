import fs from "node:fs";
import path from "node:path";
import { getStateDir } from "../shared/paths.js";

/**
 * The registry's volatile per-skill state, consolidated into ONE
 * gitignored file at `<root>/.skills-bank/runtime.json` (ADR-0021),
 * replacing the 2–3 per-skill sidecars × N skills of the old model. Keyed
 * by skill name. Index build does one read instead of 3N; a mutation is
 * one atomic-rename write.
 *
 * This is the committed/volatile split ADR-0002 established, surviving as
 * this file's whole reason to exist: content and origin are the source of
 * truth (folders + manifest, both committed), while everything here
 * churns per-probe and must never be committed.
 */
export interface RuntimeEntry {
  /** SHA-256 content hash recorded at last sync/acquisition — drift baseline. */
  syncedHash?: string;
  /** ISO-8601 timestamp of the last successful upstream fetch. */
  fetchedAt?: string;
  /**
   * Consecutive failed origin probes. Reset to 0 on the next successful
   * probe; rate-limit (429) failures are not counted. Drives the
   * `origin-unreachable` drawer state at `ORIGIN_UNREACHABLE_THRESHOLD`.
   */
  probeFailureCount?: number;
  /** ISO-8601 timestamp of the most recent probe failure. Diagnostic. */
  lastProbeFailureAt?: string;
  /**
   * ISO-8601 timestamp of the skill's most recent failed Unregister
   * attempt (issue #211/#215: "Unregister Failure"). Not a data-state
   * flag — the folder and manifest row are untouched by a failed
   * attempt, so this is the only record that it happened. Cleared on a
   * successful Unregister (the row/runtime entry are dropped together
   * by `reconcileFoldersToManifest`) or by explicit dismissal.
   */
  unregisterFailedAt?: string;
}

export type RuntimeMap = Record<string, RuntimeEntry>;

const RUNTIME_MAP_FILE = "runtime.json";

function runtimeMapPath(registryRoot: string): string {
  return path.join(getStateDir(registryRoot), RUNTIME_MAP_FILE);
}

/** Read the whole runtime map (empty object if absent/corrupt). */
export function readRuntimeMap(registryRoot: string): RuntimeMap {
  const p = runtimeMapPath(registryRoot);
  if (!fs.existsSync(p)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Record<
      string,
      unknown
    >;
    const out: RuntimeMap = {};
    for (const [name, v] of Object.entries(raw)) {
      out[name] = normalizeEntry(v);
    }
    return out;
  } catch {
    return {};
  }
}

function normalizeEntry(v: unknown): RuntimeEntry {
  const r = (v ?? {}) as Partial<RuntimeEntry>;
  const out: RuntimeEntry = {};
  if (typeof r.syncedHash === "string") out.syncedHash = r.syncedHash;
  if (typeof r.fetchedAt === "string") out.fetchedAt = r.fetchedAt;
  if (typeof r.probeFailureCount === "number" && r.probeFailureCount > 0) {
    out.probeFailureCount = r.probeFailureCount;
  }
  if (typeof r.lastProbeFailureAt === "string") {
    out.lastProbeFailureAt = r.lastProbeFailureAt;
  }
  if (typeof r.unregisterFailedAt === "string") {
    out.unregisterFailedAt = r.unregisterFailedAt;
  }
  return out;
}

/** Atomically write the whole runtime map (sorted keys, stable bytes). */
export function writeRuntimeMap(registryRoot: string, map: RuntimeMap): void {
  const dir = getStateDir(registryRoot);
  fs.mkdirSync(dir, { recursive: true });
  const sorted: RuntimeMap = {};
  for (const name of Object.keys(map).sort()) {
    // Drop entries that carry no fields so the map stays clean.
    if (Object.keys(map[name]!).length > 0) sorted[name] = map[name]!;
  }
  const p = runtimeMapPath(registryRoot);
  const tmp = p + ".tmp~";
  fs.writeFileSync(tmp, JSON.stringify(sorted, null, 2) + "\n");
  fs.renameSync(tmp, p);
}

/** One skill's runtime entry (empty object if none). */
export function getRuntimeEntry(
  registryRoot: string,
  name: string,
): RuntimeEntry {
  return readRuntimeMap(registryRoot)[name] ?? {};
}

/**
 * Read-modify-write one skill's runtime entry. Merges `patch` over the
 * existing entry; keys set to `undefined` are dropped.
 */
export function setRuntimeEntry(
  registryRoot: string,
  name: string,
  patch: RuntimeEntry,
): void {
  const map = readRuntimeMap(registryRoot);
  const merged = { ...(map[name] ?? {}), ...patch };
  for (const k of Object.keys(merged) as (keyof RuntimeEntry)[]) {
    if (merged[k] === undefined) delete merged[k];
  }
  map[name] = merged;
  writeRuntimeMap(registryRoot, map);
}

/** Forget one skill's runtime entry (e.g. on delete/unregister). */
export function removeRuntimeEntry(registryRoot: string, name: string): void {
  const map = readRuntimeMap(registryRoot);
  if (!(name in map)) return;
  delete map[name];
  writeRuntimeMap(registryRoot, map);
}
