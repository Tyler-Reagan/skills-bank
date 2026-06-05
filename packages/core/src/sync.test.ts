import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyCanonicalSync } from "./sync.js";
import { readSkillSource, writeSkillSource } from "./source.js";
import { hashSkillFolder, writeSyncedHash } from "./heal.js";

/**
 * applyCanonicalSync's conflict-resolution branches + the meta.json
 * tag-preservation splice (ADR-0001 Suite 2), updated for the Phase 1
 * scope expansion: source-side discovery is by file convention,
 * `mountTo` controls which local bucket each skill lands in, and
 * per-skill `upstream` survives across the sync stamp.
 *
 * Branches under test:
 *   1. No-collision upsert (canonical skill not present locally).
 *   2. bundled → bundled overwrite (local copy stamped bundled,
 *      overwritten with the new canonical).
 *   3. yours collision + decision = keep-mine.
 *   4. yours collision + decision = use-canonical.
 *   5. yours collision + decision = rename-mine.
 *
 * Plus: orphan reporting (no auto-delete), tag preservation,
 * upstream preservation across the stamp, mountTo routing, and
 * flat-rooted source discovery.
 */

let scratch: string;
let registryRoot: string;
let canonicalRoot: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-sync-"));
  registryRoot = path.join(scratch, "registry");
  canonicalRoot = path.join(scratch, "extracted");
  fs.mkdirSync(path.join(registryRoot, "skills", "vendored"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(registryRoot, "skills", "personal"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(canonicalRoot, "skills"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function writeCanonical(
  name: string,
  files: Record<string, string>,
  opts: { bucket?: "personal" | "vendored"; flat?: boolean } = {},
): void {
  const prefix = opts.flat
    ? "" // <root>/<name>/
    : opts.bucket
      ? path.join("skills", opts.bucket)
      : "skills";
  const dir = path.join(canonicalRoot, prefix, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

function writeLocal(
  bucket: "personal" | "vendored",
  name: string,
  files: Record<string, string>,
  source: Parameters<typeof writeSkillSource>[1] | null,
): void {
  const dir = path.join(registryRoot, "skills", bucket, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  if (source !== null) writeSkillSource(dir, source);
}

function readLocal(
  bucket: "personal" | "vendored",
  name: string,
  rel: string,
): string | null {
  const p = path.join(registryRoot, "skills", bucket, name, rel);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

describe("applyCanonicalSync (mountTo: vendored — default)", () => {
  test("Branch 1: no-collision upsert writes canonical + stamps vendored", async () => {
    writeCanonical("alpha", { "SKILL.md": "# canonical alpha" });

    const report = await applyCanonicalSync(registryRoot, canonicalRoot, "abc");
    expect(report.upserted).toEqual(["alpha"]);
    expect(report.conflicts).toEqual([]);
    expect(report.resolved).toEqual([]);
    expect(readLocal("vendored", "alpha", "SKILL.md")).toBe(
      "# canonical alpha",
    );

    // New skills never get "curated" from a sync — that designation is
    // reserved for committed .skills-bank.json files.
    const src = readSkillSource(
      path.join(registryRoot, "skills", "vendored", "alpha"),
    );
    expect(src.source).toBe("vendored");
    expect(src.syncedFromCommit).toBe("abc");
  });

  test("Branch 2: bundled → bundled overwrite replaces content + re-stamps commit", async () => {
    writeLocal(
      "vendored",
      "beta",
      { "SKILL.md": "# old canonical beta" },
      { source: "curated", syncedFromCommit: "old-sha" },
    );
    writeCanonical("beta", { "SKILL.md": "# new canonical beta" });

    const report = await applyCanonicalSync(
      registryRoot,
      canonicalRoot,
      "new-sha",
    );
    expect(report.upserted).toEqual(["beta"]);
    expect(readLocal("vendored", "beta", "SKILL.md")).toBe(
      "# new canonical beta",
    );

    const src = readSkillSource(
      path.join(registryRoot, "skills", "vendored", "beta"),
    );
    expect(src.syncedFromCommit).toBe("new-sha");
  });

  test("Conflict surfacing: yours collision with no decision is queued", async () => {
    writeLocal(
      "vendored",
      "gamma",
      { "SKILL.md": "# my edited gamma" },
      { source: "user" },
    );
    writeCanonical("gamma", { "SKILL.md": "# canonical gamma" });

    const report = await applyCanonicalSync(registryRoot, canonicalRoot, "sha");
    expect(report.upserted).toEqual([]);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]!.name).toBe("gamma");
    expect(readLocal("vendored", "gamma", "SKILL.md")).toBe(
      "# my edited gamma",
    );
  });

  test("Branch 3: keep-mine skips canonical write + logs resolved", async () => {
    writeLocal(
      "vendored",
      "delta",
      { "SKILL.md": "# my delta" },
      { source: "user" },
    );
    writeCanonical("delta", { "SKILL.md": "# canonical delta" });

    const report = await applyCanonicalSync(
      registryRoot,
      canonicalRoot,
      "sha",
      { delta: { action: "keep-mine", decidedAt: "2026-05-18T00:00:00Z" } },
    );
    expect(report.upserted).toEqual([]);
    expect(report.resolved).toEqual([{ name: "delta", action: "keep-mine" }]);
    expect(readLocal("vendored", "delta", "SKILL.md")).toBe("# my delta");
  });

  test("Branch 4: use-canonical overwrites + logs resolved", async () => {
    writeLocal(
      "vendored",
      "epsilon",
      { "SKILL.md": "# my epsilon" },
      { source: "user" },
    );
    writeCanonical("epsilon", { "SKILL.md": "# canonical epsilon" });

    const report = await applyCanonicalSync(
      registryRoot,
      canonicalRoot,
      "sha",
      {
        epsilon: { action: "use-canonical", decidedAt: "2026-05-18T00:00:00Z" },
      },
    );
    expect(report.upserted).toEqual(["epsilon"]);
    expect(readLocal("vendored", "epsilon", "SKILL.md")).toBe(
      "# canonical epsilon",
    );
    // Prior source was "user", not "curated" — the overwrite stamps
    // "vendored", never minting a new "curated".
    const src = readSkillSource(
      path.join(registryRoot, "skills", "vendored", "epsilon"),
    );
    expect(src.source).toBe("vendored");
  });

  test("Branch 5: rename-mine renames local + writes canonical to original name", async () => {
    writeLocal(
      "vendored",
      "zeta",
      { "SKILL.md": "# my zeta" },
      { source: "user" },
    );
    writeCanonical("zeta", { "SKILL.md": "# canonical zeta" });

    const report = await applyCanonicalSync(
      registryRoot,
      canonicalRoot,
      "sha",
      { zeta: { action: "rename-mine", decidedAt: "2026-05-18T00:00:00Z" } },
    );
    expect(report.upserted).toEqual(["zeta"]);
    expect(report.resolved[0]!.action).toBe("rename-mine");
    const renamedTo = report.resolved[0]!.renamedTo!;

    expect(readLocal("vendored", "zeta", "SKILL.md")).toBe("# canonical zeta");
    expect(readLocal("vendored", renamedTo, "SKILL.md")).toBe("# my zeta");
  });

  test("no meta.json splice — canonical content overwrites wholesale", async () => {
    // The pre-v1.20 tag-preservation splice (local meta.json tags
    // surviving a canonical overwrite) is removed along with meta.json
    // itself — SKILL.md frontmatter is canonical since v1.15. A
    // canonical overwrite now replaces folder content verbatim.
    writeLocal(
      "vendored",
      "eta",
      {
        "SKILL.md": "# my eta",
        "meta.json": JSON.stringify({
          name: "eta",
          description: "x",
          tags: ["mine-1", "mine-2"],
        }),
      },
      { source: "curated", syncedFromCommit: "old" },
    );
    writeCanonical("eta", {
      "SKILL.md": "# canonical eta",
      "meta.json": JSON.stringify({
        name: "eta",
        description: "y",
        tags: ["canonical-1"],
      }),
    });

    const report = await applyCanonicalSync(registryRoot, canonicalRoot, "sha");
    expect(report.upserted).toEqual(["eta"]);
    expect(readLocal("vendored", "eta", "SKILL.md")).toBe("# canonical eta");
    const meta = JSON.parse(readLocal("vendored", "eta", "meta.json")!) as {
      tags: string[];
    };
    expect(meta.tags).toEqual(["canonical-1"]);
  });

  test("Orphan reporting — previously-curated-synced local skill not in canonical set is reported, not deleted", async () => {
    writeLocal(
      "vendored",
      "theta",
      { "SKILL.md": "# stale curated theta" },
      // Real curated syncs stamp both source AND syncedFromCommit;
      // orphan detection v1.5 keys off the latter.
      { source: "curated", syncedFromCommit: "old-sha" },
    );

    const report = await applyCanonicalSync(registryRoot, canonicalRoot, "sha");
    expect(report.orphaned).toEqual(["theta"]);
    expect(readLocal("vendored", "theta", "SKILL.md")).toBe(
      "# stale curated theta",
    );
  });

  test("Orphan reporting ignores user-authored skills (no syncedFromCommit)", async () => {
    writeLocal(
      "vendored",
      "iota",
      { "SKILL.md": "# my iota" },
      { source: "user" },
    );

    const report = await applyCanonicalSync(registryRoot, canonicalRoot, "sha");
    expect(report.orphaned).toEqual([]);
  });

  test("Empty source tree → zero upserts, no error", async () => {
    // Phase 1 scope expansion: discovery walks the whole extracted
    // tree by file convention, so a missing `skills/` directory is
    // no longer fatal — it just yields zero discoveries.
    fs.rmSync(path.join(canonicalRoot, "skills"), { recursive: true });
    const report = await applyCanonicalSync(registryRoot, canonicalRoot, "sha");
    expect(report.upserted).toEqual([]);
    expect(report.conflicts).toEqual([]);
  });
});

describe("applyCanonicalSync (mountTo: personal — linked-repo flow)", () => {
  test("Flat-rooted source mounts each skill into skills/personal/", async () => {
    writeCanonical("alpha", { "SKILL.md": "# alpha" }, { flat: true });
    writeCanonical("beta", { "SKILL.md": "# beta" }, { flat: true });

    const report = await applyCanonicalSync(
      registryRoot,
      canonicalRoot,
      "sha",
      {},
      { mountTo: "personal" },
    );
    expect(report.upserted.sort()).toEqual(["alpha", "beta"]);
    expect(readLocal("personal", "alpha", "SKILL.md")).toBe("# alpha");
    expect(readLocal("personal", "beta", "SKILL.md")).toBe("# beta");
    expect(
      fs.existsSync(path.join(registryRoot, "skills", "vendored", "alpha")),
    ).toBe(false);
  });

  test("Preserves per-skill upstream pointer from source's .skills-bank.json", async () => {
    writeCanonical(
      "alpha",
      {
        "SKILL.md": "# alpha",
        ".skills-bank.json": JSON.stringify({
          source: "user",
          origin: {
            kind: "github",
            repo: "Tyler-Reagan/skills",
            skillPath: "alpha/SKILL.md",
          },
        }),
      },
      { flat: true },
    );

    await applyCanonicalSync(
      registryRoot,
      canonicalRoot,
      "sha",
      {},
      { mountTo: "personal" },
    );
    const src = readSkillSource(
      path.join(registryRoot, "skills", "personal", "alpha"),
    );
    // v1.5: source axis is mountTo-derived. personal-mount → user
    // (the user mounted the skill from their own linked repo, so
    // it's theirs by the UL definition). Earlier behavior stamped
    // curated regardless of bucket; that was the bug surfaced
    // during Phase 5 QA.
    expect(src.source).toBe("user");
    expect(src.origin?.repo).toBe("Tyler-Reagan/skills"); // origin preserved
    expect(src.origin?.skillPath).toBe("alpha/SKILL.md");
  });

  test("source axis follows mountTo: vendored → vendored for new skills (never new curated)", async () => {
    writeCanonical(
      "beta",
      { "SKILL.md": "---\nname: beta\ndescription: x\n---\n# beta" },
      { flat: true },
    );
    await applyCanonicalSync(
      registryRoot,
      canonicalRoot,
      "sha",
      {},
      { mountTo: "vendored" },
    );
    // v1.20: vendored-mount syncs preserve an existing "curated" stamp
    // but stamp "vendored" for anything new — no sync path may mint a
    // fresh "curated".
    const src = readSkillSource(
      path.join(registryRoot, "skills", "vendored", "beta"),
    );
    expect(src.source).toBe("vendored");
  });

  test("re-sync of an already-linked repo: previously-synced skills overwrite cleanly, NOT surfaced as conflicts", async () => {
    // Pre-stage: skill exists locally with `source: user +
    // syncedFromCommit` (the post-v1.5 linked-repo-sync footprint).
    writeLocal(
      "personal",
      "gamma",
      { "SKILL.md": "# old gamma" },
      {
        source: "user",
        syncedFromCommit: "old-sha",
      },
    );
    writeCanonical(
      "gamma",
      { "SKILL.md": "---\nname: gamma\ndescription: x\n---\n# new gamma" },
      { flat: true },
    );

    const report = await applyCanonicalSync(
      registryRoot,
      canonicalRoot,
      "new-sha",
      {},
      { mountTo: "personal" },
    );
    // Previously-synced skill is overwritten in place — not a
    // conflict. v1.5 regression test: pre-fix this surfaced as
    // a fake conflict because `source: user !== curated`.
    expect(report.upserted).toEqual(["gamma"]);
    expect(report.conflicts).toEqual([]);
    expect(readLocal("personal", "gamma", "SKILL.md")).toBe(
      "---\nname: gamma\ndescription: x\n---\n# new gamma",
    );
  });

  test("linked-repo-orphan: skill previously synced from this repo, now removed upstream → orphan", async () => {
    // Pre-stage: skill previously linked-repo-synced (source: user
    // + syncedFromCommit), but NOT in the incoming tree.
    writeLocal(
      "personal",
      "iota",
      { "SKILL.md": "# stale iota" },
      {
        source: "user",
        syncedFromCommit: "old-sha",
      },
    );
    // canonicalRoot has no skills — `iota` was upstream-removed.
    const report = await applyCanonicalSync(
      registryRoot,
      canonicalRoot,
      "sha",
      {},
      { mountTo: "personal" },
    );
    // Surfaced as orphan. Pre-fix this was missed because
    // source: user !== "curated".
    expect(report.orphaned).toEqual(["iota"]);
    // Local copy untouched.
    expect(readLocal("personal", "iota", "SKILL.md")).toBe("# stale iota");
  });

  test("user-authored skill (no syncedFromCommit) collides with incoming → conflict", async () => {
    writeLocal(
      "personal",
      "delta",
      { "SKILL.md": "# my delta" },
      // No syncedFromCommit — user authored this locally.
      { source: "user" },
    );
    writeCanonical(
      "delta",
      { "SKILL.md": "---\nname: delta\ndescription: x\n---\n# incoming delta" },
      { flat: true },
    );

    const report = await applyCanonicalSync(
      registryRoot,
      canonicalRoot,
      "sha",
      {},
      { mountTo: "personal" },
    );
    expect(report.upserted).toEqual([]);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]!.name).toBe("delta");
  });
});

describe("applyCanonicalSync — discovery anomalies surface in report", () => {
  test("Skill-name collision across paths surfaces in discoveryCollisions", async () => {
    writeCanonical("alpha", { "SKILL.md": "# a" }, { flat: true });
    // Same name nested under a different prefix:
    const otherDir = path.join(canonicalRoot, "elsewhere", "alpha");
    fs.mkdirSync(otherDir, { recursive: true });
    fs.writeFileSync(path.join(otherDir, "SKILL.md"), "# b");

    const report = await applyCanonicalSync(
      registryRoot,
      canonicalRoot,
      "sha",
      {},
      { mountTo: "personal" },
    );
    expect(report.upserted).toEqual([]);
    expect(report.discoveryCollisions).toEqual([
      { name: "alpha", paths: ["alpha", "elsewhere/alpha"] },
    ]);
  });

  test("Nested skill surfaces in discoveryNested; outer mounts normally", async () => {
    writeCanonical("outer", { "SKILL.md": "# outer" }, { flat: true });
    const inner = path.join(canonicalRoot, "outer", "inner");
    fs.mkdirSync(inner, { recursive: true });
    fs.writeFileSync(path.join(inner, "SKILL.md"), "# inner");

    const report = await applyCanonicalSync(
      registryRoot,
      canonicalRoot,
      "sha",
      {},
      { mountTo: "personal" },
    );
    expect(report.upserted).toEqual(["outer"]);
    expect(report.discoveryNested).toEqual([
      { outer: "outer", inner: "outer/inner" },
    ]);
  });
});

describe("applyCanonicalSync — hash-gate (no-op when content unchanged)", () => {
  test("previously-synced skill with matching hash is not upserted", async () => {
    const content = {
      "SKILL.md": "# alpha",
      "meta.json": '{"name":"alpha","description":"a"}',
    };
    writeLocal("vendored", "alpha", content, {
      source: "curated",
      syncedFromCommit: "old-sha",
    });
    const localDir = path.join(registryRoot, "skills", "vendored", "alpha");
    const h = hashSkillFolder(localDir)!;
    writeSyncedHash(localDir, h);

    writeCanonical("alpha", content);

    const report = await applyCanonicalSync(
      registryRoot,
      canonicalRoot,
      "new-sha",
    );
    expect(report.upserted).toEqual([]);
    // The skip is reported, not silent — callers use `unchanged` to
    // tell an already-up-to-date sync apart from a tree with no
    // recognizable skills (both have zero upserts). The packaged-app
    // "Tyler-Reagan/skills has no skills the app can recognize" bug
    // on no-op pulls came from conflating the two.
    expect(report.unchanged).toEqual(["alpha"]);
    expect(readLocal("vendored", "alpha", "SKILL.md")).toBe("# alpha");
  });

  test("previously-synced skill with changed content is upserted", async () => {
    writeLocal(
      "vendored",
      "beta",
      { "SKILL.md": "# old" },
      {
        source: "curated",
        syncedFromCommit: "old-sha",
      },
    );
    const localDir = path.join(registryRoot, "skills", "vendored", "beta");
    const h = hashSkillFolder(localDir)!;
    writeSyncedHash(localDir, h);

    writeCanonical("beta", { "SKILL.md": "# updated" });

    const report = await applyCanonicalSync(
      registryRoot,
      canonicalRoot,
      "new-sha",
    );
    expect(report.upserted).toEqual(["beta"]);
    expect(report.unchanged).toEqual([]);
    expect(readLocal("vendored", "beta", "SKILL.md")).toBe("# updated");
  });

  test("previously-synced skill with no stored hash is upserted", async () => {
    writeLocal(
      "vendored",
      "gamma",
      { "SKILL.md": "# gamma" },
      {
        source: "curated",
        syncedFromCommit: "old-sha",
      },
    );
    writeCanonical("gamma", { "SKILL.md": "# gamma" });

    const report = await applyCanonicalSync(
      registryRoot,
      canonicalRoot,
      "new-sha",
    );
    expect(report.upserted).toEqual(["gamma"]);
  });
});
