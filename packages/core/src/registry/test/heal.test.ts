import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  hashSkillFolder,
  detachOrigin,
  scanAndResolveOpJournals,
} from "../heal.js";
import {
  readLiveManifest,
  writeLiveManifest,
} from "../../manifest/manifest.js";
import { getRuntimeEntry, setRuntimeEntry } from "../runtime-map.js";
import { writeOpJournal, readOpJournal } from "../op-journal.js";

/**
 * Contracts pinned by these suites (ADR-0020/0021 v6 model):
 *
 *   - byte-equal hashing (identical content → identical hash)
 *   - content sensitivity (one byte different → different hash)
 *   - HASH_BYTE_BUDGET = 8 MB → returns null on overrun
 *   - symlinks hashed by link content (not realpath)
 *   - the runtime map + op journal are excluded from the hash
 *   - `detachOrigin` clears the manifest row's origin, resets probe
 *     counters, rebaselines the synced hash, and moves the folder
 *     vendored → personal
 *   - `scanAndResolveOpJournals` clears leftover crash-recovery journals
 *
 * Each test isolates its scratch space under os.tmpdir(); cleanup
 * happens in afterEach. Sequential pool (vitest.config.ts) keeps
 * the cleanup story simple.
 */

let scratch: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-heal-"));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function writeFile(rel: string, content: string | Buffer): void {
  const abs = path.join(scratch, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

describe("hashSkillFolder", () => {
  test("missing folder → null", () => {
    expect(hashSkillFolder(path.join(scratch, "does-not-exist"))).toBeNull();
  });

  test("empty folder → stable non-null hash", () => {
    fs.mkdirSync(path.join(scratch, "empty"));
    const h = hashSkillFolder(path.join(scratch, "empty"));
    expect(typeof h).toBe("string");
    expect(h?.length).toBe(64); // sha256 hex
  });

  test("identical content → identical hash (byte-equal)", () => {
    writeFile("a/SKILL.md", "# hello\nworld\n");
    writeFile("a/nested/file.txt", "abc");
    writeFile("b/SKILL.md", "# hello\nworld\n");
    writeFile("b/nested/file.txt", "abc");
    const ha = hashSkillFolder(path.join(scratch, "a"));
    const hb = hashSkillFolder(path.join(scratch, "b"));
    expect(ha).toBe(hb);
    expect(ha).not.toBeNull();
  });

  test("one byte different → different hash", () => {
    writeFile("a/SKILL.md", "# hello\nworld\n");
    writeFile("b/SKILL.md", "# hello\nworld!"); // one byte differs
    const ha = hashSkillFolder(path.join(scratch, "a"));
    const hb = hashSkillFolder(path.join(scratch, "b"));
    expect(ha).not.toBe(hb);
  });

  test("excludes the op journal file", () => {
    writeFile("a/SKILL.md", "# x");
    writeFile("b/SKILL.md", "# x");
    writeOpJournal(path.join(scratch, "b"), {
      op: "move",
      skill: "b",
      startedAt: new Date().toISOString(),
    });
    const ha = hashSkillFolder(path.join(scratch, "a"));
    const hb = hashSkillFolder(path.join(scratch, "b"));
    expect(ha).toBe(hb);
  });

  test("symlink hashed by link content (link target string), not realpath", () => {
    // Two skill dirs with a symlink pointing at the SAME on-disk target.
    // If hashSkillFolder dereferenced realpath, the link's target content
    // would be hashed and a change in the link string (but same target
    // bytes) wouldn't shift the hash. Instead, the link string itself is
    // what gets hashed — so identical target strings → identical hash.
    const targetDir = path.join(scratch, "shared-target");
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, "payload.txt"), "shared");

    fs.mkdirSync(path.join(scratch, "a"), { recursive: true });
    fs.mkdirSync(path.join(scratch, "b"), { recursive: true });
    fs.symlinkSync(targetDir, path.join(scratch, "a", "link"));
    fs.symlinkSync(targetDir, path.join(scratch, "b", "link"));

    const ha = hashSkillFolder(path.join(scratch, "a"));
    const hb = hashSkillFolder(path.join(scratch, "b"));
    expect(ha).toBe(hb);

    // Now change the symlink TARGET on disk (without touching the link
    // string). If realpath-based, the hash would shift. Link-content-based
    // means the hash is unchanged.
    fs.writeFileSync(path.join(targetDir, "payload.txt"), "modified");
    const haAfter = hashSkillFolder(path.join(scratch, "a"));
    expect(haAfter).toBe(ha);

    // Changing the link TARGET STRING (point at a different path)
    // should shift the hash, because the link's target string is part
    // of the hash input.
    fs.unlinkSync(path.join(scratch, "a", "link"));
    fs.symlinkSync(
      path.join(scratch, "different-target"),
      path.join(scratch, "a", "link"),
    );
    const haNew = hashSkillFolder(path.join(scratch, "a"));
    expect(haNew).not.toBe(ha);
  });

  test("> 8 MB folder → null (HASH_BYTE_BUDGET overrun)", () => {
    // 8.1 MB buffer to step just over the budget; the function should
    // bail mid-walk and return null.
    const big = Buffer.alloc(9 * 1024 * 1024, 0x41); // 9 MB, "A"
    writeFile("huge/SKILL.md", "# huge");
    writeFile("huge/blob.bin", big);
    expect(hashSkillFolder(path.join(scratch, "huge"))).toBeNull();
  });

  test("≤ 8 MB folder → non-null (boundary)", () => {
    const justUnder = Buffer.alloc(4 * 1024 * 1024, 0x42); // 4 MB
    writeFile("ok/SKILL.md", "# ok");
    writeFile("ok/blob.bin", justUnder);
    const h = hashSkillFolder(path.join(scratch, "ok"));
    expect(typeof h).toBe("string");
  });

  test("deterministic across runs (sort-stable)", () => {
    // Files written in non-sorted order; the walk sorts entries so the
    // hash should be identical whether we wrote a→b→c or c→b→a.
    writeFile("a/c.txt", "1");
    writeFile("a/a.txt", "1");
    writeFile("a/b.txt", "1");
    const h1 = hashSkillFolder(path.join(scratch, "a"));

    writeFile("b/a.txt", "1");
    writeFile("b/b.txt", "1");
    writeFile("b/c.txt", "1");
    const h2 = hashSkillFolder(path.join(scratch, "b"));

    expect(h1).toBe(h2);
  });
});

describe("hashSkillFolder — honors skill .gitignore", () => {
  test("ignored runtime dir does not affect the hash", () => {
    // Same tracked content; only "b" has a node_modules/ dir that the
    // .gitignore excludes. This is the pretty-mermaid case: the skill
    // npm/pnpm-installs deps into its own folder at runtime.
    writeFile("a/SKILL.md", "# x");
    writeFile("a/.gitignore", "node_modules/\n");
    writeFile("b/SKILL.md", "# x");
    writeFile("b/.gitignore", "node_modules/\n");
    writeFile("b/node_modules/dep/index.js", "module.exports = 1;");
    writeFile("b/node_modules/dep/package.json", '{"name":"dep"}');
    const ha = hashSkillFolder(path.join(scratch, "a"));
    const hb = hashSkillFolder(path.join(scratch, "b"));
    expect(ha).toBe(hb);
    expect(ha).not.toBeNull();
  });

  test("installing into an ignored dir does not flip a skill to drifted", () => {
    // Baseline hash, then simulate a runtime install, then re-hash.
    writeFile("s/SKILL.md", "# x");
    writeFile("s/.gitignore", "node_modules/\n*.svg\n");
    const before = hashSkillFolder(path.join(scratch, "s"));
    writeFile("s/node_modules/big/index.js", "x".repeat(1000));
    writeFile("s/diagram.svg", "<svg/>"); // also-ignored build artifact
    const after = hashSkillFolder(path.join(scratch, "s"));
    expect(after).toBe(before);
  });

  test("ignored file is excluded but a negated (un-ignored) file still counts", () => {
    writeFile("a/SKILL.md", "# x");
    writeFile("a/.gitignore", "*.txt\n!keep.txt\n");
    writeFile("b/SKILL.md", "# x");
    writeFile("b/.gitignore", "*.txt\n!keep.txt\n");
    writeFile("b/scratch.txt", "ignored");
    const ha = hashSkillFolder(path.join(scratch, "a"));
    const hb = hashSkillFolder(path.join(scratch, "b"));
    expect(ha).toBe(hb); // scratch.txt excluded → no drift

    // The negated keep.txt is tracked, so adding it DOES shift the hash.
    writeFile("b/keep.txt", "tracked");
    expect(hashSkillFolder(path.join(scratch, "b"))).not.toBe(ha);
  });

  test("editing tracked content still drifts even with a .gitignore present", () => {
    writeFile("a/SKILL.md", "# hello");
    writeFile("a/.gitignore", "node_modules/\n");
    writeFile("b/SKILL.md", "# goodbye");
    writeFile("b/.gitignore", "node_modules/\n");
    expect(hashSkillFolder(path.join(scratch, "a"))).not.toBe(
      hashSkillFolder(path.join(scratch, "b")),
    );
  });

  test("editing the .gitignore itself drifts (it is never self-ignored)", () => {
    writeFile("a/SKILL.md", "# x");
    writeFile("a/.gitignore", "node_modules/\n");
    writeFile("b/SKILL.md", "# x");
    writeFile("b/.gitignore", "node_modules/\ndist/\n");
    expect(hashSkillFolder(path.join(scratch, "a"))).not.toBe(
      hashSkillFolder(path.join(scratch, "b")),
    );
  });

  test("no .gitignore → unchanged behavior (nothing excluded)", () => {
    // Without a .gitignore, a node_modules dir is hashed like any other
    // content, so its presence shifts the hash.
    writeFile("a/SKILL.md", "# x");
    writeFile("b/SKILL.md", "# x");
    writeFile("b/node_modules/dep/index.js", "1");
    expect(hashSkillFolder(path.join(scratch, "a"))).not.toBe(
      hashSkillFolder(path.join(scratch, "b")),
    );
  });

  test("an ignored dir is pruned, keeping a huge skill under the byte budget", () => {
    // 9 MB of deps inside an ignored node_modules/ would blow the 8 MB
    // budget (→ null) if walked; pruning keeps the hash computable.
    writeFile("s/SKILL.md", "# ok");
    writeFile("s/.gitignore", "node_modules/\n");
    writeFile("s/node_modules/blob.bin", Buffer.alloc(9 * 1024 * 1024, 0x41));
    expect(typeof hashSkillFolder(path.join(scratch, "s"))).toBe("string");
  });
});

function seedSkill(
  bucket: "personal" | "vendored",
  name: string,
  origin: { url: string | null; skillPath?: string; hash?: string },
): string {
  const dir = path.join(scratch, "skills", bucket, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `# ${name}\n`);
  const manifest = readLiveManifest(scratch);
  manifest.skills.push({ name, origin, category: null, tags: [] });
  writeLiveManifest(scratch, manifest);
  return dir;
}

describe("detachOrigin", () => {
  test("returns not-ok when the skill isn't in any bucket", () => {
    const result = detachOrigin(scratch, "missing");
    expect(result.ok).toBe(false);
    expect(result.relinked).toEqual([]);
  });

  test("clears the manifest row's origin url to null", () => {
    seedSkill("vendored", "alpha", {
      url: "https://github.com/third/party",
      skillPath: "skills/alpha/SKILL.md",
      hash: "abc123",
    });
    const result = detachOrigin(scratch, "alpha");
    expect(result.ok).toBe(true);
    const manifest = readLiveManifest(scratch);
    const row = manifest.skills.find((s) => s.name === "alpha");
    expect(row?.origin.url).toBeNull();
  });

  test("adds a local-only row when the manifest had none", () => {
    const dir = path.join(scratch, "skills", "vendored", "bare");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), "# bare\n");
    const result = detachOrigin(scratch, "bare");
    expect(result.ok).toBe(true);
    const manifest = readLiveManifest(scratch);
    const row = manifest.skills.find((s) => s.name === "bare");
    expect(row?.origin).toEqual({ url: null });
  });

  test("clears probe-failure counters and rebaselines the synced hash", () => {
    seedSkill("vendored", "alpha", {
      url: "https://github.com/third/party",
      skillPath: "skills/alpha/SKILL.md",
      hash: "abc123",
    });
    setRuntimeEntry(scratch, "alpha", {
      probeFailureCount: 3,
      lastProbeFailureAt: "2026-06-01T00:00:00Z",
    });
    detachOrigin(scratch, "alpha");
    const runtime = getRuntimeEntry(scratch, "alpha");
    expect(runtime.probeFailureCount).toBeUndefined();
    expect(runtime.lastProbeFailureAt).toBeUndefined();
    expect(typeof runtime.syncedHash).toBe("string");
  });

  test("moves the folder from vendored to personal", () => {
    seedSkill("vendored", "alpha", {
      url: "https://github.com/third/party",
      skillPath: "skills/alpha/SKILL.md",
    });
    const result = detachOrigin(scratch, "alpha");
    expect(result.ok).toBe(true);
    expect(
      fs.existsSync(path.join(scratch, "skills", "personal", "alpha")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(scratch, "skills", "vendored", "alpha")),
    ).toBe(false);
  });

  test("clears the op journal after completing", () => {
    seedSkill("vendored", "alpha", { url: "https://github.com/third/party" });
    detachOrigin(scratch, "alpha");
    const newDir = path.join(scratch, "skills", "personal", "alpha");
    expect(readOpJournal(newDir)).toBeNull();
  });
});

describe("scanAndResolveOpJournals", () => {
  test("no journals present → empty result", () => {
    fs.mkdirSync(path.join(scratch, "skills", "personal", "clean"), {
      recursive: true,
    });
    expect(scanAndResolveOpJournals(scratch)).toEqual([]);
  });

  test("clears a leftover 'move' journal when the folder is at the 'to' bucket", () => {
    const toDir = path.join(scratch, "skills", "personal", "alpha");
    fs.mkdirSync(toDir, { recursive: true });
    writeOpJournal(toDir, {
      op: "move",
      skill: "alpha",
      from: "vendored",
      to: "personal",
      startedAt: new Date().toISOString(),
    });
    const resolved = scanAndResolveOpJournals(scratch);
    expect(resolved).toEqual(["alpha"]);
    expect(readOpJournal(toDir)).toBeNull();
  });

  test("clears a leftover 'move' journal when still at the 'from' bucket", () => {
    const fromDir = path.join(scratch, "skills", "vendored", "alpha");
    fs.mkdirSync(fromDir, { recursive: true });
    writeOpJournal(fromDir, {
      op: "move",
      skill: "alpha",
      from: "vendored",
      to: "personal",
      startedAt: new Date().toISOString(),
    });
    const resolved = scanAndResolveOpJournals(scratch);
    expect(resolved).toEqual(["alpha"]);
    expect(readOpJournal(fromDir)).toBeNull();
  });

  test("clears a leftover 'detachOrigin' journal regardless of manifest state", () => {
    const dir = path.join(scratch, "skills", "personal", "alpha");
    fs.mkdirSync(dir, { recursive: true });
    writeOpJournal(dir, {
      op: "detachOrigin",
      skill: "alpha",
      startedAt: new Date().toISOString(),
    });
    const resolved = scanAndResolveOpJournals(scratch);
    expect(resolved).toEqual(["alpha"]);
    expect(readOpJournal(dir)).toBeNull();
  });
});
