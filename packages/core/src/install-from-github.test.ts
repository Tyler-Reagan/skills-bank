import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installSkillFromGithub } from "./install-from-github.js";
import { hashSkillFolder } from "./heal.js";

/**
 * Phase 4 contract: installSkillFromGithub composes mirrorSkillFolder
 * + readSkillMeta + writeSkillSource. Each test stubs `fetch` to
 * drive the upstream half deterministically (same pattern as
 * upstream.test.ts).
 */

let scratch: string;
let registryRoot: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-install-"));
  registryRoot = path.join(scratch, "registry");
  fs.mkdirSync(path.join(registryRoot, "skills", "personal"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(registryRoot, "skills", "vendored"), {
    recursive: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(scratch, { recursive: true, force: true });
});

function treeResponse(folder: string, files: string[]): Response {
  const tree = [
    { path: folder, mode: "040000", type: "tree", sha: "foldersha" },
    ...files.map((f, i) => ({
      path: `${folder}/${f}`,
      mode: "100644",
      type: "blob",
      sha: `blob${i + 1}`,
    })),
  ];
  return new Response(
    JSON.stringify({ sha: "rootsha", tree, truncated: false }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

function blobResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      encoding: "base64",
      content: Buffer.from(content).toString("base64"),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("installSkillFromGithub", () => {
  test("success: mirrors + stamps marker + baselines hash", async () => {
    const skillMdContent =
      "---\nname: alpha\ndescription: test\n---\n# alpha\n";
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) return treeResponse("skills/alpha", ["SKILL.md"]);
        if (call === 2) return blobResponse(skillMdContent);
        throw new Error(`unexpected call #${call}`);
      }),
    );

    const r = await installSkillFromGithub({
      registryRoot,
      repo: "owner/repo",
      skillPath: "skills/alpha/SKILL.md",
      token: null,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe("alpha");
    expect(r.bucket).toBe("personal");
    expect(r.folderHash).toBe("foldersha");

    const destDir = path.join(registryRoot, "skills", "personal", "alpha");
    expect(fs.existsSync(path.join(destDir, "SKILL.md"))).toBe(true);
    expect(fs.readFileSync(path.join(destDir, "SKILL.md"), "utf8")).toBe(
      skillMdContent,
    );
    const marker = JSON.parse(
      fs.readFileSync(path.join(destDir, ".skills-bank.json"), "utf8"),
    ) as {
      source: string;
      origin: { repo: string; skillPath: string; skillFolderHash: string };
    };
    expect(marker.source).toBe("user");
    expect(marker.origin.repo).toBe("owner/repo");
    expect(marker.origin.skillPath).toBe("skills/alpha/SKILL.md");
    expect(marker.origin.skillFolderHash).toBe("foldersha");
    // Synced-hash sidecar baselined with the local SHA-256 (not the
    // GitHub tree SHA-1), matching the manifest-import baseline path.
    const expectedLocalHash = hashSkillFolder(destDir);
    expect(expectedLocalHash).not.toBeNull();
    expect(
      fs.readFileSync(path.join(destDir, ".skills-bank-hash"), "utf8").trim(),
    ).toBe(expectedLocalHash);
  });

  test("bucket: vendored writes source: 'curated'", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) return treeResponse("beta", ["SKILL.md"]);
        if (call === 2)
          return blobResponse("---\nname: beta\ndescription: x\n---\n# beta");
        throw new Error(`unexpected call #${call}`);
      }),
    );

    const r = await installSkillFromGithub({
      registryRoot,
      repo: "owner/repo",
      skillPath: "beta/SKILL.md",
      bucket: "vendored",
      token: null,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bucket).toBe("vendored");
    const marker = JSON.parse(
      fs.readFileSync(
        path.join(
          registryRoot,
          "skills",
          "vendored",
          "beta",
          ".skills-bank.json",
        ),
        "utf8",
      ),
    ) as { source: string };
    expect(marker.source).toBe("curated");
  });

  test("name-collision before fetch: refuses, no mirror attempted", async () => {
    // Pre-existing skill in personal/.
    fs.mkdirSync(path.join(registryRoot, "skills", "personal", "alpha"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(registryRoot, "skills", "personal", "alpha", "SKILL.md"),
      "# pre-existing",
    );
    fs.writeFileSync(
      path.join(registryRoot, "skills", "personal", "alpha", "meta.json"),
      JSON.stringify({ name: "alpha", description: "pre" }),
    );

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const r = await installSkillFromGithub({
      registryRoot,
      repo: "owner/repo",
      skillPath: "skills/alpha/SKILL.md",
      token: null,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("name-collision");
    if (r.reason !== "name-collision") return;
    expect(r.name).toBe("alpha");
    expect(r.existingBucket).toBe("personal");
    // Pre-flight check fires before any network call.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("no-skill-md: mirror succeeds but content has no SKILL.md/meta.json, cleans up", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        // Tree has a single file that ISN'T SKILL.md or meta.json.
        if (call === 1) return treeResponse("skills/alpha", ["README.md"]);
        if (call === 2) return blobResponse("# readme but no skill");
        throw new Error(`unexpected call #${call}`);
      }),
    );

    const r = await installSkillFromGithub({
      registryRoot,
      repo: "owner/repo",
      skillPath: "skills/alpha/SKILL.md",
      token: null,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("no-skill-md");
    // Cleanup: the dir we just wrote got removed.
    expect(
      fs.existsSync(path.join(registryRoot, "skills", "personal", "alpha")),
    ).toBe(false);
  });

  test("mirror-failed: 404 surfaces as mirror-failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(`{"message":"Not Found"}`, {
          status: 404,
          statusText: "Not Found",
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const r = await installSkillFromGithub({
      registryRoot,
      repo: "owner/missing",
      skillPath: "skills/x/SKILL.md",
      token: null,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("mirror-failed");
  });

  test("rate-limit: surfaces with rateLimit payload populated", async () => {
    const resetAt = Math.floor(Date.now() / 1000) + 60;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(`{"message":"Rate limit"}`, {
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-limit": "60",
            "x-ratelimit-reset": String(resetAt),
          },
        });
      }),
    );

    const r = await installSkillFromGithub({
      registryRoot,
      repo: "owner/repo",
      skillPath: "skills/x/SKILL.md",
      token: null,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("mirror-failed");
    if (r.reason !== "mirror-failed") return;
    expect(r.rateLimit).toBeDefined();
    expect(r.rateLimit?.limit).toBe(60);
  });

  test("canonical-name rename: frontmatter name differs from folder basename", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) return treeResponse("skills/folder-name", ["SKILL.md"]);
        if (call === 2)
          return blobResponse(
            "---\nname: canonical-name\ndescription: x\n---\n# x\n",
          );
        throw new Error(`unexpected call #${call}`);
      }),
    );

    const r = await installSkillFromGithub({
      registryRoot,
      repo: "owner/repo",
      skillPath: "skills/folder-name/SKILL.md",
      token: null,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe("canonical-name");
    // Directory renamed.
    expect(
      fs.existsSync(
        path.join(registryRoot, "skills", "personal", "canonical-name"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(registryRoot, "skills", "personal", "folder-name"),
      ),
    ).toBe(false);
  });
});
