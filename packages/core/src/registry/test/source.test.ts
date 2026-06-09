import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readSkillSource,
  writeSkillSource,
  SKILL_SOURCE_FILENAME,
} from "../source.js";

/**
 * Pins the v1.3 vocabulary (`curated`/`user`, `origin` wire key).
 * Legacy values (`bundled`/`yours`, `upstream` wire key) were accepted
 * under a tolerant-read window that closed in v1.13 after all committed
 * markers were migrated. These tests verify the settled behavior only.
 */

let scratch: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-source-"));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function writeMarker(content: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(scratch, SKILL_SOURCE_FILENAME),
    JSON.stringify(content),
  );
}

describe("readSkillSource — source axis", () => {
  test("`curated` reads as `curated`", () => {
    writeMarker({ source: "curated" });
    expect(readSkillSource(scratch).source).toBe("curated");
  });

  test("`user` reads as `user`", () => {
    writeMarker({ source: "user" });
    expect(readSkillSource(scratch).source).toBe("user");
  });

  test("missing marker file defaults to `user`", () => {
    expect(readSkillSource(scratch).source).toBe("user");
  });

  test("malformed JSON degrades to `user`", () => {
    fs.writeFileSync(path.join(scratch, SKILL_SOURCE_FILENAME), "{ not json");
    expect(readSkillSource(scratch).source).toBe("user");
  });

  test("unknown source string defaults to `user` (forward-compat)", () => {
    writeMarker({ source: "future-axis-value-that-doesnt-exist" });
    expect(readSkillSource(scratch).source).toBe("user");
  });

  test("syncedFromCommit + syncedAt pass through unchanged", () => {
    writeMarker({
      source: "curated",
      syncedFromCommit: "deadbeef",
      syncedAt: "2026-05-18T12:00:00Z",
    });
    const r = readSkillSource(scratch);
    expect(r.source).toBe("curated");
    expect(r.syncedFromCommit).toBe("deadbeef");
    expect(r.syncedAt).toBe("2026-05-18T12:00:00Z");
  });
});

describe("readSkillSource — `origin` wire key", () => {
  test("`origin` key reads into `.origin`", () => {
    writeMarker({
      source: "curated",
      origin: {
        kind: "github",
        repo: "owner/repo",
        skillPath: "skills/x/SKILL.md",
        skillFolderHash: "deadbeef",
      },
    });
    const r = readSkillSource(scratch);
    expect(r.origin?.repo).toBe("owner/repo");
    expect(r.origin?.skillPath).toBe("skills/x/SKILL.md");
    expect(r.origin?.skillFolderHash).toBe("deadbeef");
  });
});

describe("writeSkillSource — emits only new vocabulary", () => {
  test("writes `source: curated` to disk", () => {
    writeSkillSource(scratch, { source: "curated" });
    const raw = JSON.parse(
      fs.readFileSync(path.join(scratch, SKILL_SOURCE_FILENAME), "utf8"),
    ) as { source: string };
    expect(raw.source).toBe("curated");
  });

  test("writes `source: user` to disk", () => {
    writeSkillSource(scratch, { source: "user" });
    const raw = JSON.parse(
      fs.readFileSync(path.join(scratch, SKILL_SOURCE_FILENAME), "utf8"),
    ) as { source: string };
    expect(raw.source).toBe("user");
  });

  test("writes `origin` wire key (never `upstream`)", () => {
    writeSkillSource(scratch, {
      source: "curated",
      origin: { kind: "github", repo: "owner/repo" },
    });
    const raw = JSON.parse(
      fs.readFileSync(path.join(scratch, SKILL_SOURCE_FILENAME), "utf8"),
    ) as Record<string, unknown>;
    expect(raw["origin"]).toBeDefined();
    expect(raw["upstream"]).toBeUndefined();
  });

  test("round-trip: read → write preserves all fields, never emits `upstream`", () => {
    writeMarker({
      source: "curated",
      syncedFromCommit: "abc",
      origin: { kind: "github", repo: "owner/repo" },
    });
    const r = readSkillSource(scratch);
    writeSkillSource(scratch, r);
    const raw = JSON.parse(
      fs.readFileSync(path.join(scratch, SKILL_SOURCE_FILENAME), "utf8"),
    ) as Record<string, unknown>;
    expect(raw["source"]).toBe("curated");
    expect(raw["syncedFromCommit"]).toBe("abc");
    expect(raw["origin"]).toBeDefined();
    expect(raw["upstream"]).toBeUndefined();
  });
});
