/**
 * Publish a local skill folder to the linked repo as a pull request.
 * See ADR-0007 for the six-step invariant pin.
 *
 * Symmetric counterpart to `mirrorSkillFolder` in `origin.ts`. Drives
 * the GitHub REST API directly via the user's Device Flow OAuth token
 * to commit a local skill folder onto a `publish/<name>` branch and
 * open (or update) a pull request. Six-step sequence with the ref
 * creation as the atomic commit point.
 *
 * Per ADR-0007: PR-state-aware branch resolution (auto-resolve open
 * PR / stale ref / new branch), rate-limit handling matches the
 * inbound primitives, caller-overridable PR metadata, single-skill
 * granularity.
 */

import { GH_API, ghFetch, type RateLimitInfo } from "./github-http.js";

export interface PushPrMeta {
  title?: string;
  body?: string;
}

export interface PushSkillFolderOk {
  ok: true;
  /** Public GitHub URL of the pull request. */
  prUrl: string;
  prNumber: number;
  /**
   * True when an existing open PR was updated with a new commit;
   * false when a new branch + PR were created.
   */
  updated: boolean;
  /** Commit SHA of the new commit pushed to the publish branch. */
  commitSha: string;
}

export type PushSkillFolderResult =
  | PushSkillFolderOk
  | {
      ok: false;
      reason: "rate-limit";
      message: string;
      rateLimit: RateLimitInfo;
    }
  | {
      ok: false;
      reason: "branch-resolution-failed";
      message: string;
    }
  | {
      ok: false;
      reason: "push-failed";
      /** Step (1–6) the sequence aborted at. */
      step: 1 | 2 | 3 | 4 | 5 | 6;
      message: string;
      /**
       * Set when the commit ref was created (step 5 succeeded) but
       * PR creation (step 6) failed. The caller surfaces this URL
       * so the user can open a PR manually from the GitHub UI.
       */
      branchUrl?: string;
    };

export interface PushSkillFolderOptions {
  /** Linked repo `owner/name`. */
  repo: string;
  /** Absolute path of the source folder to push (the skill dir). */
  sourceDir: string;
  /**
   * Path within the linked repo where the skill should land, e.g.
   * `skills/personal/<name>`. Trailing slash optional; canonicalized
   * internally.
   */
  targetPath: string;
  /** Default branch of the linked repo (resolved by the caller). */
  baseBranch: string;
  /**
   * Authenticated GitHub OAuth token. Publish requires auth — there
   * is no unauthenticated write path on GitHub.
   */
  token: string;
  /** Optional PR title + body. Caller is responsible for the copy. */
  prMeta?: PushPrMeta;
}

export async function pushSkillFolder(
  opts: PushSkillFolderOptions,
): Promise<PushSkillFolderResult> {
  const fsMod = await import("node:fs");
  const pathMod = await import("node:path");
  const target = opts.targetPath.replace(/\/+$/, "");
  const branchName = `publish/${pathMod.basename(target)}`;

  // Pre-step — PR-state-aware branch resolution. Find any open PR
  // whose head is publish/<name>; if present, we'll append a commit
  // to that branch rather than create a new ref. If no open PR but
  // the branch exists (stale state from a merged/closed PR), delete
  // the ref before re-creating.
  const ownerSegment = opts.repo.split("/")[0];
  const prsRes = await ghFetch<
    { number: number; html_url: string; head: { sha: string } }[]
  >(
    `${GH_API}/repos/${opts.repo}/pulls?head=${ownerSegment}:${branchName}&state=open`,
    { method: "GET" },
    opts.token,
  );
  if (!prsRes.ok) {
    if (prsRes.status === 429 && prsRes.rateLimit) {
      return {
        ok: false,
        reason: "rate-limit",
        message: prsRes.message,
        rateLimit: prsRes.rateLimit,
      };
    }
    return {
      ok: false,
      reason: "branch-resolution-failed",
      message: prsRes.message,
    };
  }
  const existingPr = prsRes.body[0] ?? null;
  let updateExistingBranch = existingPr !== null;
  let parentSha: string;

  if (existingPr) {
    parentSha = existingPr.head.sha;
  } else {
    // Check whether the branch exists without a PR open against it
    // (stale state). 404 means no branch; 200 means stale.
    const refRes = await ghFetch<{ object: { sha: string } }>(
      `${GH_API}/repos/${opts.repo}/git/refs/heads/${encodeURIComponent(branchName)}`,
      { method: "GET" },
      opts.token,
    );
    if (refRes.ok) {
      // Stale ref — delete and continue with a fresh push.
      const delRes = await ghFetch<unknown>(
        `${GH_API}/repos/${opts.repo}/git/refs/heads/${encodeURIComponent(branchName)}`,
        { method: "DELETE" },
        opts.token,
      );
      if (!delRes.ok) {
        if (delRes.status === 429 && delRes.rateLimit) {
          return {
            ok: false,
            reason: "rate-limit",
            message: delRes.message,
            rateLimit: delRes.rateLimit,
          };
        }
        return {
          ok: false,
          reason: "branch-resolution-failed",
          message: `Stale branch cleanup failed: ${delRes.message}`,
        };
      }
    } else if (refRes.status !== 404) {
      if (refRes.status === 429 && refRes.rateLimit) {
        return {
          ok: false,
          reason: "rate-limit",
          message: refRes.message,
          rateLimit: refRes.rateLimit,
        };
      }
      return {
        ok: false,
        reason: "branch-resolution-failed",
        message: refRes.message,
      };
    }
    // Step 1 — resolve the base branch SHA.
    const baseRes = await ghFetch<{ object: { sha: string } }>(
      `${GH_API}/repos/${opts.repo}/git/refs/heads/${encodeURIComponent(opts.baseBranch)}`,
      { method: "GET" },
      opts.token,
    );
    if (!baseRes.ok) {
      if (baseRes.status === 429 && baseRes.rateLimit) {
        return {
          ok: false,
          reason: "rate-limit",
          message: baseRes.message,
          rateLimit: baseRes.rateLimit,
        };
      }
      return {
        ok: false,
        reason: "push-failed",
        step: 1,
        message: baseRes.message,
      };
    }
    parentSha = baseRes.body.object.sha;
  }

  // Enumerate files in the source dir + read their contents. Walk
  // recursively; skip dot-prefixed sidecars by convention (the
  // app's own .skills-bank.json / .skills-bank-hash files are
  // local-only marker state, never part of what we publish).
  const files: { relPath: string; content: Buffer }[] = [];
  walkSourceFiles(opts.sourceDir, "", files, fsMod, pathMod);

  // Step 2 — upload each file as a blob.
  const blobShas: { path: string; sha: string }[] = [];
  for (const f of files) {
    const blobRes = await ghFetch<{ sha: string }>(
      `${GH_API}/repos/${opts.repo}/git/blobs`,
      {
        method: "POST",
        body: JSON.stringify({
          content: f.content.toString("base64"),
          encoding: "base64",
        }),
        headers: { "Content-Type": "application/json" },
      },
      opts.token,
    );
    if (!blobRes.ok) {
      if (blobRes.status === 429 && blobRes.rateLimit) {
        return {
          ok: false,
          reason: "rate-limit",
          message: blobRes.message,
          rateLimit: blobRes.rateLimit,
        };
      }
      return {
        ok: false,
        reason: "push-failed",
        step: 2,
        message: blobRes.message,
      };
    }
    blobShas.push({
      path: `${target}/${f.relPath}`,
      sha: blobRes.body.sha,
    });
  }

  // Step 3 — create a tree containing the new blobs. Base the tree
  // on the parent commit so paths outside our target prefix stay
  // unchanged.
  const treeRes = await ghFetch<{ sha: string }>(
    `${GH_API}/repos/${opts.repo}/git/trees`,
    {
      method: "POST",
      body: JSON.stringify({
        base_tree: parentSha,
        tree: blobShas.map((b) => ({
          path: b.path,
          mode: "100644",
          type: "blob",
          sha: b.sha,
        })),
      }),
      headers: { "Content-Type": "application/json" },
    },
    opts.token,
  );
  if (!treeRes.ok) {
    if (treeRes.status === 429 && treeRes.rateLimit) {
      return {
        ok: false,
        reason: "rate-limit",
        message: treeRes.message,
        rateLimit: treeRes.rateLimit,
      };
    }
    return {
      ok: false,
      reason: "push-failed",
      step: 3,
      message: treeRes.message,
    };
  }

  // Step 4 — create the commit.
  const commitMessage =
    opts.prMeta?.title ??
    `Publish ${pathMod.basename(target)} from Skills Bank`;
  const commitRes = await ghFetch<{ sha: string }>(
    `${GH_API}/repos/${opts.repo}/git/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        message: commitMessage,
        tree: treeRes.body.sha,
        parents: [parentSha],
      }),
      headers: { "Content-Type": "application/json" },
    },
    opts.token,
  );
  if (!commitRes.ok) {
    if (commitRes.status === 429 && commitRes.rateLimit) {
      return {
        ok: false,
        reason: "rate-limit",
        message: commitRes.message,
        rateLimit: commitRes.rateLimit,
      };
    }
    return {
      ok: false,
      reason: "push-failed",
      step: 4,
      message: commitRes.message,
    };
  }

  // Step 5 — atomic commit point. Either create a new ref or
  // fast-forward the existing one.
  if (updateExistingBranch) {
    const patchRes = await ghFetch<{ object: { sha: string } }>(
      `${GH_API}/repos/${opts.repo}/git/refs/heads/${encodeURIComponent(branchName)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ sha: commitRes.body.sha, force: false }),
        headers: { "Content-Type": "application/json" },
      },
      opts.token,
    );
    if (!patchRes.ok) {
      if (patchRes.status === 429 && patchRes.rateLimit) {
        return {
          ok: false,
          reason: "rate-limit",
          message: patchRes.message,
          rateLimit: patchRes.rateLimit,
        };
      }
      return {
        ok: false,
        reason: "push-failed",
        step: 5,
        message: patchRes.message,
      };
    }
  } else {
    const refRes = await ghFetch<{ ref: string }>(
      `${GH_API}/repos/${opts.repo}/git/refs`,
      {
        method: "POST",
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: commitRes.body.sha,
        }),
        headers: { "Content-Type": "application/json" },
      },
      opts.token,
    );
    if (!refRes.ok) {
      if (refRes.status === 429 && refRes.rateLimit) {
        return {
          ok: false,
          reason: "rate-limit",
          message: refRes.message,
          rateLimit: refRes.rateLimit,
        };
      }
      return {
        ok: false,
        reason: "push-failed",
        step: 5,
        message: refRes.message,
      };
    }
  }

  const branchUrl = `https://github.com/${opts.repo}/tree/${branchName}`;

  // Step 6 — open PR (only when we created a fresh branch; when
  // updating an existing PR's branch, GitHub auto-updates the PR).
  if (updateExistingBranch && existingPr) {
    return {
      ok: true,
      prUrl: existingPr.html_url,
      prNumber: existingPr.number,
      updated: true,
      commitSha: commitRes.body.sha,
    };
  }

  const prRes = await ghFetch<{ html_url: string; number: number }>(
    `${GH_API}/repos/${opts.repo}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({
        title: opts.prMeta?.title ?? commitMessage,
        body: opts.prMeta?.body ?? "",
        head: branchName,
        base: opts.baseBranch,
      }),
      headers: { "Content-Type": "application/json" },
    },
    opts.token,
  );
  if (!prRes.ok) {
    if (prRes.status === 429 && prRes.rateLimit) {
      return {
        ok: false,
        reason: "rate-limit",
        message: prRes.message,
        rateLimit: prRes.rateLimit,
      };
    }
    // ADR-0007 Invariant 1: PR creation is best-effort post-commit.
    // The branch exists; surface its URL so the user can open the
    // PR manually via the GitHub UI.
    return {
      ok: false,
      reason: "push-failed",
      step: 6,
      message: prRes.message,
      branchUrl,
    };
  }

  return {
    ok: true,
    prUrl: prRes.body.html_url,
    prNumber: prRes.body.number,
    updated: false,
    commitSha: commitRes.body.sha,
  };
}

function walkSourceFiles(
  rootDir: string,
  rel: string,
  out: { relPath: string; content: Buffer }[],
  fsMod: typeof import("node:fs"),
  pathMod: typeof import("node:path"),
): void {
  const current = rel === "" ? rootDir : pathMod.join(rootDir, rel);
  const entries = fsMod.readdirSync(current, { withFileTypes: true });
  for (const ent of entries) {
    // Skip the gitignored marker sidecars — they're local-only state.
    if (ent.name.startsWith(".")) continue;
    const childRel = rel === "" ? ent.name : pathMod.posix.join(rel, ent.name);
    if (ent.isDirectory()) {
      walkSourceFiles(rootDir, childRel, out, fsMod, pathMod);
    } else if (ent.isFile()) {
      const content = fsMod.readFileSync(pathMod.join(current, ent.name));
      out.push({ relPath: childRel, content });
    }
  }
}
