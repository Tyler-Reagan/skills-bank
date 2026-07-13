import fs from "node:fs";
import path from "node:path";

/**
 * Deletes all but the newest `keep` files in `dir` whose name starts with
 * `prefix` and ends with `.json`, ordered by mtime. Best-effort: a file
 * that can't be stat'd sorts oldest, and an unlink failure is swallowed
 * rather than aborting the rest of the sweep. Shared by every timestamped
 * per-operation log this repo writes (registry snapshots, registration
 * audit entries, ...) so they stop accreting one file forever (ADR-0021).
 */
export function rotateFilesByPrefix(
  dir: string,
  prefix: string,
  keep: number,
): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const entries = names
    .filter((n) => n.startsWith(prefix) && n.endsWith(".json"))
    .map((n) => ({ name: n, mtimeMs: safeMtimeMs(path.join(dir, n)) }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const removed: string[] = [];
  for (const e of entries.slice(keep)) {
    const p = path.join(dir, e.name);
    try {
      fs.unlinkSync(p);
      removed.push(p);
    } catch {
      // best-effort rotation
    }
  }
  return removed;
}

function safeMtimeMs(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}
