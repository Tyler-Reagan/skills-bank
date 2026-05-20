import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergeImportRegistry } from "./merge.js";
import { readSkillSource, writeSkillSource } from "./source.js";
import { readUpstreamCanonNames, writeUpstreamCanonNames } from "./canon.js";

/**
 * mergeImportRegistry mirrors applyCanonicalSync's conflict surface
 * but DIVERGES on two axes (ADR-0001 Suite 3):
 *
 *   1. Imported skills are stamped `source: yours` (Sync stamps `bundled`).
 *      Merge-imported skills are functionally identical to user-authored
 *      ones from this point forward — they do NOT become canon under the
 *      active registry's upstream.
 *   2. Merge invalidates the canon cache so the next index build re-reads.
 *
 * These tests pin both divergences so a future consolidation refactor
 * (v0.11.9 territory — unifying Sync + Merge code paths) can't silently
 * regress one into the other.
 */

let scratch: string;
let activeRoot: string;
let sourceRoot: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-merge-"));
  activeRoot = path.join(scratch, "active");
  sourceRoot = path.join(scratch, "source");
  fs.mkdirSync(path.join(activeRoot, "skills"), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, "skills"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function writeSource(name: string, files: Record<string, string>): void {
  const dir = path.join(sourceRoot, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, rel), content);
  }
}

function writeActive(
  name: string,
  files: Record<string, string>,
  source: Parameters<typeof writeSkillSource>[1] | null,
): void {
  const dir = path.join(activeRoot, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, rel), content);
  }
  if (source !== null) writeSkillSource(dir, source);
}

function readActive(name: string, rel: string): string | null {
  const p = path.join(activeRoot, "skills", name, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

describe("mergeImportRegistry", () => {
  test("no-collision import stamps `source: yours` (divergent from Sync)", () => {
    writeSource("alpha", { "SKILL.md": "# imported alpha" });

    const report = mergeImportRegistry(activeRoot, sourceRoot);
    expect(report.imported).toEqual(["alpha"]);
    expect(report.conflicts).toEqual([]);

    const src = readSkillSource(path.join(activeRoot, "skills", "alpha"));
    expect(src.source).toBe("user");
    // Sync would have written `syncedFromCommit`; merge does not.
    expect(src.syncedFromCommit).toBeUndefined();
  });

  test("collision with no decision is queued in conflicts", () => {
    writeActive("beta", { "SKILL.md": "# my beta" }, { source: "user" });
    writeSource("beta", { "SKILL.md": "# imported beta" });

    const report = mergeImportRegistry(activeRoot, sourceRoot);
    expect(report.imported).toEqual([]);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]!.name).toBe("beta");
    // Local copy untouched.
    expect(readActive("beta", "SKILL.md")).toBe("# my beta");
  });

  test("keep-mine logs to keptMine and skips the import", () => {
    writeActive("gamma", { "SKILL.md": "# my gamma" }, { source: "user" });
    writeSource("gamma", { "SKILL.md": "# imported gamma" });

    const report = mergeImportRegistry(activeRoot, sourceRoot, {
      gamma: { action: "keep-mine", decidedAt: "2026-05-18T00:00:00Z" },
    });
    expect(report.imported).toEqual([]);
    expect(report.keptMine).toEqual(["gamma"]);
    expect(readActive("gamma", "SKILL.md")).toBe("# my gamma");
  });

  test("use-canonical overwrites + stamps `source: yours` (not bundled)", () => {
    writeActive("delta", { "SKILL.md": "# my delta" }, { source: "user" });
    writeSource("delta", { "SKILL.md": "# imported delta" });

    const report = mergeImportRegistry(activeRoot, sourceRoot, {
      delta: { action: "use-canonical", decidedAt: "2026-05-18T00:00:00Z" },
    });
    expect(report.imported).toEqual(["delta"]);
    expect(readActive("delta", "SKILL.md")).toBe("# imported delta");

    const src = readSkillSource(path.join(activeRoot, "skills", "delta"));
    // Critical: still `yours`, even though the content came from the
    // source. Merge-import never produces `bundled` skills.
    expect(src.source).toBe("user");
  });

  test("rename-mine renames local to <name>-local-* + imports to original name", () => {
    writeActive(
      "epsilon",
      { "SKILL.md": "# my epsilon" },
      { source: "user" },
    );
    writeSource("epsilon", { "SKILL.md": "# imported epsilon" });

    const report = mergeImportRegistry(activeRoot, sourceRoot, {
      epsilon: { action: "rename-mine", decidedAt: "2026-05-18T00:00:00Z" },
    });
    expect(report.imported).toEqual(["epsilon"]);
    expect(report.renamed).toHaveLength(1);
    expect(report.renamed[0]!.name).toBe("epsilon");
    expect(report.renamed[0]!.renamedTo).toMatch(/^epsilon-local/);

    // Original name now holds imported content.
    expect(readActive("epsilon", "SKILL.md")).toBe("# imported epsilon");
    // Renamed copy keeps user content + retains its `yours` stamp.
    const renamedTo = report.renamed[0]!.renamedTo;
    expect(readActive(renamedTo, "SKILL.md")).toBe("# my epsilon");
  });

  test("rename target collision picks <name>-local-2 / -3 / …", () => {
    writeActive("zeta", { "SKILL.md": "# my zeta" }, { source: "user" });
    writeActive(
      "zeta-local",
      { "SKILL.md": "# previously renamed" },
      { source: "user" },
    );
    writeSource("zeta", { "SKILL.md": "# imported zeta" });

    const report = mergeImportRegistry(activeRoot, sourceRoot, {
      zeta: { action: "rename-mine", decidedAt: "2026-05-18T00:00:00Z" },
    });
    expect(report.renamed[0]!.renamedTo).toBe("zeta-local-2");
  });

  test("source root with no skills/ throws", () => {
    fs.rmSync(path.join(sourceRoot, "skills"), { recursive: true });
    expect(() => mergeImportRegistry(activeRoot, sourceRoot)).toThrow(
      /no skills\// ,
    );
  });

  test("imported skill writes a baseline hash sidecar", () => {
    writeSource("eta", { "SKILL.md": "# imported eta" });
    mergeImportRegistry(activeRoot, sourceRoot);
    const hashPath = path.join(activeRoot, "skills", "eta", ".skills-bank-hash");
    expect(fs.existsSync(hashPath)).toBe(true);
    const hash = fs.readFileSync(hashPath, "utf8").trim();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("invalidates canon cache so subsequent reads re-pull from disk", () => {
    // Prime the canon cache by writing + reading.
    writeUpstreamCanonNames(activeRoot, ["theta"], "bundled");
    expect(readUpstreamCanonNames(activeRoot).has("theta")).toBe(true);

    // Mutate the canon file directly (bypassing the cache-invalidating
    // writer) so a cached read would still report the old set.
    const canonFile = path.join(
      activeRoot,
      ".skills-bank",
      "upstream-canon.json",
    );
    fs.writeFileSync(
      canonFile,
      JSON.stringify({
        names: ["iota"],
        source: "bundled",
        updatedAt: new Date().toISOString(),
      }) + "\n",
    );

    // Run merge — should call invalidateCanonCache internally.
    writeSource("kappa", { "SKILL.md": "# imported kappa" });
    mergeImportRegistry(activeRoot, sourceRoot);

    // Next read should pick up the mutated file (iota), not the cached
    // set (theta).
    const after = readUpstreamCanonNames(activeRoot);
    expect(after.has("iota")).toBe(true);
    expect(after.has("theta")).toBe(false);
  });
});
