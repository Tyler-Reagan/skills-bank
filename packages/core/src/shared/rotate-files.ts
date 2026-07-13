import fs from "node:fs";
import path from "node:path";

/** Deletes all but the newest `keep` `<prefix>*.json` files in `dir`, by mtime. Best-effort. */
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
