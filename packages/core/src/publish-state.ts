import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { walkSkills } from "./registry.js";
import type { PublishState } from "./types.js";

/**
 * Compute the per-skill publish state in one batched git pass:
 *   - "untracked": working-tree has uncommitted changes inside the skill folder
 *   - "draft":     latest commit touching the folder is local-only (not in upstream)
 *   - "pushed":    latest commit is reachable from the upstream branch
 *   - "unknown":   not a git repo, or no upstream configured
 *
 * Returns an empty map (treated as "unknown" by callers) when the
 * registry root isn't a git working tree or git isn't on PATH. We do
 * three execs total — porcelain status, the unpushed SHA list, and a
 * single bulk `git log` — independent of skill count.
 *
 * v0.11.9 M6: moved from build.ts so `buildRegistryIndex` can accept
 * a pre-computed map via injection, letting future tests skip the
 * `child_process` stub when they only care about the file walker.
 */
export function computePublishStates(
  registryRoot: string,
): Map<string, PublishState> {
  const out = new Map<string, PublishState>();
  if (!fs.existsSync(path.join(registryRoot, ".git"))) return out;

  const exec = (cmd: string): string | null => {
    try {
      return execSync(cmd, {
        cwd: registryRoot,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      return null;
    }
  };

  // Untracked / modified files under skills/<name>/...
  const porcelain = exec(`git status --porcelain skills/`);
  if (porcelain !== null) {
    for (const line of porcelain.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Status format: "XY path" — path always starts at column 3.
      const filePath = line.slice(3);
      const m = /^skills\/([^/]+)\//.exec(filePath);
      if (m && m[1]) out.set(m[1], "untracked");
    }
  }

  // No upstream → nothing to compare against; everything tracked is "unknown".
  const upstream = exec(`git rev-parse --abbrev-ref @{u}`)?.trim();
  if (!upstream) {
    // Fall back: leave already-set untracked entries; everything else is unknown.
    return out;
  }

  // Set of commits present locally but not in upstream.
  const unpushedRaw = exec(`git rev-list ${upstream}..HEAD`);
  const unpushedSet = new Set<string>(
    (unpushedRaw ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  // Bulk: latest commit per skill folder via name-only diff. Iterate
  // each skill's last commit cheaply. Walks the bucket subtree via
  // walkSkills so we get the right relPath for the git log scope.
  for (const ref of walkSkills(registryRoot)) {
    if (out.has(ref.name)) continue; // already untracked
    const sha = exec(`git log -1 --format=%H -- "${ref.relPath}"`)?.trim();
    if (!sha) {
      // Folder has no commit history → counts as a local edit.
      out.set(ref.name, "untracked");
      continue;
    }
    out.set(ref.name, unpushedSet.has(sha) ? "draft" : "pushed");
  }
  return out;
}
