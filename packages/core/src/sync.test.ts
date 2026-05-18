import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyCanonicalSync } from "./sync.js";
import { readSkillSource, writeSkillSource } from "./source.js";

/**
 * applyCanonicalSync's five conflict-resolution branches + the meta.json
 * tag-preservation splice (ADR-0001 Suite 2). The five branches:
 *
 *   1. No-collision upsert (canonical skill not present locally).
 *   2. bundled → bundled overwrite (local copy stamped bundled,
 *      overwritten with the new canonical).
 *   3. yours collision + decision = keep-mine.
 *   4. yours collision + decision = use-canonical.
 *   5. yours collision + decision = rename-mine.
 *
 * Plus: orphan reporting (no auto-delete) and tag preservation.
 */

let scratch: string;
let registryRoot: string;
let canonicalRoot: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-sync-"));
  registryRoot = path.join(scratch, "registry");
  canonicalRoot = path.join(scratch, "extracted");
  fs.mkdirSync(path.join(registryRoot, "skills"), { recursive: true });
  fs.mkdirSync(path.join(canonicalRoot, "skills"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function writeCanonical(name: string, files: Record<string, string>): void {
  const dir = path.join(canonicalRoot, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

function writeLocal(
  name: string,
  files: Record<string, string>,
  source: Parameters<typeof writeSkillSource>[1] | null,
): void {
  const dir = path.join(registryRoot, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  if (source !== null) writeSkillSource(dir, source);
}

function readLocal(name: string, rel: string): string | null {
  const p = path.join(registryRoot, "skills", name, rel);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

describe("applyCanonicalSync", () => {
  test("Branch 1: no-collision upsert writes canonical + stamps bundled", async () => {
    writeCanonical("alpha", { "SKILL.md": "# canonical alpha" });

    const report = await applyCanonicalSync(registryRoot, canonicalRoot, "abc");
    expect(report.upserted).toEqual(["alpha"]);
    expect(report.conflicts).toEqual([]);
    expect(report.resolved).toEqual([]);
    expect(readLocal("alpha", "SKILL.md")).toBe("# canonical alpha");

    const src = readSkillSource(path.join(registryRoot, "skills", "alpha"));
    expect(src.source).toBe("bundled");
    expect(src.syncedFromCommit).toBe("abc");
  });

  test("Branch 2: bundled → bundled overwrite replaces content + re-stamps commit", async () => {
    writeLocal(
      "beta",
      { "SKILL.md": "# old canonical beta" },
      { source: "bundled", syncedFromCommit: "old-sha" },
    );
    writeCanonical("beta", { "SKILL.md": "# new canonical beta" });

    const report = await applyCanonicalSync(registryRoot, canonicalRoot, "new-sha");
    expect(report.upserted).toEqual(["beta"]);
    expect(report.conflicts).toEqual([]);
    expect(readLocal("beta", "SKILL.md")).toBe("# new canonical beta");

    const src = readSkillSource(path.join(registryRoot, "skills", "beta"));
    expect(src.syncedFromCommit).toBe("new-sha");
  });

  test("Conflict surfacing: yours collision with no decision is queued", async () => {
    writeLocal(
      "gamma",
      { "SKILL.md": "# my edited gamma" },
      { source: "yours" },
    );
    writeCanonical("gamma", { "SKILL.md": "# canonical gamma" });

    const report = await applyCanonicalSync(registryRoot, canonicalRoot, "sha");
    expect(report.upserted).toEqual([]);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]!.name).toBe("gamma");
    // Local copy untouched until the user resolves.
    expect(readLocal("gamma", "SKILL.md")).toBe("# my edited gamma");
  });

  test("Branch 3: keep-mine skips canonical write + logs resolved", async () => {
    writeLocal(
      "delta",
      { "SKILL.md": "# my delta" },
      { source: "yours" },
    );
    writeCanonical("delta", { "SKILL.md": "# canonical delta" });

    const report = await applyCanonicalSync(
      registryRoot,
      canonicalRoot,
      "sha",
      { delta: { action: "keep-mine", decidedAt: "2026-05-18T00:00:00Z" } },
    );
    expect(report.upserted).toEqual([]);
    expect(report.conflicts).toEqual([]);
    expect(report.resolved).toEqual([{ name: "delta", action: "keep-mine" }]);
    expect(readLocal("delta", "SKILL.md")).toBe("# my delta");
  });

  test("Branch 4: use-canonical overwrites + logs resolved", async () => {
    writeLocal(
      "epsilon",
      { "SKILL.md": "# my epsilon" },
      { source: "yours" },
    );
    writeCanonical("epsilon", { "SKILL.md": "# canonical epsilon" });

    const report = await applyCanonicalSync(
      registryRoot,
      canonicalRoot,
      "sha",
      { epsilon: { action: "use-canonical", decidedAt: "2026-05-18T00:00:00Z" } },
    );
    expect(report.upserted).toEqual(["epsilon"]);
    expect(report.resolved).toEqual([
      { name: "epsilon", action: "use-canonical" },
    ]);
    expect(readLocal("epsilon", "SKILL.md")).toBe("# canonical epsilon");
    const src = readSkillSource(path.join(registryRoot, "skills", "epsilon"));
    expect(src.source).toBe("bundled");
  });

  test("Branch 5: rename-mine renames local + writes canonical to original name", async () => {
    writeLocal(
      "zeta",
      { "SKILL.md": "# my zeta" },
      { source: "yours" },
    );
    writeCanonical("zeta", { "SKILL.md": "# canonical zeta" });

    const report = await applyCanonicalSync(
      registryRoot,
      canonicalRoot,
      "sha",
      { zeta: { action: "rename-mine", decidedAt: "2026-05-18T00:00:00Z" } },
    );
    expect(report.upserted).toEqual(["zeta"]);
    expect(report.resolved).toHaveLength(1);
    expect(report.resolved[0]!.name).toBe("zeta");
    expect(report.resolved[0]!.action).toBe("rename-mine");
    expect(report.resolved[0]!.renamedTo).toBeDefined();

    // Original name now holds canonical.
    expect(readLocal("zeta", "SKILL.md")).toBe("# canonical zeta");
    // Renamed copy preserves user content.
    const renamedTo = report.resolved[0]!.renamedTo!;
    expect(readLocal(renamedTo, "SKILL.md")).toBe("# my zeta");
  });

  test("meta.json tag-preservation splice — tags survive a canonical overwrite", async () => {
    writeLocal(
      "eta",
      {
        "SKILL.md": "# my eta",
        "meta.json": JSON.stringify({
          name: "eta",
          description: "x",
          tags: ["mine-1", "mine-2"],
        }),
      },
      { source: "bundled", syncedFromCommit: "old" },
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

    // SKILL.md got the canonical content; meta.json tags are the user's.
    expect(readLocal("eta", "SKILL.md")).toBe("# canonical eta");
    const meta = JSON.parse(readLocal("eta", "meta.json")!) as {
      tags: string[];
    };
    expect(meta.tags).toEqual(["mine-1", "mine-2"]);
  });

  test("Orphan reporting — bundled local skill not in canonical set is reported, not deleted", async () => {
    writeLocal(
      "theta",
      { "SKILL.md": "# stale bundled theta" },
      { source: "bundled" },
    );
    // canonicalRoot/skills/ has nothing — theta is upstream-removed.

    const report = await applyCanonicalSync(registryRoot, canonicalRoot, "sha");
    expect(report.orphaned).toEqual(["theta"]);
    // The local copy stays on disk — Sync never auto-deletes orphans.
    expect(readLocal("theta", "SKILL.md")).toBe("# stale bundled theta");
  });

  test("Orphan reporting ignores `yours` skills (only bundled get orphan-reported)", async () => {
    writeLocal(
      "iota",
      { "SKILL.md": "# my iota" },
      { source: "yours" },
    );

    const report = await applyCanonicalSync(registryRoot, canonicalRoot, "sha");
    expect(report.orphaned).toEqual([]);
  });

  test("Tarball missing skills/ throws", async () => {
    fs.rmSync(path.join(canonicalRoot, "skills"), { recursive: true });
    await expect(
      applyCanonicalSync(registryRoot, canonicalRoot, "sha"),
    ).rejects.toThrow(/missing skills\//);
  });
});
