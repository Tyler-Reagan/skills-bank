import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installSkillFiles, resolveSkillFolderByName } from "./origin.js";

/**
 * Pins the "no partial mutation" contract for `installSkillFiles`
 * (ADR-0001 Suite 4). Update relies on it: if a blob fetch fails
 * after the wipe began, the user is left with a torn skill folder
 * and no way to recover from the UI. The implementation fetches
 * every blob into memory FIRST and only touches disk after every
 * fetch resolves — these tests are the contract.
 *
 * The failure-path tests pre-seed destDir with a sentinel, which
 * would trip the idempotency guard (non-empty destDir → early
 * ok-skip), so they pass `force: true` to exercise the fetch path —
 * the same way applySkillUpdate calls it. The guard itself is
 * pinned by its own test at the bottom.
 */

const REPO = "owner/repo";
const FOLDER = "skills/test";
const BLOB_PATHS = [`${FOLDER}/SKILL.md`, `${FOLDER}/meta.json`];

function makeTreeResponse(): Response {
  const body = JSON.stringify({
    sha: "rootsha",
    tree: [
      { path: FOLDER, mode: "040000", type: "tree", sha: "foldersha" },
      {
        path: `${FOLDER}/SKILL.md`,
        mode: "100644",
        type: "blob",
        sha: "blob1",
      },
      {
        path: `${FOLDER}/meta.json`,
        mode: "100644",
        type: "blob",
        sha: "blob2",
      },
    ],
    truncated: false,
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeBlobResponse(content: string): Response {
  const body = JSON.stringify({
    encoding: "base64",
    content: Buffer.from(content).toString("base64"),
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function make404(): Response {
  return new Response(`{"message":"Not Found"}`, {
    status: 404,
    statusText: "Not Found",
    headers: { "content-type": "application/json" },
  });
}

let scratch: string;
let destDir: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-mirror-"));
  destDir = path.join(scratch, "dest");
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("installSkillFiles — partial-failure invariant", () => {
  test("success path writes every blob + reports folderHash", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) return makeTreeResponse();
        if (call === 2) return makeBlobResponse("# hello");
        if (call === 3) return makeBlobResponse(`{"name":"test"}`);
        throw new Error("unexpected call");
      }),
    );

    const result = await installSkillFiles(REPO, FOLDER, destDir, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.folderHash).toBe("foldersha");
    expect(result.fileCount).toBe(2);

    expect(fs.readFileSync(path.join(destDir, "SKILL.md"), "utf8")).toBe(
      "# hello",
    );
    expect(fs.readFileSync(path.join(destDir, "meta.json"), "utf8")).toBe(
      `{"name":"test"}`,
    );
  });

  test("last-blob failure leaves destDir untouched", async () => {
    // Pre-seed destDir with a sentinel. If the wipe ran, this disappears.
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, "preexisting.txt"), "do not delete");

    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) return makeTreeResponse();
        if (call === 2) return makeBlobResponse("# fetched fine");
        if (call === 3) return make404(); // last blob fails
        throw new Error("unexpected call");
      }),
    );

    const result = await installSkillFiles(REPO, FOLDER, destDir, null, {
      force: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
    expect(result.message).toContain(BLOB_PATHS[1]!);

    // The sentinel must still be there — no disk mutation on failure.
    expect(fs.readFileSync(path.join(destDir, "preexisting.txt"), "utf8")).toBe(
      "do not delete",
    );
    // And the successful-fetched first blob must NOT have been written.
    expect(fs.existsSync(path.join(destDir, "SKILL.md"))).toBe(false);
  });

  test("transport error mid-loop leaves destDir untouched", async () => {
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, "sentinel"), "x");

    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) return makeTreeResponse();
        if (call === 2) return makeBlobResponse("# fine");
        if (call === 3) throw new TypeError("network down");
        throw new Error("unexpected");
      }),
    );

    const result = await installSkillFiles(REPO, FOLDER, destDir, null, {
      force: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(0);
    expect(result.message).toMatch(/transport error/i);

    expect(fs.readFileSync(path.join(destDir, "sentinel"), "utf8")).toBe("x");
    expect(fs.existsSync(path.join(destDir, "SKILL.md"))).toBe(false);
  });

  test("tree probe failure short-circuits before any blob fetch", async () => {
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, "sentinel"), "x");

    const fetchMock = vi.fn(async () => make404());
    vi.stubGlobal("fetch", fetchMock);

    const result = await installSkillFiles(REPO, FOLDER, destDir, null, {
      force: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
    // Only the tree probe ran — no blob fetches attempted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(path.join(destDir, "sentinel"), "utf8")).toBe("x");
  });

  test("missing folder in tree → no mutation", async () => {
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, "sentinel"), "x");

    // Tree exists but doesn't carry the requested folder.
    const emptyTree = new Response(
      JSON.stringify({ sha: "x", tree: [], truncated: false }),
      { status: 200 },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => emptyTree),
    );

    const result = await installSkillFiles(REPO, FOLDER, destDir, null, {
      force: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
    expect(fs.readFileSync(path.join(destDir, "sentinel"), "utf8")).toBe("x");
  });

  test("truncated tree → refuse to mirror", async () => {
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, "sentinel"), "x");

    const truncated = new Response(
      JSON.stringify({
        sha: "x",
        tree: [
          { path: FOLDER, mode: "040000", type: "tree", sha: "foldersha" },
          {
            path: `${FOLDER}/SKILL.md`,
            mode: "100644",
            type: "blob",
            sha: "blob1",
          },
        ],
        truncated: true,
      }),
      { status: 200 },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => truncated),
    );

    const result = await installSkillFiles(REPO, FOLDER, destDir, null, {
      force: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/truncated/);
    expect(fs.readFileSync(path.join(destDir, "sentinel"), "utf8")).toBe("x");
  });

  test("idempotency guard: non-empty destDir skips without any fetch", async () => {
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, "SKILL.md"), "# already here");

    const fetchMock = vi.fn(async () => {
      throw new Error("must not fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await installSkillFiles(REPO, FOLDER, destDir, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.folderHash).toBe("");
    expect(result.fileCount).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(destDir, "SKILL.md"), "utf8")).toBe(
      "# already here",
    );
  });

  test("does not write .skills-bank.json / .skills-bank-hash sidecars", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) return makeTreeResponse();
        if (call === 2) return makeBlobResponse("# hello");
        if (call === 3) return makeBlobResponse("{}");
        throw new Error("unexpected");
      }),
    );

    const result = await installSkillFiles(REPO, FOLDER, destDir, null);
    expect(result.ok).toBe(true);
    // The mirror primitive doesn't manage sidecars — callers do.
    // Tests pin this so a "convenience" addition that stamps markers
    // here breaks the contract immediately.
    expect(fs.existsSync(path.join(destDir, ".skills-bank.json"))).toBe(false);
    expect(fs.existsSync(path.join(destDir, ".skills-bank-hash"))).toBe(false);
  });
});

/**
 * resolveSkillFolderByName is the tree-search behind pasting an
 * `npx skills add … --skill <name>` command: it finds a skill by name
 * wherever it lives in the repo, so a nested category folder resolves
 * instead of 404-ing on a naive `skills/<name>` guess.
 */
function treeResponse(blobPaths: string[]): Response {
  const tree = blobPaths.map((p) => ({
    path: p,
    mode: "100644",
    type: "blob",
    sha: `sha-${p}`,
  }));
  return new Response(
    JSON.stringify({ sha: "rootsha", tree, truncated: false }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("resolveSkillFolderByName", () => {
  test("resolves a skill nested under a category folder", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        treeResponse([
          "skills/engineering/wayfinder/SKILL.md",
          "skills/writing/prose/SKILL.md",
          "README.md",
        ]),
      ),
    );
    const r = await resolveSkillFolderByName("owner/repo", "wayfinder", null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skillPath).toBe("skills/engineering/wayfinder/SKILL.md");
  });

  test("no match → not-found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => treeResponse(["skills/other/SKILL.md"])),
    );
    const r = await resolveSkillFolderByName("owner/repo", "wayfinder", null);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("not-found");
    expect(r.message).toContain("wayfinder");
  });

  test("multiple matches → ambiguous with candidate folders", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        treeResponse([
          "skills/engineering/wayfinder/SKILL.md",
          "skills/legacy/wayfinder/SKILL.md",
        ]),
      ),
    );
    const r = await resolveSkillFolderByName("owner/repo", "wayfinder", null);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("ambiguous");
    expect(r.candidates).toEqual([
      "skills/engineering/wayfinder",
      "skills/legacy/wayfinder",
    ]);
  });

  test("tree fetch failure → tree-error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => make404()),
    );
    const r = await resolveSkillFolderByName("owner/repo", "wayfinder", null);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("tree-error");
  });
});
