import fs from "node:fs";
import path from "node:path";
import { GH_API, ghFetch, type RateLimitInfo } from "./http.js";
import { writeRepoFileAsBranch } from "./files.js";
import { findSkillFolder } from "../registry/walk.js";

export interface RehomeIntoLinkedRepoParams {
  registryRoot: string;
  /** Skill name (registry key). */
  name: string;
  /** Linked repo `owner/name`. */
  linkedRepo: string;
  /** Default branch to base the PR branch on. */
  baseBranch: string;
  /**
   * Destination folder path within the linked repo, e.g.
   * `skills/tools/electron`. The skill's files are committed under it.
   */
  destPath: string;
  token: string;
}

export type RehomeIntoLinkedRepoResult =
  | {
      ok: true;
      prNumber: number;
      htmlUrl: string;
      branch: string;
      commitSha: string;
      fileCount: number;
    }
  | { ok: false; status?: number; message: string; rateLimit?: RateLimitInfo };

/**
 * Skip the app's per-skill sidecars — they're local bookkeeping, never
 * part of the skill's portable content.
 */
function isSidecar(relName: string): boolean {
  const base = path.basename(relName);
  return base.startsWith(".skills-bank") || base === "meta.json";
}

/** Recursively list a skill folder's content files (POSIX-relative), skipping sidecars. */
function listSkillContentFiles(skillDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        walk(path.join(dir, ent.name), childRel);
      } else if (ent.isFile() && !isSidecar(childRel)) {
        out.push(childRel);
      }
    }
  };
  walk(skillDir, "");
  return out.sort();
}

/**
 * Re-home a skill into the linked repo as a pull request (ADR-0012,
 * restore option 1). Commits the skill's content files onto a per-skill
 * branch (`rehome/<name>`) — one Contents-API commit per file via the
 * existing `writeRepoFileAsBranch`, reusing the same plumbing as the
 * manifest push, with no Git Data API — then opens (or reuses) a PR
 * against the default branch.
 *
 * It deliberately stops at the PR: the user merges it (handling any
 * repo-specific machinery — `.claude-plugin`, custom files, the exact
 * path — in review). After merge + the next sync, the skill's origin
 * resolves to a self-origin and it becomes syncable/installable again.
 * The caller is expected to have `detachOrigin`'d the skill first so it
 * is local-only meanwhile.
 *
 * Files are read as UTF-8 — skill content is text (SKILL.md, scripts).
 * Binary assets are out of scope for this path.
 */
export async function rehomeIntoLinkedRepo(
  params: RehomeIntoLinkedRepoParams,
): Promise<RehomeIntoLinkedRepoResult> {
  const { registryRoot, name, linkedRepo, baseBranch, token } = params;
  const ref = findSkillFolder(registryRoot, name);
  if (!ref) {
    return { ok: false, message: `${name} not found in any bucket` };
  }

  const files = listSkillContentFiles(ref.dir);
  if (files.length === 0) {
    return { ok: false, message: `${name} has no content files to re-home` };
  }

  const destFolder = params.destPath.replace(/\/+$/, "");
  const branch = `rehome/${name}`;
  const message = `feat(${name}): re-home skill into registry`;

  let commitSha = "";
  for (const rel of files) {
    const content = fs.readFileSync(path.join(ref.dir, rel), "utf8");
    const res = await writeRepoFileAsBranch({
      repo: linkedRepo,
      path: `${destFolder}/${rel}`,
      content,
      message,
      branch,
      baseBranch,
      token,
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: `failed committing ${rel}: ${res.message}`,
        rateLimit: res.rateLimit,
      };
    }
    commitSha = res.commitSha;
  }

  // Reuse an open PR on the branch if one exists; else create it.
  const owner = linkedRepo.split("/")[0];
  const listRes = await ghFetch<{ number: number; html_url: string }[]>(
    `${GH_API}/repos/${linkedRepo}/pulls?head=${owner}:${branch}&state=open`,
    { method: "GET" },
    token,
  );
  if (!listRes.ok) {
    return {
      ok: false,
      status: listRes.status,
      message: listRes.message,
      rateLimit: listRes.rateLimit,
    };
  }
  const existing = listRes.body[0];
  if (existing) {
    return {
      ok: true,
      prNumber: existing.number,
      htmlUrl: existing.html_url,
      branch,
      commitSha,
      fileCount: files.length,
    };
  }

  const createRes = await ghFetch<{ number: number; html_url: string }>(
    `${GH_API}/repos/${linkedRepo}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({
        title: `feat: re-home ${name} into registry`,
        body:
          `Re-homes the \`${name}\` skill into the registry at \`${destFolder}\`.\n\n` +
          `Its upstream origin was unreachable; this rehomes it into the linked ` +
          `repo so it stays installable. Review path placement and any ` +
          `repo-specific machinery before merging.`,
        head: branch,
        base: baseBranch,
      }),
      headers: { "Content-Type": "application/json" },
    },
    token,
  );
  if (!createRes.ok) {
    return {
      ok: false,
      status: createRes.status,
      message: createRes.message,
      rateLimit: createRes.rateLimit,
    };
  }
  return {
    ok: true,
    prNumber: createRes.body.number,
    htmlUrl: createRes.body.html_url,
    branch,
    commitSha,
    fileCount: files.length,
  };
}
