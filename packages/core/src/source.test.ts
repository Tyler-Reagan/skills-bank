import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readSkillSource,
  writeSkillSource,
  SKILL_SOURCE_FILENAME,
} from "./source.js";

/**
 * Pins the Phase 2 vocabulary rename (`bundled`→`curated`,
 * `yours`→`user`) under a tolerant-read window:
 *
 *   - readSkillSource accepts both legacy and new values on disk.
 *   - writeSkillSource emits ONLY the new values.
 *
 * The pair makes the migration self-healing: every `.skills-bank.json`
 * the app touches drifts toward the new values.
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

describe("readSkillSource — Phase 2 tolerant-read", () => {
  test("legacy `bundled` reads as `curated`", () => {
    writeMarker({ source: "bundled" });
    expect(readSkillSource(scratch).source).toBe("curated");
  });

  test("legacy `yours` reads as `user`", () => {
    writeMarker({ source: "yours" });
    expect(readSkillSource(scratch).source).toBe("user");
  });

  test("new `curated` reads as `curated`", () => {
    writeMarker({ source: "curated" });
    expect(readSkillSource(scratch).source).toBe("curated");
  });

  test("new `user` reads as `user`", () => {
    writeMarker({ source: "user" });
    expect(readSkillSource(scratch).source).toBe("user");
  });

  test("missing marker file defaults to `user`", () => {
    expect(readSkillSource(scratch).source).toBe("user");
  });

  test("malformed JSON degrades to `user`", () => {
    fs.writeFileSync(
      path.join(scratch, SKILL_SOURCE_FILENAME),
      "{ not json",
    );
    expect(readSkillSource(scratch).source).toBe("user");
  });

  test("unknown source string defaults to `user` (forward-compat)", () => {
    writeMarker({ source: "future-axis-value-that-doesnt-exist" });
    expect(readSkillSource(scratch).source).toBe("user");
  });

  test("syncedFromCommit + syncedAt pass through unchanged", () => {
    writeMarker({
      source: "bundled",
      syncedFromCommit: "deadbeef",
      syncedAt: "2026-05-18T12:00:00Z",
    });
    const r = readSkillSource(scratch);
    expect(r.source).toBe("curated");
    expect(r.syncedFromCommit).toBe("deadbeef");
    expect(r.syncedAt).toBe("2026-05-18T12:00:00Z");
  });
});

describe("readSkillSource — Phase 2 tolerant-read on `upstream` wire key", () => {
  test("legacy `upstream` key reads into `.origin`", () => {
    writeMarker({
      source: "curated",
      upstream: {
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

  test("new `origin` key reads into `.origin`", () => {
    writeMarker({
      source: "curated",
      origin: {
        kind: "github",
        repo: "owner/repo",
        skillPath: "skills/x/SKILL.md",
      },
    });
    const r = readSkillSource(scratch);
    expect(r.origin?.repo).toBe("owner/repo");
    expect(r.origin?.skillPath).toBe("skills/x/SKILL.md");
  });

  test("when both keys present, `origin` wins (defensive)", () => {
    writeMarker({
      source: "curated",
      upstream: { kind: "github", repo: "legacy/repo" },
      origin: { kind: "github", repo: "new/repo" },
    });
    expect(readSkillSource(scratch).origin?.repo).toBe("new/repo");
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

  test("round-trip: legacy on disk → read → write → only new vocabulary remains", () => {
    writeMarker({
      source: "bundled",
      syncedFromCommit: "abc",
      upstream: { kind: "github", repo: "owner/repo" },
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
