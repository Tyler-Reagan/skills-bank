import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { publishSkillFolder } from "./publish-push.js";

/**
 * Suite 7 per ADR-0007 — publishSkillFolder invariants. Each test
 * stubs `fetch` to drive a specific failure mode through the 6-step
 * sequence, then asserts the resulting reason / step / branchUrl
 * shape.
 */

let scratch: string;
let sourceDir: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-push-"));
  sourceDir = path.join(scratch, "alpha");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "SKILL.md"), "# alpha");
  fs.writeFileSync(
    path.join(sourceDir, "meta.json"),
    JSON.stringify({ name: "alpha", description: "test" }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(scratch, { recursive: true, force: true });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(
  status: number,
  message = "Not Found",
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    statusText: message,
    headers: { "content-type": "application/json", ...headers },
  });
}

function rateLimitResponse(): Response {
  const reset = Math.floor(Date.now() / 1000) + 60;
  return new Response(JSON.stringify({ message: "Rate limit" }), {
    status: 403,
    headers: {
      "content-type": "application/json",
      "x-ratelimit-remaining": "0",
      "x-ratelimit-limit": "5000",
      "x-ratelimit-reset": String(reset),
    },
  });
}

describe("publishSkillFolder (Suite 7)", () => {
  test("happy path: new branch + new PR", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n++;
        // 1: list open PRs (empty)
        if (n === 1) return jsonResponse([]);
        // 2: check existing ref (404 — no stale)
        if (n === 2) return errorResponse(404);
        // 3: resolve base SHA
        if (n === 3) return jsonResponse({ object: { sha: "baseSha" } });
        // 4: upload blob 1 (SKILL.md)
        if (n === 4) return jsonResponse({ sha: "blob1" });
        // 5: upload blob 2 (meta.json)
        if (n === 5) return jsonResponse({ sha: "blob2" });
        // 6: create tree
        if (n === 6) return jsonResponse({ sha: "treeSha" });
        // 7: create commit
        if (n === 7) return jsonResponse({ sha: "commitSha" });
        // 8: create ref (commit point)
        if (n === 8) return jsonResponse({ ref: "refs/heads/publish/alpha" });
        // 9: open PR
        if (n === 9)
          return jsonResponse({
            number: 42,
            html_url: "https://github.com/u/r/pull/42",
          });
        throw new Error(`unexpected call #${n}`);
      }),
    );

    const r = await publishSkillFolder({
      repo: "u/r",
      sourceDir,
      targetPath: "skills/personal/alpha",
      baseBranch: "main",
      token: "tok",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.prNumber).toBe(42);
    expect(r.updated).toBe(false);
    expect(r.commitSha).toBe("commitSha");
  });

  test("open PR exists: appends commit, does not create new ref or PR", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n++;
        if (n === 1)
          return jsonResponse([
            {
              number: 7,
              html_url: "https://github.com/u/r/pull/7",
              head: { sha: "headSha" },
            },
          ]);
        // 2: upload blob 1
        if (n === 2) return jsonResponse({ sha: "blob1" });
        // 3: upload blob 2
        if (n === 3) return jsonResponse({ sha: "blob2" });
        // 4: tree
        if (n === 4) return jsonResponse({ sha: "treeSha" });
        // 5: commit
        if (n === 5) return jsonResponse({ sha: "commitSha2" });
        // 6: patch ref (atomic update)
        if (n === 6) return jsonResponse({ object: { sha: "commitSha2" } });
        throw new Error(`unexpected call #${n}`);
      }),
    );

    const r = await publishSkillFolder({
      repo: "u/r",
      sourceDir,
      targetPath: "skills/personal/alpha",
      baseBranch: "main",
      token: "tok",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.updated).toBe(true);
    expect(r.prNumber).toBe(7);
  });

  test("stale ref (no open PR but branch exists): deletes then re-pushes", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n++;
        if (n === 1) return jsonResponse([]); // no open PR
        if (n === 2) return jsonResponse({ object: { sha: "staleSha" } }); // ref exists
        if (n === 3) return jsonResponse({}); // delete ref
        if (n === 4) return jsonResponse({ object: { sha: "baseSha" } });
        if (n === 5) return jsonResponse({ sha: "blob1" });
        if (n === 6) return jsonResponse({ sha: "blob2" });
        if (n === 7) return jsonResponse({ sha: "treeSha" });
        if (n === 8) return jsonResponse({ sha: "commitSha" });
        if (n === 9) return jsonResponse({ ref: "refs/heads/publish/alpha" });
        if (n === 10)
          return jsonResponse({
            number: 8,
            html_url: "https://github.com/u/r/pull/8",
          });
        throw new Error(`unexpected call #${n}`);
      }),
    );

    const r = await publishSkillFolder({
      repo: "u/r",
      sourceDir,
      targetPath: "skills/personal/alpha",
      baseBranch: "main",
      token: "tok",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.updated).toBe(false);
    expect(r.prNumber).toBe(8);
  });

  test("blob upload failure (step 2): no ref created", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n++;
        if (n === 1) return jsonResponse([]);
        if (n === 2) return errorResponse(404);
        if (n === 3) return jsonResponse({ object: { sha: "baseSha" } });
        if (n === 4) return errorResponse(500, "blob upload failed");
        throw new Error(`unexpected call #${n}`);
      }),
    );

    const r = await publishSkillFolder({
      repo: "u/r",
      sourceDir,
      targetPath: "skills/personal/alpha",
      baseBranch: "main",
      token: "tok",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("push-failed");
    if (r.reason !== "push-failed") return;
    expect(r.step).toBe(2);
  });

  test("ref creation failure (step 5): structured push-failed step=5", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n++;
        if (n === 1) return jsonResponse([]);
        if (n === 2) return errorResponse(404);
        if (n === 3) return jsonResponse({ object: { sha: "baseSha" } });
        if (n === 4) return jsonResponse({ sha: "blob1" });
        if (n === 5) return jsonResponse({ sha: "blob2" });
        if (n === 6) return jsonResponse({ sha: "treeSha" });
        if (n === 7) return jsonResponse({ sha: "commitSha" });
        if (n === 8) return errorResponse(422, "ref creation failed");
        throw new Error(`unexpected call #${n}`);
      }),
    );

    const r = await publishSkillFolder({
      repo: "u/r",
      sourceDir,
      targetPath: "skills/personal/alpha",
      baseBranch: "main",
      token: "tok",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("push-failed");
    if (r.reason !== "push-failed") return;
    expect(r.step).toBe(5);
  });

  test("PR creation failure (step 6): branchUrl surfaced; no rollback", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n++;
        if (n === 1) return jsonResponse([]);
        if (n === 2) return errorResponse(404);
        if (n === 3) return jsonResponse({ object: { sha: "baseSha" } });
        if (n === 4) return jsonResponse({ sha: "blob1" });
        if (n === 5) return jsonResponse({ sha: "blob2" });
        if (n === 6) return jsonResponse({ sha: "treeSha" });
        if (n === 7) return jsonResponse({ sha: "commitSha" });
        if (n === 8) return jsonResponse({ ref: "refs/heads/publish/alpha" });
        if (n === 9) return errorResponse(500, "PR creation failed");
        throw new Error(`unexpected call #${n}`);
      }),
    );

    const r = await publishSkillFolder({
      repo: "u/r",
      sourceDir,
      targetPath: "skills/personal/alpha",
      baseBranch: "main",
      token: "tok",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("push-failed");
    if (r.reason !== "push-failed") return;
    expect(r.step).toBe(6);
    expect(r.branchUrl).toBe("https://github.com/u/r/tree/publish/alpha");
  });

  test("rate-limit mid-sequence: RateLimitErr with no further calls", async () => {
    let n = 0;
    const spy = vi.fn(async () => {
      n++;
      if (n === 1) return jsonResponse([]);
      if (n === 2) return errorResponse(404);
      if (n === 3) return jsonResponse({ object: { sha: "baseSha" } });
      if (n === 4) return rateLimitResponse(); // first blob hits rate limit
      throw new Error(`unexpected call #${n}`);
    });
    vi.stubGlobal("fetch", spy);

    const r = await publishSkillFolder({
      repo: "u/r",
      sourceDir,
      targetPath: "skills/personal/alpha",
      baseBranch: "main",
      token: "tok",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("rate-limit");
    if (r.reason !== "rate-limit") return;
    expect(r.rateLimit.limit).toBe(5000);
    // No further calls after the rate-limit response.
    expect(spy).toHaveBeenCalledTimes(4);
  });

  test("dot-prefixed files (.skills-bank.json, .skills-bank-hash) excluded from push", async () => {
    // Add sidecar files to the source dir; they should NOT be
    // uploaded as blobs.
    fs.writeFileSync(
      path.join(sourceDir, ".skills-bank.json"),
      JSON.stringify({ source: "user" }),
    );
    fs.writeFileSync(path.join(sourceDir, ".skills-bank-hash"), "abc\n");

    let n = 0;
    const spy = vi.fn(async () => {
      n++;
      if (n === 1) return jsonResponse([]);
      if (n === 2) return errorResponse(404);
      if (n === 3) return jsonResponse({ object: { sha: "baseSha" } });
      if (n === 4) return jsonResponse({ sha: "blob1" }); // SKILL.md
      if (n === 5) return jsonResponse({ sha: "blob2" }); // meta.json
      // If a 3rd blob upload happens, the sidecars leaked through.
      if (n === 6) return jsonResponse({ sha: "treeSha" });
      if (n === 7) return jsonResponse({ sha: "commitSha" });
      if (n === 8) return jsonResponse({ ref: "refs/heads/publish/alpha" });
      if (n === 9)
        return jsonResponse({
          number: 1,
          html_url: "https://github.com/u/r/pull/1",
        });
      throw new Error(`unexpected call #${n}`);
    });
    vi.stubGlobal("fetch", spy);

    const r = await publishSkillFolder({
      repo: "u/r",
      sourceDir,
      targetPath: "skills/personal/alpha",
      baseBranch: "main",
      token: "tok",
    });
    expect(r.ok).toBe(true);
    // Total of 9 calls = 2 blobs + 7 other API calls. A leaked sidecar
    // would push this to 10+.
    expect(spy).toHaveBeenCalledTimes(9);
  });
});
