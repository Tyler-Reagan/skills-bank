import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  exportRegistryManifest,
  importRegistryManifest,
  writeRegistrySnapshot,
  MANIFEST_SCHEMA_VERSION,
  type RegistryManifest,
} from "./manifest.js";
import { hideCanonSkill } from "./hide.js";
import { writeUpstreamCanonNames } from "./canon.js";
import { writeSkillSource } from "./source.js";
import { writeSyncedHash } from "./heal.js";

/**
 * Phase 1 manifest contract:
 *   - export is pure read, captures source axis + origin pointer +
 *     tags + hide state + installed-agent map.
 *   - import mirrors content via mirrorSkillFolder for new entries,
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
    source?: "bundled" | "yours";
    upstream?: { repo: string; skillPath: string; skillFolderHash?: string };
  } = {},
): string {
  const dir = path.join(registryRoot, "skills", bucket, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${opts.description ?? "test skill"}\n---\n# ${name}\n`,
  );
  const meta: Record<string, unknown> = {
    name,
    description: opts.description ?? "test skill",
  };
  if (opts.tags) meta["tags"] = opts.tags;
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  if (opts.source || opts.upstream) {
    writeSkillSource(dir, {
      source: opts.source ?? "yours",
      ...(opts.upstream
        ? {
            upstream: {
              kind: "github",
              repo: opts.upstream.repo,
              skillPath: opts.upstream.skillPath,
              ...(opts.upstream.skillFolderHash
                ? { skillFolderHash: opts.upstream.skillFolderHash }
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

  test("records each skill's source, origin, tags, dismissed/hidden", () => {
    writeSkill("personal", "alpha", { tags: ["a", "b"] });
    writeSkill("vendored", "beta", {
      source: "bundled",
      tags: [],
      upstream: {
        repo: "owner/repo",
        skillPath: "skills/beta/SKILL.md",
        skillFolderHash: "deadbeef",
      },
    });
    writeUpstreamCanonNames(registryRoot, ["beta"], "synced");
    hideCanonSkill(registryRoot, "beta");

    const m = exportRegistryManifest(registryRoot, {
      sourceBankVersion: "1.1.0",
      registryRootLabel: "Tyler-Reagan/skills",
    });
    expect(m.registryRoot).toBe("Tyler-Reagan/skills");
    expect(m.skills.map((s) => s.name).sort()).toEqual(["alpha", "beta"]);

    const alpha = m.skills.find((s) => s.name === "alpha")!;
    expect(alpha.source).toBe("yours");
    expect(alpha.origin).toEqual({ kind: "none" });
    expect(alpha.tags).toEqual(["a", "b"]);
    expect(alpha.hidden).toBe(false);
    expect(alpha.dismissed).toBe(false);

    const beta = m.skills.find((s) => s.name === "beta")!;
    expect(beta.source).toBe("bundled");
    expect(beta.origin).toEqual({
      kind: "github",
      repo: "owner/repo",
      skillPath: "skills/beta/SKILL.md",
      skillFolderHash: "deadbeef",
    });
    expect(beta.hidden).toBe(true);
    expect(beta.dismissed).toBe(true);
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
          source: "yours",
          origin: {
            kind: "github",
            repo: "owner/repo",
            skillPath: "skills/alpha/SKILL.md",
          },
          tags: ["restored-tag"],
          dismissed: false,
          hidden: false,
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
    // Tags restored into meta.json.
    const meta = JSON.parse(
      fs.readFileSync(path.join(destDir, "meta.json"), "utf8"),
    ) as { tags?: string[]; name?: string };
    expect(meta.tags).toEqual(["restored-tag"]);
    expect(meta.name).toBe("alpha");
    // Marker stamped with the mirrored folder hash.
    const marker = JSON.parse(
      fs.readFileSync(path.join(destDir, ".skills-bank.json"), "utf8"),
    ) as {
      source: string;
      upstream?: { repo?: string; skillFolderHash?: string };
    };
    expect(marker.source).toBe("yours");
    expect(marker.upstream?.repo).toBe("owner/repo");
    expect(marker.upstream?.skillFolderHash).toBe("foldersha");
    // Synced-hash sidecar baselined so drift is clean from the start.
    expect(
      fs.readFileSync(path.join(destDir, ".skills-bank-hash"), "utf8").trim(),
    ).toBe("foldersha");
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
          source: "bundled",
          origin: {
            kind: "github",
            repo: "owner/repo",
            skillPath: "skills/beta/SKILL.md",
          },
          tags: [],
          dismissed: false,
          hidden: false,
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
          source: "yours",
          origin: { kind: "none" },
          tags: [],
          dismissed: false,
          hidden: false,
          lastInstalledOn: [],
        },
      ],
    };
    const result = await importRegistryManifest(registryRoot, manifest);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]!.result).toBe("origin-unreachable");
  });

  test("same-origin existing skill returns `registered`, restores hidden state", async () => {
    const dir = writeSkill("vendored", "gamma", {
      source: "bundled",
      upstream: { repo: "owner/repo", skillPath: "skills/gamma/SKILL.md" },
    });
    writeSyncedHash(dir, "baseline");
    writeUpstreamCanonNames(registryRoot, ["gamma"], "synced");

    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.1.0",
      skills: [
        {
          name: "gamma",
          source: "bundled",
          origin: {
            kind: "github",
            repo: "owner/repo",
            skillPath: "skills/gamma/SKILL.md",
          },
          tags: ["t1"],
          dismissed: true,
          hidden: true,
          lastInstalledOn: [],
        },
      ],
    };

    const result = await importRegistryManifest(registryRoot, manifest);
    expect(result.outcomes).toEqual([{ name: "gamma", result: "registered" }]);
    const hidden = JSON.parse(
      fs.readFileSync(
        path.join(registryRoot, ".skills-bank", "hidden-canon.json"),
        "utf8",
      ),
    ) as { names: string[] };
    expect(hidden.names).toContain("gamma");
    const meta = JSON.parse(
      fs.readFileSync(path.join(dir, "meta.json"), "utf8"),
    ) as { tags?: string[] };
    expect(meta.tags).toEqual(["t1"]);
  });

  test("surfaces collision when local origin differs from manifest", async () => {
    writeSkill("vendored", "delta", {
      source: "bundled",
      upstream: { repo: "other/repo", skillPath: "skills/delta/SKILL.md" },
    });

    const manifest: RegistryManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      exportedAt: "2026-05-20T00:00:00Z",
      sourceBankVersion: "1.1.0",
      skills: [
        {
          name: "delta",
          source: "bundled",
          origin: {
            kind: "github",
            repo: "owner/repo",
            skillPath: "skills/delta/SKILL.md",
          },
          tags: [],
          dismissed: false,
          hidden: false,
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
          source: "yours",
          origin: { kind: "none" },
          tags: [],
          dismissed: false,
          hidden: false,
          lastInstalledOn: ["claude", "cursor"],
        },
      ],
    };
    const result = await importRegistryManifest(registryRoot, manifest);
    expect(result.installHints).toEqual([
      { name: "epsilon", agents: ["claude", "cursor"] },
    ]);
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
          source: "yours",
          origin: { kind: "none" },
          tags: [],
          dismissed: false,
          hidden: false,
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
