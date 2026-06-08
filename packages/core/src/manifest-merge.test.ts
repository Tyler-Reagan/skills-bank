import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyManifestResolutions,
  clearPendingManifestConflicts,
  mergeManifests,
  readMergeBase,
  readPendingManifestConflicts,
  writeMergeBase,
  writePendingManifestConflicts,
} from "./manifest-merge.js";
import { MANIFEST_SCHEMA_VERSION } from "./manifest.js";
import { getStateDir } from "./shared/paths.js";
import type { ManifestSkill, RegistryManifest } from "./manifest.js";

/**
 * Three-way merge truth table. Each case fixes (base, ours, theirs) for
 * a single skill and asserts the merged entry + conflict shape. The
 * significant axis exercised is `tags` (a `COMPARED_FIELDS` member);
 * `description` is exercised separately to prove non-significant fields
 * never trigger a conflict.
 *
 * Cell legend: `-` = absent, `A`/`B`/`C` = distinct significant values.
 */

function sk(name: string, tags: string[], description?: string): ManifestSkill {
  return {
    name,
    ...(description ? { description } : {}),
    source: "user",
    bucket: "personal",
    origin: { kind: "none" },
    tags,
    category: null,
    lastInstalledOn: [],
  };
}

function mf(
  skills: ManifestSkill[],
  extra: Partial<RegistryManifest> = {},
): RegistryManifest {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    exportedAt: "2026-06-01T00:00:00Z",
    sourceBankVersion: "1.17.0",
    skills,
    ...extra,
  };
}

/** Build single-skill manifests from a cell spec; `null` = absent. */
function cell(
  base: ManifestSkill | null,
  ours: ManifestSkill | null,
  theirs: ManifestSkill | null,
) {
  return mergeManifests(
    mf(base ? [base] : []),
    mf(ours ? [ours] : []),
    mf(theirs ? [theirs] : []),
  );
}

const A = (n = "x") => sk(n, ["a"]);
const B = (n = "x") => sk(n, ["b"]);
const C = (n = "x") => sk(n, ["c"]);

describe("mergeManifests — three-way cells", () => {
  test("A/A/A — no change → keep, no conflict", () => {
    const r = cell(A(), A(), A());
    expect(r.conflicts).toEqual([]);
    expect(r.merged.skills.map((s) => s.tags)).toEqual([["a"]]);
  });

  test("A/B/A — only ours changed → take ours", () => {
    const r = cell(A(), B(), A());
    expect(r.conflicts).toEqual([]);
    expect(r.merged.skills[0]!.tags).toEqual(["b"]);
  });

  test("A/A/B — only theirs changed → take theirs", () => {
    const r = cell(A(), A(), B());
    expect(r.conflicts).toEqual([]);
    expect(r.merged.skills[0]!.tags).toEqual(["b"]);
  });

  test("A/B/B — both changed the same way → take it, no conflict", () => {
    const r = cell(A(), B(), B());
    expect(r.conflicts).toEqual([]);
    expect(r.merged.skills[0]!.tags).toEqual(["b"]);
  });

  test("A/B/C — both changed differently → both-modified conflict", () => {
    const r = cell(A(), B(), C());
    expect(r.merged.skills).toEqual([]);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({
      name: "x",
      kind: "both-modified",
    });
    expect(r.conflicts[0]!.base!.tags).toEqual(["a"]);
    expect(r.conflicts[0]!.ours!.tags).toEqual(["b"]);
    expect(r.conflicts[0]!.theirs!.tags).toEqual(["c"]);
  });

  test("-/A/- — ours added → take ours", () => {
    const r = cell(null, A(), null);
    expect(r.conflicts).toEqual([]);
    expect(r.merged.skills[0]!.tags).toEqual(["a"]);
  });

  test("-/-/A — theirs added → take theirs", () => {
    const r = cell(null, null, A());
    expect(r.conflicts).toEqual([]);
    expect(r.merged.skills[0]!.tags).toEqual(["a"]);
  });

  test("-/A/A — both added the same → take it, no conflict", () => {
    const r = cell(null, A(), A());
    expect(r.conflicts).toEqual([]);
    expect(r.merged.skills).toHaveLength(1);
  });

  test("-/A/B — both added differently → both-added conflict", () => {
    const r = cell(null, A(), B());
    expect(r.merged.skills).toEqual([]);
    expect(r.conflicts[0]).toMatchObject({ name: "x", kind: "both-added" });
    expect(r.conflicts[0]!.base).toBeNull();
  });

  test("A/-/A — ours deleted, theirs unchanged → drop", () => {
    const r = cell(A(), null, A());
    expect(r.conflicts).toEqual([]);
    expect(r.merged.skills).toEqual([]);
  });

  test("A/A/- — theirs deleted, ours unchanged → drop", () => {
    const r = cell(A(), A(), null);
    expect(r.conflicts).toEqual([]);
    expect(r.merged.skills).toEqual([]);
  });

  test("A/-/- — both deleted → drop, no conflict", () => {
    const r = cell(A(), null, null);
    expect(r.conflicts).toEqual([]);
    expect(r.merged.skills).toEqual([]);
  });

  test("A/B/- — ours edited, theirs deleted → edit/delete conflict", () => {
    const r = cell(A(), B(), null);
    expect(r.merged.skills).toEqual([]);
    expect(r.conflicts[0]).toMatchObject({
      name: "x",
      kind: "ours-modified-theirs-deleted",
    });
    expect(r.conflicts[0]!.theirs).toBeNull();
  });

  test("A/-/B — ours deleted, theirs edited → delete/edit conflict", () => {
    const r = cell(A(), null, B());
    expect(r.merged.skills).toEqual([]);
    expect(r.conflicts[0]).toMatchObject({
      name: "x",
      kind: "theirs-modified-ours-deleted",
    });
    expect(r.conflicts[0]!.ours).toBeNull();
  });
});

describe("mergeManifests — non-significant fields", () => {
  test("description-only divergence is not a change → no conflict, keeps local", () => {
    const base = sk("x", ["a"], "base desc");
    const ours = sk("x", ["a"], "local desc");
    const theirs = sk("x", ["a"], "remote desc");
    const r = mergeManifests(mf([base]), mf([ours]), mf([theirs]));
    expect(r.conflicts).toEqual([]);
    // Neither side "changed" by signature, so ours (local truth) is kept.
    expect(r.merged.skills[0]!.description).toBe("local desc");
  });
});

describe("mergeManifests — manifest-level", () => {
  test("merged carries ours metadata and sorts skills by name", () => {
    const base = mf([]);
    const ours = mf([sk("zeta", ["z"]), sk("alpha", ["a"])], {
      sourceBankVersion: "9.9.9",
      registryRoot: "Tyler-Reagan/skills",
    });
    const theirs = mf([]);
    const r = mergeManifests(base, ours, theirs);
    expect(r.merged.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(r.merged.sourceBankVersion).toBe("9.9.9");
    expect(r.merged.registryRoot).toBe("Tyler-Reagan/skills");
    expect(r.merged.skills.map((s) => s.name)).toEqual(["alpha", "zeta"]);
  });

  test("multi-skill scenario: independent adds, edits, deletes, and one conflict", () => {
    const base = mf([
      sk("keep", ["k"]),
      sk("ours-edit", ["x"]),
      sk("theirs-edit", ["x"]),
      sk("ours-del", ["x"]),
      sk("conflict", ["x"]),
    ]);
    const ours = mf([
      sk("keep", ["k"]),
      sk("ours-edit", ["edited-local"]),
      sk("theirs-edit", ["x"]),
      // ours-del removed locally
      sk("conflict", ["mine"]),
      sk("ours-add", ["new"]),
    ]);
    const theirs = mf([
      sk("keep", ["k"]),
      sk("ours-edit", ["x"]),
      sk("theirs-edit", ["edited-remote"]),
      sk("ours-del", ["x"]),
      sk("conflict", ["theirs"]),
    ]);
    const r = mergeManifests(base, ours, theirs);
    const merged = Object.fromEntries(
      r.merged.skills.map((s) => [s.name, s.tags]),
    );
    expect(merged["keep"]).toEqual(["k"]);
    expect(merged["ours-edit"]).toEqual(["edited-local"]);
    expect(merged["theirs-edit"]).toEqual(["edited-remote"]);
    expect("ours-del" in merged).toBe(false);
    expect(merged["ours-add"]).toEqual(["new"]);
    expect("conflict" in merged).toBe(false);
    expect(r.conflicts.map((c) => c.name)).toEqual(["conflict"]);
  });
});

describe("pending-manifest-conflicts persistence", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-merge-state-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("write → read round-trips the conflict payload", () => {
    const result = cell(A(), B(), C());
    writePendingManifestConflicts(root, {
      mergedAt: "2026-06-01T00:00:00Z",
      conflicts: result.conflicts,
      merged: result.merged,
      theirs: mf([C()]),
    });
    const back = readPendingManifestConflicts(root);
    expect(back?.mergedAt).toBe("2026-06-01T00:00:00Z");
    expect(back?.conflicts).toHaveLength(1);
    expect(back?.conflicts[0]!.kind).toBe("both-modified");
    expect(back?.merged.skills).toEqual([]);
  });

  test("writing an empty conflict list clears any stale file", () => {
    const result = cell(A(), B(), C());
    writePendingManifestConflicts(root, {
      mergedAt: "t1",
      conflicts: result.conflicts,
      merged: result.merged,
      theirs: mf([C()]),
    });
    expect(
      fs.existsSync(
        path.join(getStateDir(root), "pending-manifest-conflicts.json"),
      ),
    ).toBe(true);
    writePendingManifestConflicts(root, {
      mergedAt: "t2",
      conflicts: [],
      merged: result.merged,
      theirs: mf([]),
    });
    expect(readPendingManifestConflicts(root)).toBeNull();
  });

  test("clear removes the file and reports it", () => {
    const result = cell(A(), B(), C());
    writePendingManifestConflicts(root, {
      mergedAt: "t1",
      conflicts: result.conflicts,
      merged: result.merged,
      theirs: mf([C()]),
    });
    expect(clearPendingManifestConflicts(root)).toEqual({ removed: true });
    expect(clearPendingManifestConflicts(root)).toEqual({ removed: false });
  });
});

describe("merge base", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-merge-base-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("absent base reads as null", () => {
    expect(readMergeBase(root)).toBeNull();
  });

  test("write → read round-trips the manifest skills", () => {
    writeMergeBase(root, mf([A("alpha"), B("zeta")]));
    const back = readMergeBase(root);
    expect(back?.skills.map((s) => s.name)).toEqual(["alpha", "zeta"]);
  });

  test("stored canonically (no exportedAt churn) and coerced on read", () => {
    writeMergeBase(root, mf([A("alpha")], { exportedAt: "2026-06-01T00:00Z" }));
    const raw = fs.readFileSync(
      path.join(getStateDir(root), "merge-base.json"),
      "utf8",
    );
    expect(raw.includes("exportedAt")).toBe(false);
    // Coerced back to a whole manifest with the empty exportedAt default.
    expect(readMergeBase(root)?.exportedAt).toBe("");
  });
});

describe("applyManifestResolutions", () => {
  test("keep-mine keeps the local entry; use-theirs takes the remote", () => {
    const merge = cell(A(), B(), C()); // both-modified on "x"
    const keepMine = applyManifestResolutions(merge, { x: "keep-mine" });
    expect(keepMine.manifest.skills[0]!.tags).toEqual(["b"]);
    expect(keepMine.removeNames).toEqual([]);

    const useTheirs = applyManifestResolutions(merge, { x: "use-theirs" });
    expect(useTheirs.manifest.skills[0]!.tags).toEqual(["c"]);
  });

  test("undecided conflict defaults to keep-mine", () => {
    const merge = cell(A(), B(), C());
    const r = applyManifestResolutions(merge, {});
    expect(r.manifest.skills[0]!.tags).toEqual(["b"]);
  });

  test("use-theirs on a remote deletion queues a local removal", () => {
    // ours edited, theirs deleted → ours-modified-theirs-deleted.
    const merge = cell(A(), B(), null);
    const r = applyManifestResolutions(merge, { x: "use-theirs" });
    expect(r.removeNames).toEqual(["x"]);
    expect(r.manifest.skills).toEqual([]);
  });

  test("keep-mine on a local deletion keeps it gone", () => {
    // ours deleted, theirs edited → theirs-modified-ours-deleted.
    const merge = cell(A(), null, B());
    const r = applyManifestResolutions(merge, { x: "keep-mine" });
    expect(r.removeNames).toEqual(["x"]);
    expect(r.manifest.skills).toEqual([]);
  });

  test("keep-both forks ours to <name>-local and keeps theirs at the name", () => {
    const merge = cell(A(), B(), C());
    const r = applyManifestResolutions(merge, { x: "keep-both" });
    const byName = Object.fromEntries(
      r.manifest.skills.map((s) => [s.name, s.tags]),
    );
    expect(byName["x"]).toEqual(["c"]); // theirs at original name
    expect(byName["x-local"]).toEqual(["b"]); // ours forked
    expect(r.renamed).toEqual([{ from: "x", to: "x-local" }]);
  });
});
