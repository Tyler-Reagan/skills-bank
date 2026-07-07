import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  coerceManifestToCurrent,
  exportRegistryManifest,
  serializeManifest,
  writeRegistrySnapshot,
  readLiveManifest,
  writeLiveManifest,
  MANIFEST_SCHEMA_VERSION,
  type RegistryManifest,
} from "../manifest.js";
import { importRegistryManifest, computeManifestRemovals } from "../import.js";
import { hashSkillFolder } from "../../registry/heal.js";
import { setRuntimeEntry } from "../../registry/runtime-map.js";
import { buildRegistryIndex } from "../../registry/build.js";

/**
 * v6 manifest contract:
 *   - export is a pure read of the live manifest, refreshed with the
 *     current labels.json — origin is carried verbatim, never
 *     re-derived.
 *   - import mirrors content via installSkillFiles for new entries,
 *     restores label overrides, surfaces origin collisions.
 *   - snapshot writer rotates to last N by mtime.
 *
 * Each test runs against a scratch registry root under os.tmpdir() and
 * forces SKILLS_BANK_HOME_OVERRIDE so agent-dir scans land in the
 * scratch tree instead of the dev's real ~/.claude/skills.
 */

let scratch: string;
let registryRoot: string;
let fakeHome: string;
const originalHomeOverride = process.env["SKILLS_BANK_HOME_OVERRIDE"];

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-manifest-"));
  registryRoot = path.join(scratch, "registry");
  fakeHome = path.join(scratch, "home");
  fs.mkdirSync(path.join(registryRoot, "skills", "personal"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(registryRoot, "skills", "vendored"), {
    recursive: true,
  });
  fs.mkdirSync(fakeHome, { recursive: true });
  process.env["SKILLS_BANK_HOME_OVERRIDE"] = fakeHome;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalHomeOverride === undefined) {
    delete process.env["SKILLS_BANK_HOME_OVERRIDE"];
  } else {
    process.env["SKILLS_BANK_HOME_OVERRIDE"] = originalHomeOverride;
  }
  fs.rmSync(scratch, { recursive: true, force: true });
});

/** Write a skill folder on disk, and optionally a matching manifest row. */
function writeSkill(
  bucket: "personal" | "vendored",
  name: string,
  opts: {
    description?: string;
    tags?: string[];
    origin?: { url: string | null; skillPath?: string; hash?: string };
    category?: string | null;
  } = {},
): string {
  const dir = path.join(registryRoot, "skills", bucket, name);
  fs.mkdirSync(dir, { recursive: true });
  const tagLine =
    opts.tags && opts.tags.length > 0
      ? `tags: [${opts.tags.join(", ")}]\n`
      : "";
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${opts.description ?? "test skill"}\n${tagLine}---\n# ${name}\n`,
  );
  const manifest = readLiveManifest(registryRoot);
  manifest.skills.push({
    name,
    origin: opts.origin ?? { url: null },
    category: opts.category ?? null,
    tags: opts.tags ?? [],
  });
  writeLiveManifest(registryRoot, manifest);
  return dir;
}

function makeTreeResponse(folder: string): Response {
  const body = JSON.stringify({
    sha: "rootsha",
    tree: [
      { path: folder, mode: "040000", type: "tree", sha: "foldersha" },
      {
        path: `${folder}/SKILL.md`,
        mode: "100644",
        type: "blob",
        sha: "blob1",
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
  return new Response(
    JSON.stringify({
      encoding: "base64",
      content: Buffer.from(content).toString("base64"),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("exportRegistryManifest", () => {
  test("empty registry → schemaVersion 6, no skills", () => {
    const m = exportRegistryManifest(registryRoot);
    expect(m.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(m.skills).toEqual([]);
  });

  test("keeps a local-only (url: null) skill in the live export", () => {
    // url: null is a valid resting state ("local skill, no remote") —
    // exportRegistryManifest is the live export and does not filter it
    // out. Filtering to the pushed form is toPushedProjection's job.
    writeSkill("vendored", "kept", {
      origin: {
        url: "https://github.com/owner/repo",
        skillPath: "skills/kept/SKILL.md",
      },
    });
    writeSkill("personal", "detached", { origin: { url: null } });

    const m = exportRegistryManifest(registryRoot);
    const names = m.skills.map((s) => s.name);
    expect(names).toContain("kept");
    expect(names).toContain("detached");
  });

  test("carries origin verbatim and refreshes labels from labels.json", () => {
    writeSkill("personal", "alpha", { description: "a react component skill" });
    writeSkill("vendored", "beta", {
      origin: {
        url: "https://github.com/owner/repo",
        skillPath: "skills/beta/SKILL.md",
        hash: "deadbeef",
      },
    });

    const m = exportRegistryManifest(registryRoot, {
      labels: { alpha: { tags: ["custom"] } },
    });
    expect(m.skills.map((s) => s.name).sort()).toEqual(["alpha", "beta"]);

    const alpha = m.skills.find((s) => s.name === "alpha")!;
    expect(alpha.origin).toEqual({ url: null });
    expect(alpha.category).toBeNull();
    expect(alpha.tags).toEqual(["custom"]);

    const beta = m.skills.find((s) => s.name === "beta")!;
    expect(beta.origin).toEqual({
      url: "https://github.com/owner/repo",
      skillPath: "skills/beta/SKILL.md",
      hash: "deadbeef",
    });
  });

  test("does not synthesize origin for a local skill (reconcileFoldersToManifest's job)", () => {
    // exportRegistryManifest is a pure read of the live manifest; it
    // never re-derives origin from the folder path or a linked repo.
    // A folder with no manifest row simply doesn't appear until
    // reconcileFoldersToManifest adds a url:null row for it.
    fs.mkdirSync(path.join(registryRoot, "skills", "personal", "mine"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(registryRoot, "skills", "personal", "mine", "SKILL.md"),
      "---\nname: mine\ndescription: my own skill\n---\n",
    );
    const m = exportRegistryManifest(registryRoot);
    expect(m.skills.find((s) => s.name === "mine")).toBeUndefined();
  });

  test("carries a real self-origin marker through verbatim", () => {
    writeSkill("personal", "mine", {
      description: "my own skill",
      origin: {
        url: "https://github.com/Tyler-Reagan/skills",
        skillPath: "skills/tools/mine/SKILL.md",
      },
    });

    const m = exportRegistryManifest(registryRoot);
    const mine = m.skills.find((s) => s.name === "mine")!;
    expect(mine.origin).toEqual({
      url: "https://github.com/Tyler-Reagan/skills",
      skillPath: "skills/tools/mine/SKILL.md",
    });
  });
});

describe("toPushedProjection / bucketForManifestSkill", () => {
  test("drops url:null rows from the pushed projection", async () => {
    const { toPushedProjection } = await import("../manifest.js");
    writeSkill("personal", "local-only", { origin: { url: null } });
    writeSkill("vendored", "remote", {
      origin: {
        url: "https://github.com/owner/repo",
        skillPath: "skills/remote/SKILL.md",
      },
    });
    const live = exportRegistryManifest(registryRoot);
    const pushed = toPushedProjection(live);
    expect(pushed.skills.map((s) => s.name)).toEqual(["remote"]);
  });
});

describe("importRegistryManifest", () => {
  test("registers a new skill by mirroring from GitHub origin", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) return makeTreeResponse("skills/alpha");
        if (call === 2) return makeBlobResponse("# alpha imported");
        throw new Error(`unexpected call #${call}`);
      }),
    );

    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      skills: [
        {
          name: "alpha",
          origin: {
            url: "https://github.com/owner/repo",
            skillPath: "skills/alpha/SKILL.md",
          },
          tags: ["restored-tag"],
          category: null,
        },
      ],
    };

    const result = await importRegistryManifest(registryRoot, manifest);
    expect(result.outcomes).toEqual([{ name: "alpha", result: "registered" }]);

    // No linkedRepo supplied → an external GitHub origin lands in vendored/.
    const destDir = path.join(registryRoot, "skills", "vendored", "alpha");
    expect(fs.readFileSync(path.join(destDir, "SKILL.md"), "utf8")).toBe(
      "# alpha imported",
    );
    // Labels live in labels.json, not on disk — the user's tag delta is
    // surfaced as a reconstructed override for the caller.
    expect(result.restoredLabels?.["alpha"]).toEqual({
      tags: ["restored-tag"],
    });
    // Manifest row stamped with the mirrored folder hash.
    const live = readLiveManifest(registryRoot);
    const row = live.skills.find((s) => s.name === "alpha")!;
    expect(row.origin.url).toBe("https://github.com/owner/repo");
    expect(row.origin.hash).toBe("foldersha");
    // Runtime map's synced hash baselined with the local SHA-256 (not the
    // GitHub tree SHA-1) so drift detection starts clean.
    const expectedLocalHash = hashSkillFolder(destDir);
    expect(expectedLocalHash).not.toBeNull();
  });

  test("reads metadata from mirrored SKILL.md frontmatter", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) return makeTreeResponse("skills/described");
        if (call === 2)
          return makeBlobResponse(
            "---\nname: described\ndescription: A skill whose description lives in SKILL.md frontmatter only\nversion: 1.2.3\nauthor: Test Author\n---\n# described\n",
          );
        throw new Error(`unexpected call #${call}`);
      }),
    );

    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      skills: [
        {
          name: "described",
          origin: {
            url: "https://github.com/owner/repo",
            skillPath: "skills/described/SKILL.md",
          },
          tags: [],
          category: null,
        },
      ],
    };

    const result = await importRegistryManifest(registryRoot, manifest);
    expect(result.outcomes).toEqual([
      { name: "described", result: "registered" },
    ]);

    const entry = buildRegistryIndex(registryRoot).entries.find(
      (e) => e.name === "described",
    )!;
    expect(entry.description).toBe(
      "A skill whose description lives in SKILL.md frontmatter only",
    );
    expect(entry.version).toBe("1.2.3");
    expect(entry.author).toBe("Test Author");
  });

  test("places an external-origin skill in skills/vendored/", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) return makeTreeResponse("skills/beta");
        if (call === 2) return makeBlobResponse("# beta");
        throw new Error(`unexpected call #${call}`);
      }),
    );

    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      skills: [
        {
          name: "beta",
          origin: {
            url: "https://github.com/owner/repo",
            skillPath: "skills/beta/SKILL.md",
          },
          tags: [],
          category: null,
        },
      ],
    };

    await importRegistryManifest(registryRoot, manifest, {
      linkedRepo: "someone/else",
    });
    expect(
      fs.existsSync(path.join(registryRoot, "skills", "vendored", "beta")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(registryRoot, "skills", "personal", "beta")),
    ).toBe(false);
  });

  test("places a self-origin skill in skills/personal/", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) return makeTreeResponse("skills/mine");
        if (call === 2) return makeBlobResponse("# mine");
        throw new Error(`unexpected call #${call}`);
      }),
    );

    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      skills: [
        {
          name: "mine",
          origin: {
            url: "https://github.com/Me/skills",
            skillPath: "skills/mine/SKILL.md",
          },
          tags: [],
          category: null,
        },
      ],
    };

    await importRegistryManifest(registryRoot, manifest, {
      linkedRepo: "Me/skills",
    });
    expect(
      fs.existsSync(path.join(registryRoot, "skills", "personal", "mine")),
    ).toBe(true);
  });

  test("surfaces origin-unreachable when manifest origin has no GitHub pointer", async () => {
    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      skills: [
        {
          name: "ghost",
          origin: { url: null },
          tags: [],
          category: null,
        },
      ],
    };
    const result = await importRegistryManifest(registryRoot, manifest);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]!.result).toBe("origin-unreachable");
  });

  test("same-origin existing skill returns `registered`, recovers label override", async () => {
    writeSkill("vendored", "gamma", {
      description: "gamma helper",
      origin: {
        url: "https://github.com/owner/repo",
        skillPath: "skills/gamma/SKILL.md",
      },
    });

    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      skills: [
        {
          name: "gamma",
          origin: {
            url: "https://github.com/owner/repo",
            skillPath: "skills/gamma/SKILL.md",
          },
          tags: ["t1"],
          category: null,
        },
      ],
    };

    const result = await importRegistryManifest(registryRoot, manifest);
    expect(result.outcomes).toEqual([{ name: "gamma", result: "registered" }]);
    expect(result.restoredLabels?.["gamma"]).toEqual({ tags: ["t1"] });
  });

  test("surfaces collision when local origin differs from manifest", async () => {
    writeSkill("vendored", "delta", {
      origin: {
        url: "https://github.com/other/repo",
        skillPath: "skills/delta/SKILL.md",
      },
    });

    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      skills: [
        {
          name: "delta",
          origin: {
            url: "https://github.com/owner/repo",
            skillPath: "skills/delta/SKILL.md",
          },
          tags: [],
          category: null,
        },
      ],
    };

    const result = await importRegistryManifest(registryRoot, manifest);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]!.result).toBe("collision");
    if (result.outcomes[0]!.result === "collision") {
      expect(result.outcomes[0]!.existingOrigin.url).toBe(
        "https://github.com/other/repo",
      );
    }
  });

  test("pre-aborted signal exits the loop before any iteration", async () => {
    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      skills: [
        {
          name: "alpha",
          origin: {
            url: "https://github.com/owner/repo",
            skillPath: "skills/alpha/SKILL.md",
          },
          tags: [],
          category: null,
        },
        {
          name: "beta",
          origin: {
            url: "https://github.com/owner/repo",
            skillPath: "skills/beta/SKILL.md",
          },
          tags: [],
          category: null,
        },
        {
          name: "gamma",
          origin: {
            url: "https://github.com/owner/repo",
            skillPath: "skills/gamma/SKILL.md",
          },
          tags: [],
          category: null,
        },
      ],
    };
    const controller = new AbortController();
    controller.abort();
    const result = await importRegistryManifest(registryRoot, manifest, {
      signal: controller.signal,
    });
    expect(result.cancelled).toBe(true);
    expect(result.outcomes).toEqual([]);
    // Nothing mirrored.
    expect(
      fs.existsSync(path.join(registryRoot, "skills", "personal", "alpha")),
    ).toBe(false);
  });

  test("onProgress fires per iteration with cumulative counts and the name list on first call", async () => {
    // Sources are local-only skills that already exist (no GitHub
    // mirroring) so the test runs pure in-process.
    writeSkill("personal", "alpha");
    writeSkill("personal", "beta");
    writeSkill("personal", "gamma");
    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      skills: [
        { name: "alpha", origin: { url: null }, tags: [], category: null },
        { name: "beta", origin: { url: null }, tags: [], category: null },
        { name: "gamma", origin: { url: null }, tags: [], category: null },
      ],
    };
    const events: Array<{
      completed: number;
      total: number;
      currentName: string;
      names?: string[];
    }> = [];
    await importRegistryManifest(registryRoot, manifest, {
      onProgress: (e) => {
        events.push({
          completed: e.completed,
          total: e.total,
          currentName: e.currentName,
          ...(e.manifestNames ? { names: e.manifestNames } : {}),
        });
      },
    });
    // Three per-iteration events + one terminal = 4
    expect(events).toHaveLength(4);
    expect(events[0]).toEqual({
      completed: 0,
      total: 3,
      currentName: "alpha",
      names: ["alpha", "beta", "gamma"],
    });
    expect(events[1]).toEqual({
      completed: 1,
      total: 3,
      currentName: "beta",
    });
    expect(events[2]).toEqual({
      completed: 2,
      total: 3,
      currentName: "gamma",
    });
    // Terminal: completed === total, currentName = last processed
    expect(events[3]).toEqual({
      completed: 3,
      total: 3,
      currentName: "gamma",
    });
  });

  test("confirmed-removal arm deletes named local skills after the additive pass", async () => {
    writeSkill("personal", "keep");
    writeSkill("personal", "drop");
    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      skills: [
        { name: "keep", origin: { url: null }, tags: [], category: null },
      ],
    };
    const result = await importRegistryManifest(registryRoot, manifest, {
      removeNames: ["drop"],
    });
    expect(result.removed).toEqual([
      { name: "drop", ok: true, message: expect.any(String) },
    ]);
    expect(
      fs.existsSync(path.join(registryRoot, "skills", "personal", "keep")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(registryRoot, "skills", "personal", "drop")),
    ).toBe(false);
  });

  test("confirmed-removal of an already-absent skill is a no-op success", async () => {
    const result = await importRegistryManifest(
      registryRoot,
      {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        skills: [],
      } satisfies RegistryManifest,
      { removeNames: ["ghost"] },
    );
    expect(result.removed).toEqual([
      { name: "ghost", ok: true, message: "ghost not in registry" },
    ]);
  });

  test("omitting removeNames leaves the import purely additive (no removed field)", async () => {
    writeSkill("personal", "stays");
    const result = await importRegistryManifest(registryRoot, {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      skills: [],
    } satisfies RegistryManifest);
    expect(result.removed).toBeUndefined();
    expect(
      fs.existsSync(path.join(registryRoot, "skills", "personal", "stays")),
    ).toBe(true);
  });
});

describe("writeRegistrySnapshot", () => {
  test("writes a snapshot file and reports its path", () => {
    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      skills: [],
    };
    const result = writeRegistrySnapshot({
      userDataDir: scratch,
      manifest,
    });
    expect(result.ok).toBe(true);
    expect(result.path).toBeDefined();
    expect(fs.existsSync(result.path!)).toBe(true);
  });

  test("retains the most recent N snapshots, drops older ones", () => {
    const dir = path.join(scratch, "registry-snapshots");
    fs.mkdirSync(dir, { recursive: true });
    // Pre-populate with 6 older snapshots staggered in mtime.
    for (let i = 0; i < 6; i++) {
      const p = path.join(dir, `snapshot-old-${i}.json`);
      fs.writeFileSync(p, "{}");
      const t = (Date.now() - (10 - i) * 1000) / 1000;
      fs.utimesSync(p, t, t);
    }
    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      skills: [],
    };
    const result = writeRegistrySnapshot({
      userDataDir: scratch,
      manifest,
      keep: 3,
    });
    expect(result.ok).toBe(true);
    const remaining = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith("snapshot-"));
    expect(remaining.length).toBe(3);
  });
});

describe("coerceManifestToCurrent", () => {
  test("v6 manifest with a full row round-trips its fields", () => {
    const v6 = {
      schemaVersion: 6 as const,
      skills: [
        {
          name: "alpha",
          origin: {
            url: "https://github.com/kostja94/marketing-skills",
            skillPath: "skills/alpha/SKILL.md",
            hash: "deadbeef",
          },
          tags: ["t1"],
          category: "frontend",
        },
        {
          name: "beta",
          origin: { url: null },
          tags: [],
          category: null,
        },
      ],
    };
    const coerced = coerceManifestToCurrent(v6);
    expect(coerced.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(coerced.skills[0]!.origin.url).toBe(
      "https://github.com/kostja94/marketing-skills",
    );
    expect(coerced.skills[0]!.tags).toEqual(["t1"]);
    expect(coerced.skills[1]!.origin).toEqual({ url: null });
  });

  test("strips a trailing .git from origin.url so groups collapse", () => {
    const coerced = coerceManifestToCurrent({
      schemaVersion: 6 as const,
      skills: [
        {
          name: "alpha",
          origin: { url: "https://github.com/Tyler-Reagan/skills.git" },
          tags: [],
          category: null,
        },
        {
          name: "beta",
          origin: { url: "https://github.com/Tyler-Reagan/skills" },
          tags: [],
          category: null,
        },
      ],
    });
    expect(coerced.skills[0]!.origin.url).toBe(
      "https://github.com/Tyler-Reagan/skills",
    );
    expect(coerced.skills[0]!.origin.url).toBe(coerced.skills[1]!.origin.url);
  });

  test("fills per-skill defaults for a sparse row", () => {
    const sparse = {
      schemaVersion: 6 as const,
      skills: [{ name: "alpha" }],
    };
    const coerced = coerceManifestToCurrent(sparse);
    expect(coerced.skills[0]).toEqual({
      name: "alpha",
      origin: { url: null },
      category: null,
      tags: [],
    });
  });

  test("rejects a v5-and-earlier manifest — no legacy coercion", () => {
    expect(() =>
      coerceManifestToCurrent({
        schemaVersion: 5,
        exportedAt: "2026-05-20T00:00:00Z",
        sourceBankVersion: "1.17.0",
        skills: [],
      }),
    ).toThrow(/unsupported schemaVersion 5/);
  });

  test("rejects unsupported schemaVersion", () => {
    expect(() =>
      coerceManifestToCurrent({ schemaVersion: 1, skills: [] }),
    ).toThrow(/unsupported schemaVersion 1/);
  });

  test("rejects a non-object input", () => {
    expect(() => coerceManifestToCurrent(null)).toThrow(/not an object/);
  });

  test("rejects a manifest with a missing skills array", () => {
    expect(() => coerceManifestToCurrent({ schemaVersion: 6 })).toThrow(
      /missing skills array/,
    );
  });
});

describe("serializeManifest", () => {
  function sample(): RegistryManifest {
    return {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      skills: [
        {
          name: "zeta",
          origin: { url: null },
          tags: ["b", "a"],
          category: "frontend",
        },
        {
          name: "alpha",
          origin: {
            url: "https://github.com/owner/repo",
            skillPath: "skills/alpha/SKILL.md",
            hash: "deadbeef",
          },
          tags: [],
          category: null,
        },
        {
          name: "local-only",
          origin: { url: null },
          tags: [],
          category: null,
        },
      ],
    };
  }

  test("drops url:null rows (pushed projection) and sorts remaining skills by name", () => {
    const parsed = JSON.parse(serializeManifest(sample())) as Record<
      string,
      unknown
    >;
    expect(parsed["schemaVersion"]).toBe(MANIFEST_SCHEMA_VERSION);
    const skills = parsed["skills"] as Record<string, unknown>[];
    expect(skills.map((s) => s["name"])).toEqual(["alpha"]);
  });

  test("emits stable per-skill key order and a trailing newline", () => {
    // Use only url-bearing skills so the pushed projection isn't empty.
    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      skills: [
        {
          name: "alpha",
          origin: {
            url: "https://github.com/owner/repo",
            skillPath: "skills/alpha/SKILL.md",
            hash: "deadbeef",
          },
          category: "frontend",
          tags: ["b", "a"],
        },
      ],
    };
    const text = serializeManifest(manifest);
    expect(text.endsWith("\n")).toBe(true);
    const alphaKeys = Object.keys(
      (JSON.parse(text)["skills"] as Record<string, unknown>[])[0]!,
    );
    expect(alphaKeys).toEqual(["name", "origin", "category", "tags"]);
  });

  test("round-trip stable: serialize == serialize∘coerce∘parse∘serialize", () => {
    const once = serializeManifest(sample());
    const twice = serializeManifest(
      coerceManifestToCurrent(JSON.parse(once) as unknown),
    );
    expect(twice).toBe(once);
  });
});

describe("serializeLiveManifest vs serializeManifest", () => {
  test("live manifest keeps url:null rows; pushed form drops them", async () => {
    const { serializeLiveManifest } = await import("../manifest.js");
    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      skills: [
        { name: "local-only", origin: { url: null }, category: null, tags: [] },
      ],
    };
    const live = JSON.parse(serializeLiveManifest(manifest)) as {
      skills: unknown[];
    };
    expect(live.skills).toHaveLength(1);

    const pushed = JSON.parse(serializeManifest(manifest)) as {
      skills: unknown[];
    };
    expect(pushed.skills).toHaveLength(0);
  });
});

describe("computeManifestRemovals (reads the live manifest)", () => {
  // computeManifestRemovals diffs against the PUSHED projection, so only
  // URL-bearing (non-local-only) skills are eligible removal candidates.
  function urlOrigin(name: string): { url: string; skillPath: string } {
    return {
      url: "https://github.com/owner/repo",
      skillPath: `skills/${name}/SKILL.md`,
    };
  }

  test("returns local names absent from the pushed projection of the target manifest", () => {
    writeSkill("vendored", "a", { origin: urlOrigin("a") });
    writeSkill("vendored", "b", { origin: urlOrigin("b") });
    writeSkill("vendored", "c", { origin: urlOrigin("c") });
    const target: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      skills: [
        { name: "a", origin: { url: null }, category: null, tags: [] },
        { name: "c", origin: { url: null }, category: null, tags: [] },
      ],
    };
    expect(computeManifestRemovals(registryRoot, target)).toEqual(["b"]);
  });

  test("empty when every local skill is still listed", () => {
    writeSkill("vendored", "a", { origin: urlOrigin("a") });
    writeSkill("vendored", "b", { origin: urlOrigin("b") });
    const target: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      skills: [
        { name: "a", origin: { url: null }, category: null, tags: [] },
        { name: "b", origin: { url: null }, category: null, tags: [] },
      ],
    };
    expect(computeManifestRemovals(registryRoot, target)).toEqual([]);
  });

  test("empty target manifest ⇒ every local skill with a URL is a removal candidate", () => {
    writeSkill("vendored", "a", {
      origin: {
        url: "https://github.com/owner/repo",
        skillPath: "skills/a/SKILL.md",
      },
    });
    writeSkill("vendored", "b", {
      origin: {
        url: "https://github.com/owner/repo",
        skillPath: "skills/b/SKILL.md",
      },
    });
    const empty: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      skills: [],
    };
    expect(computeManifestRemovals(registryRoot, empty).sort()).toEqual([
      "a",
      "b",
    ]);
  });

  test("a local-only (url: null) skill is immune — never flagged for removal", () => {
    // Structural guarantee of the pushed-projection diff basis: a
    // local-only skill never appears in a pushed manifest to begin
    // with, so it can never read as "deleted upstream."
    writeSkill("personal", "local-only", { origin: { url: null } });
    const empty: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      skills: [],
    };
    expect(computeManifestRemovals(registryRoot, empty)).toEqual([]);
  });
});

describe("importRegistryManifest — v6-only rejects legacy input", () => {
  test("a v5 manifest is rejected, not silently coerced", async () => {
    const v5ish = {
      schemaVersion: 5,
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.2.0",
      skills: [],
    };
    await expect(importRegistryManifest(registryRoot, v5ish)).rejects.toThrow(
      /unsupported schemaVersion 5/,
    );
  });
});

describe("detach then re-detect via runtime map", () => {
  test("setRuntimeEntry / manifest writes compose cleanly for a mirrored skill", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) return makeTreeResponse("skills/kappa");
        if (call === 2) return makeBlobResponse("# kappa");
        throw new Error(`unexpected call #${call}`);
      }),
    );

    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      skills: [
        {
          name: "kappa",
          origin: {
            url: "https://github.com/owner/repo",
            skillPath: "skills/kappa/SKILL.md",
          },
          tags: [],
          category: null,
        },
      ],
    };

    await importRegistryManifest(registryRoot, manifest, {
      linkedRepo: "someone/else",
    });
    const live = readLiveManifest(registryRoot);
    const row = live.skills.find((s) => s.name === "kappa")!;
    expect(row.origin.url).toBe("https://github.com/owner/repo");
    expect(
      fs.existsSync(path.join(registryRoot, "skills", "vendored", "kappa")),
    ).toBe(true);

    // Rebaselining the runtime entry directly composes fine with the
    // manifest write the import already performed.
    setRuntimeEntry(registryRoot, "kappa", { syncedHash: "rebaselined" });
  });
});
