import fs from "node:fs";
import path from "node:path";
import { createPatch, diffLines } from "diff";

/**
 * Per-file diff between two skill folders. Lifted from
 * `packages/desktop/src/main/main.ts` in v0.11.9 M3 so the CLI and
 * future test surfaces can use the same primitive without dragging
 * in Electron.
 *
 * Cap on individual file size — anything larger is treated as opaque
 * binary so we don't blow up the IPC channel or the renderer on
 * fixture-sized files.
 */
const DIFF_BYTE_BUDGET = 1024 * 1024;

export interface FolderDiffEntry {
  /** Relative path within the folder, e.g. "SKILL.md". */
  path: string;
  /** Lines present in right but not in left. */
  added: number;
  /** Lines present in left but not in right. */
  removed: number;
  /**
   * Unified-diff body without the surrounding header. Empty string
   * for binary entries (body omitted from the diff result entirely).
   */
  unifiedDiff: string;
  status: "modified" | "left-only" | "right-only" | "binary";
}

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
      if (ent.name === ".skills-bank-runtime.json") continue;
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) visit(r);
      else if (ent.isFile()) out.push(r);
    }
  }
  visit("");
  out.sort();
  return out;
}

/**
 * Compute a sorted list of per-file diffs between two skill folders.
 * Files that are byte-identical are omitted from the result.
 */
export function computeFolderDiff(
  leftRoot: string,
  rightRoot: string,
): FolderDiffEntry[] {
  const leftFiles = new Set(walkFiles(leftRoot));
  const rightFiles = new Set(walkFiles(rightRoot));
  const allPaths = new Set<string>([...leftFiles, ...rightFiles]);
  const sorted = [...allPaths].sort();
  const out: FolderDiffEntry[] = [];

  for (const rel of sorted) {
    const inLeft = leftFiles.has(rel);
    const inRight = rightFiles.has(rel);
    const leftAbs = path.join(leftRoot, rel);
    const rightAbs = path.join(rightRoot, rel);

    if (inLeft && inRight) {
      const left = readTextIfSmall(leftAbs);
      const right = readTextIfSmall(rightAbs);
      if (left.kind === "binary" || right.kind === "binary") {
        if (left.body === right.body) continue;
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
