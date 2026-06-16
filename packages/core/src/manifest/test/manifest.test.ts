import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  coerceManifestToCurrent,
  exportRegistryManifest,
  serializeManifest,
  stampOriginMarker,
  writeRegistrySnapshot,
  MANIFEST_SCHEMA_VERSION,
  type ManifestSkill,
  type RegistryManifest,
} from "../manifest.js";
import { importRegistryManifest, computeManifestRemovals } from "../import.js";
import { readSkillSource, writeSkillSource } from "../../registry/source.js";
import { hashSkillFolder, writeSyncedHash } from "../../registry/heal.js";
import { buildRegistryIndex } from "../../registry/build.js";
import { writeExternalRegistry } from "../../registry/external.js";

/**
 * Phase 1 manifest contract:
 *   - export is pure read, captures source axis + origin pointer +
 *     tags + hide state + installed-agent map.
 *   - import mirrors content via installSkillFiles for new entries,
 *     restores aux state, surfaces origin collisions.
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

function writeSkill(
  bucket: "personal" | "vendored",
  name: string,
  opts: {
    description?: string;
    tags?: string[];
    source?: "curated" | "user";
    origin?: { repo: string; skillPath: string; skillFolderHash?: string };
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
  const meta: Record<string, unknown> = {
    name,
    description: opts.description ?? "test skill",
  };
  if (opts.tags) meta["tags"] = opts.tags;
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  if (opts.source || opts.origin) {
    writeSkillSource(dir, {
      source: opts.source ?? "user",
      ...(opts.origin
        ? {
            origin: {
              kind: "github",
              repo: opts.origin.repo,
              skillPath: opts.origin.skillPath,
              ...(opts.origin.skillFolderHash
                ? { skillFolderHash: opts.origin.skillFolderHash }
                : {}),
            },
          }
        : {}),
    });
  }
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
  test("captures schemaVersion, version, and an empty registry", () => {
    const m = exportRegistryManifest(registryRoot, {
      sourceBankVersion: "1.1.0",
    });
    expect(m.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(m.sourceBankVersion).toBe("1.1.0");
    expect(m.skills).toEqual([]);
    expect(typeof m.exportedAt).toBe("string");
  });

  test("records source, origin, derived bucket, and effective labels", () => {
    writeSkill("personal", "alpha", { description: "a react component skill" });
    writeSkill("vendored", "beta", {
      source: "curated",
      origin: {
        repo: "owner/repo",
        skillPath: "skills/beta/SKILL.md",
        skillFolderHash: "deadbeef",
      },
    });

    const m = exportRegistryManifest(registryRoot, {
      sourceBankVersion: "1.1.0",
      registryRootLabel: "Tyler-Reagan/skills",
      labels: { alpha: { tags: ["custom"] } },
    });
    expect(m.registryRoot).toBe("Tyler-Reagan/skills");
    expect(m.skills.map((s) => s.name).sort()).toEqual(["alpha", "beta"]);

    const alpha = m.skills.find((s) => s.name === "alpha")!;
    expect(alpha.source).toBe("user");
    expect(alpha.origin).toEqual({ kind: "none" });
    // No external origin → personal.
    expect(alpha.bucket).toBe("personal");
    // Effective labels = stored override only; no auto-derivation at export.
    expect(alpha.category).toBeNull();
    expect(alpha.tags).toEqual(["custom"]);

    const beta = m.skills.find((s) => s.name === "beta")!;
    expect(beta.source).toBe("curated");
    // External GitHub origin → vendored.
    expect(beta.bucket).toBe("vendored");
    expect(beta.origin).toEqual({
      kind: "github",
      repo: "owner/repo",
      skillPath: "skills/beta/SKILL.md",
      skillFolderHash: "deadbeef",
    });
  });

  test("synthesizes a self-origin from the in-registry path when a repo is linked", () => {
    writeSkill("personal", "mine", { description: "my own skill" });

    const m = exportRegistryManifest(registryRoot, {
      sourceBankVersion: "1.1.0",
      registryRootLabel: "Tyler-Reagan/skills",
      linkedRepo: "Tyler-Reagan/skills",
    });
    const mine = m.skills.find((s) => s.name === "mine")!;
    expect(mine.origin).toEqual({
      kind: "github",
      repo: "Tyler-Reagan/skills",
      skillPath: "skills/personal/mine/SKILL.md",
    });
    // A self-origin is NOT external → personal bucket.
    expect(mine.bucket).toBe("personal");
  });

  test("leaves origin `none` for an authored skill when no repo is linked", () => {
    writeSkill("personal", "local-only", { description: "never pushed" });

    const m = exportRegistryManifest(registryRoot, {
      sourceBankVersion: "1.1.0",
    });
    const skill = m.skills.find((s) => s.name === "local-only")!;
    expect(skill.origin).toEqual({ kind: "none" });
    expect(skill.bucket).toBe("personal");
  });

  test("excludes in-place (adopted:false) entries from the pushed manifest", () => {
    // An adopted (in-bank) skill — must travel.
    writeSkill("personal", "in-bank", { description: "lives in the bank" });

    // An in-place skill registered from a custom dir: real files outside
    // the registry, recorded via external.json (adopted:false). These are
    // local-only — a non-egressable work repo must not leak into a pushed
    // manifest.
    const externalSrc = path.join(scratch, "work-repo", "keep-me");
    fs.mkdirSync(externalSrc, { recursive: true });
    fs.writeFileSync(
      path.join(externalSrc, "SKILL.md"),
      "---\nname: keep-me\ndescription: non-egressable\n---\n# keep-me\n",
    );
    writeExternalRegistry(registryRoot, "keep-me", externalSrc);

    // Sanity: the index DOES surface the in-place entry as adopted:false,
    // so the manifest filter (not a missing entry) is what excludes it.
    const indexed = buildRegistryIndex(registryRoot).entries.find(
      (e) => e.name === "keep-me",
    );
    expect(indexed?.adopted).toBe(false);

    const m = exportRegistryManifest(registryRoot, {
      sourceBankVersion: "1.1.0",
    });
    expect(m.skills.map((s) => s.name)).toEqual(["in-bank"]);
  });

  test("lastInstalledOn picks up symlinks under the fake agent dirs", () => {
    const dir = writeSkill("personal", "alpha");
    const claudeDir = path.join(fakeHome, ".claude", "skills");
    const cursorDir = path.join(fakeHome, ".cursor", "skills");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.symlinkSync(dir, path.join(claudeDir, "alpha"), "dir");
    fs.symlinkSync(dir, path.join(cursorDir, "alpha"), "dir");

    const m = exportRegistryManifest(registryRoot, {
      sourceBankVersion: "1.1.0",
    });
    const alpha = m.skills.find((s) => s.name === "alpha")!;
    expect(alpha.lastInstalledOn.sort()).toEqual(["claude", "cursor"]);
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
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.1.0",
      skills: [
        {
          name: "alpha",
          source: "user",
          bucket: "personal",
          origin: {
            kind: "github",
            repo: "owner/repo",
            skillPath: "skills/alpha/SKILL.md",
          },
          tags: ["restored-tag"],
          category: null,
          lastInstalledOn: [],
        },
      ],
    };

    const result = await importRegistryManifest(registryRoot, manifest);
    expect(result.outcomes).toEqual([{ name: "alpha", result: "registered" }]);

    const destDir = path.join(registryRoot, "skills", "personal", "alpha");
    expect(fs.readFileSync(path.join(destDir, "SKILL.md"), "utf8")).toBe(
      "# alpha imported",
    );
    // Labels are NOT written to meta.json (the import writes no meta.json
    // — SKILL.md frontmatter is authoritative). The user's tag delta is
    // surfaced as a reconstructed override for the caller's labels.json.
    expect(fs.existsSync(path.join(destDir, "meta.json"))).toBe(false);
    expect(result.restoredLabels?.["alpha"]).toEqual({
      tags: ["restored-tag"],
    });
    // Marker stamped with the mirrored folder hash.
    const marker = JSON.parse(
      fs.readFileSync(path.join(destDir, ".skills-bank.json"), "utf8"),
    ) as {
      source: string;
      origin?: { repo?: string; skillFolderHash?: string };
    };
    expect(marker.source).toBe("user");
    expect(marker.origin?.repo).toBe("owner/repo");
    expect(marker.origin?.skillFolderHash).toBe("foldersha");
    // Synced-hash sidecar baselined with the local SHA-256 (not the
    // GitHub tree SHA-1) so drift detection starts clean.
    const expectedLocalHash = hashSkillFolder(destDir);
    expect(expectedLocalHash).not.toBeNull();
    expect(
      fs.readFileSync(path.join(destDir, ".skills-bank-hash"), "utf8").trim(),
    ).toBe(expectedLocalHash);
  });

  test("reads metadata from mirrored SKILL.md frontmatter without writing meta.json", async () => {
    // Post-v1.15 SKILL.md frontmatter is the authoritative metadata
    // source — the import writes no meta.json. The mirrored frontmatter
    // alone must drive the registry index (name/description/version/author).
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
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.1.0",
      skills: [
        {
          name: "described",
          source: "user",
          bucket: "personal",
          origin: {
            kind: "github",
            repo: "owner/repo",
            skillPath: "skills/described/SKILL.md",
          },
          tags: [],
          category: null,
          lastInstalledOn: [],
        },
      ],
    };

    const result = await importRegistryManifest(registryRoot, manifest);
    expect(result.outcomes).toEqual([
      { name: "described", result: "registered" },
    ]);

    const destDir = path.join(registryRoot, "skills", "personal", "described");
    // No meta.json synthesized — frontmatter is the source of truth.
    expect(fs.existsSync(path.join(destDir, "meta.json"))).toBe(false);
    // The registry index reads the description straight from frontmatter.
    const entry = buildRegistryIndex(registryRoot).entries.find(
      (e) => e.name === "described",
    )!;
    expect(entry.description).toBe(
      "A skill whose description lives in SKILL.md frontmatter only",
    );
    expect(entry.version).toBe("1.2.3");
    expect(entry.author).toBe("Test Author");
  });

  test("places a `source: bundled` skill in skills/vendored/", async () => {
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
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.1.0",
      skills: [
        {
          name: "beta",
          source: "curated",
          bucket: "vendored",
          origin: {
            kind: "github",
            repo: "owner/repo",
            skillPath: "skills/beta/SKILL.md",
          },
          tags: [],
          category: null,
          lastInstalledOn: [],
        },
      ],
    };

    await importRegistryManifest(registryRoot, manifest);
    expect(
      fs.existsSync(path.join(registryRoot, "skills", "vendored", "beta")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(registryRoot, "skills", "personal", "beta")),
    ).toBe(false);
  });

  test("surfaces origin-unreachable when manifest origin has no GitHub pointer", async () => {
    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.1.0",
      skills: [
        {
          name: "ghost",
          source: "user",
          bucket: "personal",
          origin: { kind: "none" },
          tags: [],
          category: null,
          lastInstalledOn: [],
        },
      ],
    };
    const result = await importRegistryManifest(registryRoot, manifest);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]!.result).toBe("origin-unreachable");
  });

  test("same-origin existing skill returns `registered`, recovers label override", async () => {
    const dir = writeSkill("vendored", "gamma", {
      source: "curated",
      description: "gamma helper",
      origin: { repo: "owner/repo", skillPath: "skills/gamma/SKILL.md" },
    });
    writeSyncedHash(dir, "baseline");

    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.1.0",
      skills: [
        {
          name: "gamma",
          source: "curated",
          bucket: "vendored",
          origin: {
            kind: "github",
            repo: "owner/repo",
            skillPath: "skills/gamma/SKILL.md",
          },
          tags: ["t1"],
          category: null,
          lastInstalledOn: [],
        },
      ],
    };

    const result = await importRegistryManifest(registryRoot, manifest);
    expect(result.outcomes).toEqual([{ name: "gamma", result: "registered" }]);
    expect(result.restoredLabels?.["gamma"]).toEqual({ tags: ["t1"] });
  });

  test("surfaces collision when local origin differs from manifest", async () => {
    writeSkill("vendored", "delta", {
      source: "curated",
      origin: { repo: "other/repo", skillPath: "skills/delta/SKILL.md" },
    });

    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.1.0",
      skills: [
        {
          name: "delta",
          source: "curated",
          bucket: "vendored",
          origin: {
            kind: "github",
            repo: "owner/repo",
            skillPath: "skills/delta/SKILL.md",
          },
          tags: [],
          category: null,
          lastInstalledOn: [],
        },
      ],
    };

    const result = await importRegistryManifest(registryRoot, manifest);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]!.result).toBe("collision");
    if (result.outcomes[0]!.result === "collision") {
      expect(result.outcomes[0]!.existingOrigin.repo).toBe("other/repo");
    }
  });

  test("installHints carries lastInstalledOn forward verbatim (no agent-dir filter)", async () => {
    // No agent dirs exist on disk — the wipe-and-re-import scenario.
    // Earlier drafts filtered hints down to existing dirs and silently
    // dropped everything here, breaking the post-import confirm modal.
    writeSkill("personal", "epsilon");
    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.1.0",
      skills: [
        {
          name: "epsilon",
          source: "user",
          bucket: "personal",
          origin: { kind: "none" },
          tags: [],
          category: null,
          lastInstalledOn: ["claude", "cursor"],
        },
      ],
    };
    const result = await importRegistryManifest(registryRoot, manifest);
    expect(result.installHints).toEqual([
      { name: "epsilon", agents: ["claude", "cursor"] },
    ]);
  });

  test("pre-aborted signal exits the loop before any iteration", async () => {
    // Tier 1 v2: AbortSignal threading through importRegistryManifest.
    // Pre-aborting the signal is the simplest proof that the top-of-
    // iteration check fires; it avoids the timing scaffolding that
    // would otherwise be needed to abort mid-loop. The mid-mirror
    // cancel path shares the same check, so this covers the contract.
    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.1.0",
      skills: [
        {
          name: "alpha",
          source: "user",
          bucket: "personal",
          origin: {
            kind: "github",
            repo: "owner/repo",
            skillPath: "skills/alpha/SKILL.md",
          },
          tags: [],
          category: null,
          lastInstalledOn: [],
        },
        {
          name: "beta",
          source: "user",
          bucket: "personal",
          origin: {
            kind: "github",
            repo: "owner/repo",
            skillPath: "skills/beta/SKILL.md",
          },
          tags: [],
          category: null,
          lastInstalledOn: [],
        },
        {
          name: "gamma",
          source: "user",
          bucket: "personal",
          origin: {
            kind: "github",
            repo: "owner/repo",
            skillPath: "skills/gamma/SKILL.md",
          },
          tags: [],
          category: null,
          lastInstalledOn: [],
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
    expect(result.installHints).toEqual([]);
    // Nothing mirrored.
    expect(
      fs.existsSync(path.join(registryRoot, "skills", "personal", "alpha")),
    ).toBe(false);
  });

  test("onProgress fires per iteration with cumulative counts and the name list on first call", async () => {
    // Tier 2 contract: first event carries manifestNames; subsequent
    // events update completed + currentName; terminal event lands after
    // the loop with completed === total. Sources are user skills that
    // already exist locally (no GitHub mirroring) so the test runs pure
    // in-process.
    writeSkill("personal", "alpha");
    writeSkill("personal", "beta");
    writeSkill("personal", "gamma");
    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.1.0",
      skills: [
        {
          name: "alpha",
          source: "user",
          bucket: "personal",
          origin: { kind: "none" },
          tags: [],
          category: null,
          lastInstalledOn: [],
        },
        {
          name: "beta",
          source: "user",
          bucket: "personal",
          origin: { kind: "none" },
          tags: [],
          category: null,
          lastInstalledOn: [],
        },
        {
          name: "gamma",
          source: "user",
          bucket: "personal",
          origin: { kind: "none" },
          tags: [],
          category: null,
          lastInstalledOn: [],
        },
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
    // Gap 2: a skill the merge resolved as deleted-upstream must be
    // removed locally so the deletion propagates. Two local skills; the
    // manifest re-registers one and the caller confirms removal of the
    // other.
    writeSkill("personal", "keep");
    writeSkill("personal", "drop");
    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.1.0",
      skills: [
        {
          name: "keep",
          source: "user",
          bucket: "personal",
          origin: { kind: "none" },
          tags: [],
          category: null,
          lastInstalledOn: [],
        },
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
        exportedAt: "2026-05-20T00:00:00Z",
        sourceBankVersion: "1.1.0",
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
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.1.0",
      skills: [],
    } satisfies RegistryManifest);
    expect(result.removed).toBeUndefined();
    expect(
      fs.existsSync(path.join(registryRoot, "skills", "personal", "stays")),
    ).toBe(true);
  });

  test("installHints omits skills with empty lastInstalledOn", async () => {
    writeSkill("personal", "zeta");
    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.1.0",
      skills: [
        {
          name: "zeta",
          source: "user",
          bucket: "personal",
          origin: { kind: "none" },
          tags: [],
          category: null,
          lastInstalledOn: [],
        },
      ],
    };
    const result = await importRegistryManifest(registryRoot, manifest);
    expect(result.installHints).toEqual([]);
  });
});

describe("writeRegistrySnapshot", () => {
  test("writes a snapshot file and reports its path", () => {
    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.1.0",
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
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.1.0",
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
  test("v2 manifest: github origins → vendored, no-origin entries → personal", () => {
    const v2 = {
      schemaVersion: 2 as const,
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.2.0",
      registryRoot: "Tyler-Reagan/skills",
      skills: [
        {
          name: "alpha",
          source: "user" as const,
          origin: {
            kind: "github" as const,
            repo: "kostja94/marketing-skills",
            skillPath: "skills/alpha/SKILL.md",
          },
          tags: ["t1"],
          category: null,
          lastInstalledOn: [],
        },
        {
          name: "beta",
          source: "user" as const,
          origin: { kind: "none" as const },
          tags: [],
          category: null,
          lastInstalledOn: ["claude" as const],
        },
      ],
    };
    const coerced = coerceManifestToCurrent(v2);
    expect(coerced.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(coerced.skills[0]!.bucket).toBe("vendored");
    expect(coerced.skills[1]!.bucket).toBe("personal");
    expect(coerced.skills[0]!.tags).toEqual(["t1"]);
    expect(coerced.skills[1]!.lastInstalledOn).toEqual(["claude"]);
  });

  test("v3 manifest: stamps current version, drops dismissed/hidden, defaults category", () => {
    const v3 = {
      schemaVersion: 3 as const,
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.3.0",
      skills: [
        {
          name: "alpha",
          source: "user" as const,
          bucket: "personal" as const,
          origin: { kind: "none" as const },
          tags: ["t1"],
          dismissed: true,
          hidden: true,
          lastInstalledOn: ["claude" as const],
        },
      ],
    };
    const coerced = coerceManifestToCurrent(v3);
    expect(coerced.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(coerced.skills[0]!.bucket).toBe("personal");
    expect(coerced.skills[0]!.tags).toEqual(["t1"]);
    expect(coerced.skills[0]!.category).toBeNull();
    expect(coerced.skills[0]!.lastInstalledOn).toEqual(["claude"]);
  });

  test("canonical v4 file (dismissed/hidden, no category) coerces to v5", () => {
    // The shape the pre-v5 `serializeManifest` produced: schemaVersion 4,
    // no top-level exportedAt, no per-skill lastInstalledOn, the legacy
    // dismissed/hidden booleans, and no category.
    const canonical = {
      schemaVersion: 4 as const,
      sourceBankVersion: "1.17.0",
      skills: [
        {
          name: "alpha",
          source: "user" as const,
          bucket: "personal" as const,
          origin: { kind: "none" as const },
          tags: [],
          dismissed: false,
          hidden: false,
        },
      ],
    };
    const coerced = coerceManifestToCurrent(canonical);
    expect(coerced.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(coerced.exportedAt).toBe("");
    expect(coerced.skills[0]!.lastInstalledOn).toEqual([]);
    expect(coerced.skills[0]!.category).toBeNull();
    expect("dismissed" in coerced.skills[0]!).toBe(false);
  });

  test("rejects unsupported schemaVersion", () => {
    expect(() =>
      coerceManifestToCurrent({ schemaVersion: 1, skills: [] }),
    ).toThrow(/unsupported schemaVersion 1/);
  });
});

describe("serializeManifest", () => {
  function sample(): RegistryManifest {
    return {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.17.0",
      registryRoot: "Tyler-Reagan/skills",
      skills: [
        {
          name: "zeta",
          description: "last by name",
          source: "user",
          bucket: "personal",
          origin: { kind: "none" },
          tags: ["b", "a"],
          category: "frontend",
          lastInstalledOn: ["claude", "cursor"],
        },
        {
          name: "alpha",
          description: "first by name",
          source: "curated",
          bucket: "vendored",
          origin: {
            kind: "github",
            repo: "owner/repo",
            skillPath: "skills/alpha/SKILL.md",
            skillFolderHash: "deadbeef",
          },
          tags: [],
          category: null,
          lastInstalledOn: [],
        },
      ],
    };
  }

  test("drops exportedAt + lastInstalledOn, sorts skills, keeps shared intent", () => {
    const parsed = JSON.parse(serializeManifest(sample())) as Record<
      string,
      unknown
    >;
    expect("exportedAt" in parsed).toBe(false);
    expect(parsed["schemaVersion"]).toBe(MANIFEST_SCHEMA_VERSION);
    const skills = parsed["skills"] as Record<string, unknown>[];
    // Sorted by name.
    expect(skills.map((s) => s["name"])).toEqual(["alpha", "zeta"]);
    // No per-skill lastInstalledOn (local, churn source).
    expect(skills.every((s) => !("lastInstalledOn" in s))).toBe(true);
    // category/tags retained (curation intent, compared by diff). zeta
    // sorts last, so skills[1] is zeta with its category.
    expect(skills[0]!["category"]).toBeNull();
    expect(skills[1]!["category"]).toBe("frontend");
    // skillFolderHash retained as a pin.
    expect(
      (skills[0]!["origin"] as Record<string, unknown>)["skillFolderHash"],
    ).toBe("deadbeef");
  });

  test("emits stable per-skill key order and a trailing newline", () => {
    const text = serializeManifest(sample());
    expect(text.endsWith("\n")).toBe(true);
    const alphaKeys = Object.keys(
      (JSON.parse(text)["skills"] as Record<string, unknown>[])[0]!,
    );
    expect(alphaKeys).toEqual([
      "name",
      "description",
      "source",
      "bucket",
      "origin",
      "category",
      "tags",
    ]);
  });

  test("round-trip stable: serialize == serialize∘coerce∘parse∘serialize", () => {
    const once = serializeManifest(sample());
    const twice = serializeManifest(
      coerceManifestToCurrent(JSON.parse(once) as unknown),
    );
    expect(twice).toBe(once);
  });
});

describe("importRegistryManifest — schema migration head", () => {
  test("v2 manifest with github origin imports into vendored/", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) return makeTreeResponse("skills/zeta");
        if (call === 2) return makeBlobResponse("# zeta migrated");
        throw new Error(`unexpected call #${call}`);
      }),
    );

    const v2Manifest = {
      schemaVersion: 2 as const,
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.2.0",
      skills: [
        {
          name: "zeta",
          source: "user" as const,
          origin: {
            kind: "github" as const,
            repo: "owner/repo",
            skillPath: "skills/zeta/SKILL.md",
          },
          tags: [],
          category: null,
          lastInstalledOn: [],
        },
      ],
    };

    const result = await importRegistryManifest(registryRoot, v2Manifest);
    expect(result.outcomes).toEqual([{ name: "zeta", result: "registered" }]);
    // Pre-v3 fallback routes any github-origin entry into vendored/.
    expect(
      fs.existsSync(path.join(registryRoot, "skills", "vendored", "zeta")),
    ).toBe(true);
  });
});

describe("computeManifestRemovals (pure)", () => {
  const manifest = (...names: string[]): RegistryManifest => ({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    exportedAt: "",
    sourceBankVersion: "",
    skills: names.map((name) => ({
      name,
      source: "user",
      bucket: "personal",
      origin: { kind: "none" },
      category: null,
      tags: [],
      lastInstalledOn: [],
    })),
  });

  test("returns local names absent from the manifest", () => {
    expect(
      computeManifestRemovals(["a", "b", "c"], manifest("a", "c")),
    ).toEqual(["b"]);
  });

  test("empty when every local skill is still listed", () => {
    expect(computeManifestRemovals(["a", "b"], manifest("a", "b"))).toEqual([]);
  });

  test("empty manifest ⇒ every local skill is a removal candidate", () => {
    expect(computeManifestRemovals(["a", "b"], manifest())).toEqual(["a", "b"]);
  });
});

describe("stampOriginMarker — runtime import never mints curated", () => {
  function stamp(
    source: ManifestSkill["source"],
    originKind: "github" | "none",
  ): ReturnType<typeof readSkillSource> {
    const dir = path.join(registryRoot, "skills", "vendored", "stamped");
    fs.mkdirSync(dir, { recursive: true });
    const skill: ManifestSkill = {
      name: "stamped",
      source,
      bucket: "vendored",
      origin:
        originKind === "github"
          ? {
              kind: "github",
              repo: "owner/repo",
              skillPath: "skills/stamped/SKILL.md",
            }
          : { kind: "none" },
      category: null,
      tags: [],
      lastInstalledOn: [],
    };
    stampOriginMarker(dir, skill, "hash123");
    return readSkillSource(dir);
  }

  test("curated + github origin downgrades to vendored", () => {
    const s = stamp("curated", "github");
    expect(s.source).toBe("vendored");
    expect(s.origin?.kind).toBe("github");
    expect(s.origin?.repo).toBe("owner/repo");
  });

  test("curated + none origin downgrades to user", () => {
    expect(stamp("curated", "none").source).toBe("user");
  });

  test("non-curated sources pass through unchanged", () => {
    expect(stamp("vendored", "github").source).toBe("vendored");
    expect(stamp("user", "github").source).toBe("user");
  });
});

describe("importRegistryManifest — curated github entry lands as vendored", () => {
  test("a manifest claiming curated for a github skill is stored vendored", async () => {
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
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.1.0",
      skills: [
        {
          name: "kappa",
          source: "curated",
          bucket: "vendored",
          origin: {
            kind: "github",
            repo: "owner/repo",
            skillPath: "skills/kappa/SKILL.md",
          },
          tags: [],
          category: null,
          lastInstalledOn: [],
        },
      ],
    };

    await importRegistryManifest(registryRoot, manifest);
    const marker = readSkillSource(
      path.join(registryRoot, "skills", "vendored", "kappa"),
    );
    expect(marker.source).toBe("vendored");
    expect(marker.origin?.repo).toBe("owner/repo");
  });
});
