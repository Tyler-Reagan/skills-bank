import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  computePublishStatesFromGit,
  computePublishStatesFromRemote,
  detectPublishStateMode,
} from "./publish-state.js";

/**
 * Suite 8 per ADR-0008 — publish-state dual-mode invariants. The
 * git path is fixture-driven (real `git init` + commits in a tmp
 * dir, matching heal.test.ts pattern); the remote path stubs
 * `fetch` for the `probeOriginTree` call.
 */

let scratch: string;
let registryRoot: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-pubstate-"));
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

function writeSkill(
  bucket: "personal" | "vendored",
  name: string,
  content = `# ${name}\n`,
): string {
  const dir = path.join(registryRoot, "skills", bucket, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), content);
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify({ name, description: "test" }),
  );
  return dir;
}

// ─── computePublishStatesFromRemote (no fixtures; mocked fetch) ─────

function treeResponse(
  entries: Array<{ path: string; type: "tree" | "blob"; sha: string }>,
  truncated = false,
): Response {
  return new Response(
    JSON.stringify({
      sha: "rootsha",
      tree: entries.map((e) => ({
        path: e.path,
        mode: e.type === "tree" ? "040000" : "100644",
        type: e.type,
        sha: e.sha,
      })),
      truncated,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("computePublishStatesFromRemote", () => {
  test("local hash matches remote folder hash → pushed", async () => {
    writeSkill("vendored", "alpha");
    // Pre-compute the local hash so we mirror it back from the
    // probe. The test isn't comparing values; it's pinning the
    // pushed/draft branching on equality.
    const { hashSkillFolder } = await import("./heal.js");
    const local = hashSkillFolder(
      path.join(registryRoot, "skills", "vendored", "alpha"),
    )!;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        treeResponse([
          { path: "skills/vendored/alpha", type: "tree", sha: local },
        ]),
      ),
    );

    const r = await computePublishStatesFromRemote({
      registryRoot,
      repo: "u/r",
      token: null,
    });
    expect(r.states.get("alpha")).toBe("pushed");
  });

  test("folder absent on remote → draft", async () => {
    writeSkill("vendored", "beta");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => treeResponse([])),
    );
    const r = await computePublishStatesFromRemote({
      registryRoot,
      repo: "u/r",
      token: null,
    });
    expect(r.states.get("beta")).toBe("draft");
  });

  test("local hash differs from remote → draft", async () => {
    writeSkill("vendored", "gamma");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        treeResponse([
          { path: "skills/vendored/gamma", type: "tree", sha: "different" },
        ]),
      ),
    );
    const r = await computePublishStatesFromRemote({
      registryRoot,
      repo: "u/r",
      token: null,
    });
    expect(r.states.get("gamma")).toBe("draft");
  });

  test("truncated tree → all unknown + truncated flag set", async () => {
    writeSkill("vendored", "delta");
    writeSkill("personal", "epsilon");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        treeResponse(
          [
            {
              path: "skills/vendored/delta",
              type: "tree",
              sha: "anything",
            },
          ],
          true, // truncated!
        ),
      ),
    );
    const r = await computePublishStatesFromRemote({
      registryRoot,
      repo: "u/r",
      token: null,
    });
    expect(r.truncated).toBe(true);
    expect(r.states.get("delta")).toBe("unknown");
    expect(r.states.get("epsilon")).toBe("unknown");
  });

  test("404 from probe → all unknown (no exception)", async () => {
    writeSkill("vendored", "zeta");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(`{"message":"Not Found"}`, {
            status: 404,
            statusText: "Not Found",
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const r = await computePublishStatesFromRemote({
      registryRoot,
      repo: "u/r",
      token: null,
    });
    expect(r.states.get("zeta")).toBe("unknown");
  });

  test("rate-limit from probe → all unknown + rateLimit populated", async () => {
    writeSkill("vendored", "eta");
    const reset = Math.floor(Date.now() / 1000) + 60;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(`{"message":"Rate limit"}`, {
            status: 403,
            headers: {
              "content-type": "application/json",
              "x-ratelimit-remaining": "0",
              "x-ratelimit-limit": "60",
              "x-ratelimit-reset": String(reset),
            },
          }),
      ),
    );
    const r = await computePublishStatesFromRemote({
      registryRoot,
      repo: "u/r",
      token: null,
    });
    expect(r.rateLimit).toBeDefined();
    expect(r.rateLimit?.limit).toBe(60);
    expect(r.states.get("eta")).toBe("unknown");
  });

  test("empty registry → empty states map (no probe)", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const r = await computePublishStatesFromRemote({
      registryRoot,
      repo: "u/r",
      token: null,
    });
    expect(r.states.size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ─── detectPublishStateMode ─────────────────────────────────────────

describe("detectPublishStateMode", () => {
  test("linkedRepo present → remote mode (wins over local git)", () => {
    // Even if the registry IS a git working tree, having a linked
    // repo means the user cares about "is this on my linked repo?"
    // — the local git tree's upstream is irrelevant in that case.
    fs.mkdirSync(path.join(registryRoot, ".git"), { recursive: true });
    const r = detectPublishStateMode(registryRoot, {
      linkedRepo: { fullName: "u/r" },
      token: "tok",
    });
    expect(r).toEqual({ kind: "remote", repo: "u/r", token: "tok" });
  });

  test("no linked repo + git working tree → git mode", () => {
    fs.mkdirSync(path.join(registryRoot, ".git"), { recursive: true });
    const r = detectPublishStateMode(registryRoot, {
      linkedRepo: null,
      token: null,
    });
    expect(r?.kind).toBe("git");
  });

  test("no linked repo + no git → null", () => {
    const r = detectPublishStateMode(registryRoot, {
      linkedRepo: null,
      token: null,
    });
    expect(r).toBeNull();
  });

  test("linkedRepo with null token → remote mode with null token", () => {
    const r = detectPublishStateMode(registryRoot, {
      linkedRepo: { fullName: "u/r" },
      token: null,
    });
    expect(r).toEqual({ kind: "remote", repo: "u/r", token: null });
  });
});
