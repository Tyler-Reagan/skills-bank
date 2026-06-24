/**
 * File-level read/write primitives for the GitHub Contents API.
 * All three functions use `ghFetch` from `./github-http.js` — never
 * inline fetch calls with hand-rolled headers.
 *
 * Naming convention (per UL):
 *   - `readRepoFile`          — IO: GET a file from a repo
 *   - `writeRepoFile`         — IO: upsert (create or update) a file
 *   - `writeRepoFileAsBranch` — IO: write to a named branch, creating it if absent
 */

import { GH_API, ghFetch, type RateLimitInfo } from "./http.js";

// ─── readRepoFile ───────────────────────────────────────────────────

export interface ReadRepoFileOptions {
  repo: string;
  path: string;
  /** Ref (branch, tag, SHA) to read from. Defaults to the repo default. */
  ref?: string;
  token: string;
}

export type ReadRepoFileResult =
  | { ok: true; content: string; sha: string }
  | { ok: false; status: number; message: string; rateLimit?: RateLimitInfo };

export async function readRepoFile(
  opts: ReadRepoFileOptions,
): Promise<ReadRepoFileResult> {
  const url = `${GH_API}/repos/${opts.repo}/contents/${opts.path}${opts.ref ? `?ref=${encodeURIComponent(opts.ref)}` : ""}`;
  const res = await ghFetch<{ content: string; sha: string }>(
    url,
    { method: "GET" },
    opts.token,
  );
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: res.message,
      rateLimit: res.rateLimit,
    };
  }
  const raw = res.body.content.replace(/\n/g, "");
  const content = Buffer.from(raw, "base64").toString("utf8");
  return { ok: true, content, sha: res.body.sha };
}

// ─── writeRepoFile ──────────────────────────────────────────────────

export interface WriteRepoFileOptions {
  repo: string;
  path: string;
  content: string;
  message: string;
  /** Branch to write to. Omit to write to the repo default branch. */
  branch?: string;
  token: string;
}

export type WriteRepoFileResult =
  | { ok: true; commitSha: string; htmlUrl: string }
  | { ok: false; status: number; message: string; rateLimit?: RateLimitInfo };

export async function writeRepoFile(
  opts: WriteRepoFileOptions,
): Promise<WriteRepoFileResult> {
  // GET current blob SHA (required by PUT for updates; omitted for new files).
  const getUrl = `${GH_API}/repos/${opts.repo}/contents/${opts.path}${opts.branch ? `?ref=${encodeURIComponent(opts.branch)}` : ""}`;
  const getRes = await ghFetch<{ sha: string }>(
    getUrl,
    { method: "GET" },
    opts.token,
  );
  let currentSha: string | undefined;
  if (getRes.ok) {
    currentSha = getRes.body.sha;
  } else if (getRes.status !== 404) {
    return {
      ok: false,
      status: getRes.status,
      message: getRes.message,
      rateLimit: getRes.rateLimit,
    };
  }

  const body: Record<string, unknown> = {
    message: opts.message,
    content: Buffer.from(opts.content, "utf8").toString("base64"),
  };
  if (opts.branch) body.branch = opts.branch;
  if (currentSha) body.sha = currentSha;

  const putUrl = `${GH_API}/repos/${opts.repo}/contents/${opts.path}`;
  const putRes = await ghFetch<{
    commit: { sha: string };
    content: { html_url: string };
  }>(
    putUrl,
    {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    },
    opts.token,
  );
  if (!putRes.ok) {
    return {
      ok: false,
      status: putRes.status,
      message: putRes.message,
      rateLimit: putRes.rateLimit,
    };
  }
  return {
    ok: true,
    commitSha: putRes.body.commit.sha,
    htmlUrl: putRes.body.content.html_url,
  };
}

// ─── writeRepoFileAsBranch ──────────────────────────────────────────

export interface WriteRepoFileAsBranchOptions {
  repo: string;
  path: string;
  content: string;
  message: string;
  /** Branch to write to. Created from `baseBranch` if it doesn't exist. */
  branch: string;
  /** Base branch to fork from when creating a new branch. */
  baseBranch: string;
  token: string;
}

export type WriteRepoFileAsBranchResult =
  | { ok: true; commitSha: string; branchName: string }
  | { ok: false; status: number; message: string; rateLimit?: RateLimitInfo };

export async function writeRepoFileAsBranch(
  opts: WriteRepoFileAsBranchOptions,
): Promise<WriteRepoFileAsBranchResult> {
  // Check whether the branch already exists.
  const refUrl = `${GH_API}/repos/${opts.repo}/git/refs/heads/${encodeURIComponent(opts.branch)}`;
  const refRes = await ghFetch<{ object: { sha: string } }>(
    refUrl,
    { method: "GET" },
    opts.token,
  );
  if (!refRes.ok && refRes.status !== 404) {
    return {
      ok: false,
      status: refRes.status,
      message: refRes.message,
      rateLimit: refRes.rateLimit,
    };
  }

  // Always reset the branch to the current baseBranch HEAD — whether
  // creating or updating — so the PR is never based on a stale commit
  // that conflicts with intervening main changes.
  const baseRefUrl = `${GH_API}/repos/${opts.repo}/git/refs/heads/${encodeURIComponent(opts.baseBranch)}`;
  const baseRes = await ghFetch<{ object: { sha: string } }>(
    baseRefUrl,
    { method: "GET" },
    opts.token,
  );
  if (!baseRes.ok) {
    return {
      ok: false,
      status: baseRes.status,
      message: baseRes.message,
      rateLimit: baseRes.rateLimit,
    };
  }
  const baseSha = baseRes.body.object.sha;

  if (!refRes.ok) {
    const createRes = await ghFetch<{ ref: string }>(
      `${GH_API}/repos/${opts.repo}/git/refs`,
      {
        method: "POST",
        body: JSON.stringify({
          ref: `refs/heads/${opts.branch}`,
          sha: baseSha,
        }),
        headers: { "Content-Type": "application/json" },
      },
      opts.token,
    );
    if (!createRes.ok) {
      return {
        ok: false,
        status: createRes.status,
        message: createRes.message,
        rateLimit: createRes.rateLimit,
      };
    }
  } else {
    const resetRes = await ghFetch<{ ref: string }>(
      `${GH_API}/repos/${opts.repo}/git/refs/heads/${encodeURIComponent(opts.branch)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ sha: baseSha, force: true }),
        headers: { "Content-Type": "application/json" },
      },
      opts.token,
    );
    if (!resetRes.ok) {
      return {
        ok: false,
        status: resetRes.status,
        message: resetRes.message,
        rateLimit: resetRes.rateLimit,
      };
    }
  }

  const writeResult = await writeRepoFile({
    repo: opts.repo,
    path: opts.path,
    content: opts.content,
    message: opts.message,
    branch: opts.branch,
    token: opts.token,
  });
  if (!writeResult.ok) {
    return writeResult;
  }
  return {
    ok: true,
    commitSha: writeResult.commitSha,
    branchName: opts.branch,
  };
}
