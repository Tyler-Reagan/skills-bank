import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  reconcileFoldersToManifest,
  reconcileFoldersToManifestSafe,
} from "../reconcile-folders.js";
import {
  readLiveManifest,
  writeLiveManifest,
} from "../../manifest/manifest.js";
import { getRuntimeEntry, setRuntimeEntry } from "../runtime-map.js";

/**
 * Pins the F5 recovery invariant: reconcile heals a `url:null` candidate
 * from a surviving pre-#159 `.skills-bank.json` sidecar (old shape →
 * v6, `.git`-normalized), covering both a fresh orphan folder and an
 * existing all-null manifest row. A folder with no sidecar stays the
 * honest `url:null`.
 */

let scratch: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-reconcile-"));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function makeSkillFolder(
  bucket: "personal" | "vendored",
  name: string,
  sidecar?: unknown,
): void {
  const dir = path.join(scratch, "skills", bucket, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name}\n---\n`,
  );
  if (sidecar !== undefined) {
    fs.writeFileSync(
      path.join(dir, ".skills-bank.json"),
      JSON.stringify(sidecar, null, 2),
    );
  }
}

function byName(root: string, name: string) {
  return readLiveManifest(root).skills.find((s) => s.name === name)!;
}

/**
 * Pin the npx-lock read at a nonexistent fixture so these suites never
 * pick up the developer's real ~/.agents/.skill-lock.json. The dedicated
 * npx-backfill suite below passes a real fixture path instead.
 */
function noNpx() {
  return { npxLockPath: path.join(scratch, "__no-npx-lock.json") };
}
function reconcile(
  root: string,
  opts: Parameters<typeof reconcileFoldersToManifest>[1] = {},
) {
  return reconcileFoldersToManifest(root, { ...noNpx(), ...opts });
}
function reconcileSafe(root: string) {
  return reconcileFoldersToManifestSafe(root, noNpx());
}

describe("reconcileFoldersToManifest — F5 legacy-origin recovery", () => {
  test("heals a fresh orphan folder from its legacy sidecar", () => {
    makeSkillFolder("vendored", "mcp-builder", {
      source: "user",
      origin: {
        kind: "github",
        repo: "anthropics/skills",
        sourceUrl: "https://github.com/anthropics/skills.git",
        skillPath: "skills/mcp-builder/SKILL.md",
        skillFolderHash: "abc123",
      },
    });
    reconcile(scratch);
    const row = byName(scratch, "mcp-builder");
    expect(row.origin.url).toBe("https://github.com/anthropics/skills");
    expect(row.origin.skillPath).toBe("skills/mcp-builder/SKILL.md");
    expect(row.origin.hash).toBe("abc123");
  });

  test("heals an existing url:null manifest row from the sidecar", () => {
    makeSkillFolder("vendored", "grilling", {
      origin: {
        kind: "github",
        sourceUrl: "https://github.com/some/repo",
        skillPath: "skills/grilling/SKILL.md",
      },
    });
    // Simulate a registry already reconciled to all-null (my Phase-8 boot).
    writeLiveManifest(scratch, {
      schemaVersion: 6,
      skills: [
        { name: "grilling", origin: { url: null }, category: null, tags: [] },
      ],
    });
    reconcile(scratch);
    expect(byName(scratch, "grilling").origin.url).toBe(
      "https://github.com/some/repo",
    );
  });

  test("a folder with no sidecar stays the honest url:null", () => {
    makeSkillFolder("personal", "from-scratch");
    reconcile(scratch);
    expect(byName(scratch, "from-scratch").origin).toEqual({ url: null });
  });

  test("a genuinely-local sidecar (no sourceUrl/repo) stays url:null", () => {
    makeSkillFolder("personal", "local-only", {
      origin: { kind: "none", skillPath: "skills/local-only/SKILL.md" },
    });
    reconcile(scratch);
    expect(byName(scratch, "local-only").origin).toEqual({ url: null });
  });
});

/**
 * Bidirectional reconciliation (issue #209/#211/#213): a manifest row
 * whose folder is gone is dropped, alongside its runtime entry, so every
 * removal path (unregister, purge, import-removal) can call this one
 * function after mutating disk instead of hand-maintaining its own copy
 * of the folder⇔row invariant.
 */
describe("reconcileFoldersToManifest — drops rows whose folder is gone", () => {
  test("removes the manifest row for a name with no folder on disk", () => {
    writeLiveManifest(scratch, {
      schemaVersion: 6,
      skills: [
        { name: "vanished", origin: { url: null }, category: null, tags: [] },
      ],
    });
    reconcile(scratch);
    expect(
      readLiveManifest(scratch).skills.find((s) => s.name === "vanished"),
    ).toBeUndefined();
  });

  test("drops the runtime entry alongside the row", () => {
    writeLiveManifest(scratch, {
      schemaVersion: 6,
      skills: [
        { name: "vanished", origin: { url: null }, category: null, tags: [] },
      ],
    });
    setRuntimeEntry(scratch, "vanished", { syncedHash: "deadbeef" });
    reconcile(scratch);
    expect(getRuntimeEntry(scratch, "vanished")).toEqual({});
  });

  test("leaves rows with a matching folder untouched", () => {
    makeSkillFolder("personal", "still-here");
    reconcile(scratch);
    expect(byName(scratch, "still-here")).toBeDefined();
  });
});

/**
 * A cross-bucket name collision on disk (the same folder name under
 * both personal/ and vendored/) is an invariant walkSkills is right to
 * enforce for CI, but must not crash a running app. Pins the boundary:
 * the raw function still throws (CI catches it), the Safe wrapper does
 * not (boot/mutation seams stay resilient) and leaves the manifest
 * exactly as it was before the call — no partial write.
 */
describe("reconcileFoldersToManifest / Safe — cross-bucket collision", () => {
  test("the raw function throws SkillNameCollisionError", () => {
    makeSkillFolder("personal", "dup-name");
    makeSkillFolder("vendored", "dup-name");
    expect(() => reconcile(scratch)).toThrow(/appears in multiple buckets/);
  });

  test("the Safe wrapper does not throw and leaves the manifest unchanged", () => {
    makeSkillFolder("personal", "dup-name");
    makeSkillFolder("vendored", "dup-name");
    const before = readLiveManifest(scratch);

    expect(() => reconcileSafe(scratch)).not.toThrow();

    expect(readLiveManifest(scratch)).toEqual(before);
  });

  test("the Safe wrapper still reconciles normally when there's no collision", () => {
    makeSkillFolder("personal", "no-conflict");
    reconcileSafe(scratch);
    expect(byName(scratch, "no-conflict")).toBeDefined();
  });
});

/**
 * #191 — origin backfill from npx's global lockfile. A url:null skill
 * whose name matches an npx lock entry adopts that entry's origin; local
 * / no-match / non-URL entries stay null; a sidecar wins over the
 * lockfile; and reconcile never writes the lockfile.
 */
describe("reconcileFoldersToManifest — npx-lock origin backfill", () => {
  function writeNpxLock(skills: Record<string, unknown>): string {
    const p = path.join(scratch, "npx-lock.json");
    fs.writeFileSync(p, JSON.stringify({ version: 3, skills }, null, 2));
    return p;
  }

  test("backfills origin for a url:null orphan matching an npx entry", () => {
    makeSkillFolder("personal", "qmk-keymap");
    const npxLockPath = writeNpxLock({
      "qmk-keymap": {
        source: "someone/keebs",
        sourceType: "github",
        sourceUrl: "https://github.com/someone/keebs",
        skillPath: "skills/qmk-keymap/SKILL.md",
        skillFolderHash: "deadbeef",
      },
    });
    reconcileFoldersToManifest(scratch, { npxLockPath });
    const row = byName(scratch, "qmk-keymap");
    expect(row.origin.url).toBe("https://github.com/someone/keebs");
    expect(row.origin.skillPath).toBe("skills/qmk-keymap/SKILL.md");
    expect(row.origin.hash).toBe("deadbeef");
  });

  test("a local-sourceType npx entry is not adopted (stays url:null)", () => {
    makeSkillFolder("personal", "scratch-skill");
    const npxLockPath = writeNpxLock({
      "scratch-skill": { sourceType: "local", sourceUrl: "" },
    });
    reconcileFoldersToManifest(scratch, { npxLockPath });
    expect(byName(scratch, "scratch-skill").origin).toEqual({ url: null });
  });

  test("adopts a non-GitHub sourceUrl (GitLab is a valid origin)", () => {
    makeSkillFolder("personal", "gl-skill");
    const npxLockPath = writeNpxLock({
      "gl-skill": {
        sourceType: "github",
        sourceUrl: "https://gitlab.com/group/repo",
      },
    });
    reconcileFoldersToManifest(scratch, { npxLockPath });
    expect(byName(scratch, "gl-skill").origin.url).toBe(
      "https://gitlab.com/group/repo",
    );
  });

  test("no matching npx entry leaves the row url:null", () => {
    makeSkillFolder("personal", "unmatched");
    const npxLockPath = writeNpxLock({
      "some-other-skill": {
        sourceType: "github",
        sourceUrl: "https://github.com/x/y",
      },
    });
    reconcileFoldersToManifest(scratch, { npxLockPath });
    expect(byName(scratch, "unmatched").origin).toEqual({ url: null });
  });

  test("an in-folder sidecar takes precedence over the npx lockfile", () => {
    makeSkillFolder("vendored", "dual", {
      origin: { kind: "github", sourceUrl: "https://github.com/from/sidecar" },
    });
    const npxLockPath = writeNpxLock({
      dual: { sourceType: "github", sourceUrl: "https://github.com/from/npx" },
    });
    reconcileFoldersToManifest(scratch, { npxLockPath });
    expect(byName(scratch, "dual").origin.url).toBe(
      "https://github.com/from/sidecar",
    );
  });

  test("reconcile never writes the npx lockfile (read-only invariant)", () => {
    makeSkillFolder("personal", "qmk-keymap");
    const npxLockPath = writeNpxLock({
      "qmk-keymap": {
        sourceType: "github",
        sourceUrl: "https://github.com/someone/keebs",
      },
    });
    const before = fs.readFileSync(npxLockPath, "utf8");
    reconcileFoldersToManifest(scratch, { npxLockPath });
    expect(fs.readFileSync(npxLockPath, "utf8")).toBe(before);
  });

  test("a missing npx lockfile is a no-op, not an error", () => {
    makeSkillFolder("personal", "solo");
    const npxLockPath = path.join(scratch, "does-not-exist.json");
    expect(() =>
      reconcileFoldersToManifest(scratch, { npxLockPath }),
    ).not.toThrow();
    expect(byName(scratch, "solo").origin).toEqual({ url: null });
  });
});

/**
 * #205 — bucket-placement drift correction. A row's folder should live in
 * bucketForOrigin(origin.url, linkedRepo); existing rows can drift out of
 * sync with a real origin (e.g. registered before the derivation was wired
 * correctly). Reconcile heals this on every pass, scoped to rows with a
 * known (non-null) origin — url:null placement is left untouched.
 */
describe("reconcileFoldersToManifest — bucket-placement drift", () => {
  test("moves an externally-originated skill out of personal/ into vendored/", () => {
    makeSkillFolder("personal", "misplaced-vendor");
    writeLiveManifest(scratch, {
      schemaVersion: 6,
      skills: [
        {
          name: "misplaced-vendor",
          origin: { url: "https://github.com/someone/upstream" },
          category: null,
          tags: [],
        },
      ],
    });
    reconcile(scratch);
    expect(
      fs.existsSync(
        path.join(scratch, "skills", "vendored", "misplaced-vendor"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(scratch, "skills", "personal", "misplaced-vendor"),
      ),
    ).toBe(false);
  });

  test("moves a self-originated skill out of vendored/ into personal/", () => {
    makeSkillFolder("vendored", "misplaced-personal");
    writeLiveManifest(scratch, {
      schemaVersion: 6,
      skills: [
        {
          name: "misplaced-personal",
          origin: { url: "https://github.com/Tyler-Reagan/skills" },
          category: null,
          tags: [],
        },
      ],
    });
    reconcile(scratch, { linkedRepo: "Tyler-Reagan/skills" });
    expect(
      fs.existsSync(
        path.join(scratch, "skills", "personal", "misplaced-personal"),
      ),
    ).toBe(true);
  });

  test("a url:null folder's bucket is left untouched even if it looks misplaced", () => {
    makeSkillFolder("vendored", "hand-copied");
    reconcile(scratch);
    expect(
      fs.existsSync(path.join(scratch, "skills", "vendored", "hand-copied")),
    ).toBe(true);
    expect(byName(scratch, "hand-copied").origin).toEqual({ url: null });
  });

  test("a correctly-placed externally-originated skill is left alone", () => {
    makeSkillFolder("vendored", "already-right");
    writeLiveManifest(scratch, {
      schemaVersion: 6,
      skills: [
        {
          name: "already-right",
          origin: { url: "https://github.com/someone/upstream" },
          category: null,
          tags: [],
        },
      ],
    });
    reconcile(scratch);
    expect(
      fs.existsSync(path.join(scratch, "skills", "vendored", "already-right")),
    ).toBe(true);
  });
});

/**
 * #204 — dead state file sweep. `external.json` (retired by ADR-0022)
 * and `upstream-canon.json` (predates ADR-0017's canon removal) are
 * confirmed dead: nothing reads or writes them anymore. Reconcile
 * opportunistically deletes pre-existing copies; a registry that never
 * had them is unaffected.
 */
describe("reconcileFoldersToManifest — dead state file sweep", () => {
  function stateDir(root: string): string {
    return path.join(root, ".skills-bank");
  }

  test("deletes a pre-existing external.json", () => {
    fs.mkdirSync(stateDir(scratch), { recursive: true });
    fs.writeFileSync(path.join(stateDir(scratch), "external.json"), "[]");
    reconcile(scratch);
    expect(fs.existsSync(path.join(stateDir(scratch), "external.json"))).toBe(
      false,
    );
  });

  test("deletes a pre-existing upstream-canon.json", () => {
    fs.mkdirSync(stateDir(scratch), { recursive: true });
    fs.writeFileSync(path.join(stateDir(scratch), "upstream-canon.json"), "{}");
    reconcile(scratch);
    expect(
      fs.existsSync(path.join(stateDir(scratch), "upstream-canon.json")),
    ).toBe(false);
  });

  test("is a no-op when neither file exists", () => {
    expect(() => reconcile(scratch)).not.toThrow();
  });

  test("leaves other state files untouched", () => {
    fs.mkdirSync(stateDir(scratch), { recursive: true });
    fs.writeFileSync(path.join(stateDir(scratch), "runtime.json"), "{}");
    reconcile(scratch);
    expect(fs.existsSync(path.join(stateDir(scratch), "runtime.json"))).toBe(
      true,
    );
  });
});
