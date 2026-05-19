import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  hashSkillFolder,
  readRuntimeState,
  writeRuntimeState,
} from "./heal.js";
import { readSkillSource, writeSkillSource } from "./source.js";

/**
 * Contracts pinned by these suites (from ADR-0001):
 *
 *   - byte-equal hashing (identical content → identical hash)
 *   - content sensitivity (one byte different → different hash)
 *   - HASH_BYTE_BUDGET = 8 MB → returns null on overrun
 *   - symlinks hashed by link content (not realpath)
 *   - sidecar exclusions: `.skills-bank.json`, `.skills-bank-hash`
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

  test("excludes .skills-bank.json (sidecar)", () => {
    writeFile("a/SKILL.md", "# x");
    writeFile("b/SKILL.md", "# x");
    writeFile("b/.skills-bank.json", JSON.stringify({ source: "bundled" }));
    const ha = hashSkillFolder(path.join(scratch, "a"));
    const hb = hashSkillFolder(path.join(scratch, "b"));
    expect(ha).toBe(hb);
  });

  test("excludes .skills-bank-hash (sidecar)", () => {
    writeFile("a/SKILL.md", "# x");
    writeFile("b/SKILL.md", "# x");
    writeFile("b/.skills-bank-hash", "deadbeef");
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

describe("runtime state sidecar (.skills-bank-runtime.json)", () => {
  test("read returns empty object when sidecar is missing", () => {
    fs.mkdirSync(path.join(scratch, "a"), { recursive: true });
    expect(readRuntimeState(path.join(scratch, "a"))).toEqual({});
  });

  test("write + read round-trips fetchedAt", () => {
    fs.mkdirSync(path.join(scratch, "a"), { recursive: true });
    writeRuntimeState(path.join(scratch, "a"), { fetchedAt: "2026-05-18T12:00:00Z" });
    expect(readRuntimeState(path.join(scratch, "a"))).toEqual({
      fetchedAt: "2026-05-18T12:00:00Z",
    });
  });

  test("malformed sidecar JSON degrades to empty object", () => {
    const dir = path.join(scratch, "a");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".skills-bank-runtime.json"), "{ not json");
    expect(readRuntimeState(dir)).toEqual({});
  });

  test("hashSkillFolder excludes the runtime sidecar", () => {
    // Same content in two folders; one carries a runtime sidecar.
    // If the sidecar were included, the hash would shift.
    writeFile("a/SKILL.md", "# x");
    writeFile("b/SKILL.md", "# x");
    writeRuntimeState(path.join(scratch, "b"), { fetchedAt: "2026-05-18Z" });
    expect(hashSkillFolder(path.join(scratch, "a"))).toBe(
      hashSkillFolder(path.join(scratch, "b")),
    );
  });
});

describe("writeSkillSource — fetchedAt-stripping (M8)", () => {
  test("strips upstream.fetchedAt before writing to .skills-bank.json", () => {
    const dir = path.join(scratch, "a");
    fs.mkdirSync(dir, { recursive: true });
    writeSkillSource(dir, {
      source: "bundled",
      upstream: {
        kind: "github",
        repo: "u/r",
        skillFolderHash: "deadbeef",
        fetchedAt: "2026-05-18T12:00:00Z", // must NOT land on disk
      },
    });
    const raw = JSON.parse(
      fs.readFileSync(path.join(dir, ".skills-bank.json"), "utf8"),
    ) as {
      upstream?: { fetchedAt?: string; repo?: string; skillFolderHash?: string };
    };
    expect(raw.upstream?.fetchedAt).toBeUndefined();
    expect(raw.upstream?.repo).toBe("u/r");
    expect(raw.upstream?.skillFolderHash).toBe("deadbeef");
  });

  test("idempotent committed marker — repeated writes produce identical files even when fetchedAt shifts", () => {
    // This is the literal bug from docs/bug-reports/2026-05-18-fetchedAt-churn.md:
    // after each app launch the committed marker changed only because
    // fetchedAt got re-stamped. Pin that writeSkillSource is now stable
    // across timestamp shifts.
    const dir = path.join(scratch, "a");
    fs.mkdirSync(dir, { recursive: true });
    writeSkillSource(dir, {
      source: "bundled",
      upstream: {
        kind: "github",
        repo: "u/r",
        skillFolderHash: "hash1",
        fetchedAt: "2026-05-18T12:00:00Z",
      },
    });
    const first = fs.readFileSync(
      path.join(dir, ".skills-bank.json"),
      "utf8",
    );
    writeSkillSource(dir, {
      source: "bundled",
      upstream: {
        kind: "github",
        repo: "u/r",
        skillFolderHash: "hash1",
        fetchedAt: "2026-05-18T22:33:44Z", // fresh wall-clock
      },
    });
    const second = fs.readFileSync(
      path.join(dir, ".skills-bank.json"),
      "utf8",
    );
    expect(first).toBe(second);
  });

  test("readSkillSource tolerates legacy markers that still carry fetchedAt inline", () => {
    // Defensive: a marker committed before v0.11.7 may have fetchedAt
    // baked in. readSkillSource still surfaces it (build.ts merges the
    // runtime sidecar's value over this if both are present).
    const dir = path.join(scratch, "a");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".skills-bank.json"),
      JSON.stringify({
        source: "bundled",
        upstream: {
          kind: "github",
          repo: "u/r",
          fetchedAt: "2026-05-18T12:00:00Z",
        },
      }),
    );
    const src = readSkillSource(dir);
    expect(src.upstream?.fetchedAt).toBe("2026-05-18T12:00:00Z");
  });
});
