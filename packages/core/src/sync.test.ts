import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyCanonicalSync } from "./sync.js";
import { readSkillSource, writeSkillSource } from "./source.js";

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
  test("Branch 1: no-collision upsert writes canonical + stamps bundled", async () => {
    writeCanonical("alpha", { "SKILL.md": "# canonical alpha" });

    const report = await applyCanonicalSync(registryRoot, canonicalRoot, "abc");
    expect(report.upserted).toEqual(["alpha"]);
    expect(report.conflicts).toEqual([]);
    expect(report.resolved).toEqual([]);
    expect(readLocal("vendored", "alpha", "SKILL.md")).toBe(
      "# canonical alpha",
    );

    const src = readSkillSource(
      path.join(registryRoot, "skills", "vendored", "alpha"),
    );
    expect(src.source).toBe("curated");
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
      { epsilon: { action: "use-canonical", decidedAt: "2026-05-18T00:00:00Z" } },
    );
    expect(report.upserted).toEqual(["epsilon"]);
    expect(readLocal("vendored", "epsilon", "SKILL.md")).toBe(
      "# canonical epsilon",
    );
    const src = readSkillSource(
      path.join(registryRoot, "skills", "vendored", "epsilon"),
    );
    expect(src.source).toBe("curated");
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

  test("meta.json tag-preservation splice — tags survive a canonical overwrite", async () => {
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
    expect(meta.tags).toEqual(["mine-1", "mine-2"]);
  });

  test("Orphan reporting — bundled local skill not in canonical set is reported, not deleted", async () => {
    writeLocal(
      "vendored",
      "theta",
      { "SKILL.md": "# stale bundled theta" },
      { source: "curated" },
    );

    const report = await applyCanonicalSync(registryRoot, canonicalRoot, "sha");
    expect(report.orphaned).toEqual(["theta"]);
    expect(readLocal("vendored", "theta", "SKILL.md")).toBe(
      "# stale bundled theta",
    );
  });

  test("Orphan reporting ignores `yours` skills (only bundled get orphan-reported)", async () => {
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

  test("source axis follows mountTo: vendored → curated (curated-set sync)", async () => {
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
    const src = readSkillSource(
      path.join(registryRoot, "skills", "vendored", "beta"),
    );
    expect(src.source).toBe("curated");
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
