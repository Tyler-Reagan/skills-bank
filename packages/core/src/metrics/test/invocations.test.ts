import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readInvocationStats } from "../invocations.js";

let scratch: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-metrics-"));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function writeLog(lines: string[]): void {
  fs.writeFileSync(path.join(scratch, "invocations.jsonl"), lines.join("\n"));
}

function event(skill: string, ts: string, session = "s1"): string {
  return JSON.stringify({
    ts,
    payload: { tool_name: "Skill", tool_input: { skill }, session_id: session },
  });
}

// A user `/slash` invocation, as the UserPromptExpansion hook records it.
function slashEvent(skill: string, ts: string, session = "s1"): string {
  return JSON.stringify({
    ts,
    payload: {
      hook_event_name: "UserPromptExpansion",
      expansion_type: "slash_command",
      command_name: skill,
      session_id: session,
    },
  });
}

describe("readInvocationStats", () => {
  test("missing log → empty, logExists false", () => {
    const r = readInvocationStats({ dir: scratch });
    expect(r.logExists).toBe(false);
    expect(r.totalEvents).toBe(0);
    expect(r.perSkill).toEqual([]);
  });

  test("aggregates counts, first/last, and distinct sessions", () => {
    writeLog([
      event("find-skills", "2026-01-01T10:00:00Z", "a"),
      event("find-skills", "2026-01-03T10:00:00Z", "b"),
      event("diagnose", "2026-01-02T10:00:00Z", "a"),
      event("find-skills", "2026-01-02T09:00:00Z", "a"),
    ]);
    const r = readInvocationStats({ dir: scratch });
    expect(r.logExists).toBe(true);
    expect(r.totalEvents).toBe(4);
    expect(r.sessions).toBe(2);
    // Sorted by count desc, then name asc.
    expect(r.perSkill.map((s) => s.skill)).toEqual(["find-skills", "diagnose"]);
    const find = r.perSkill[0]!;
    expect(find.count).toBe(3);
    expect(find.firstInvokedAt).toBe("2026-01-01T10:00:00Z");
    expect(find.lastInvokedAt).toBe("2026-01-03T10:00:00Z");
  });

  test("ties broken by skill name ascending", () => {
    writeLog([
      event("zebra", "2026-01-01T10:00:00Z"),
      event("alpha", "2026-01-01T10:00:00Z"),
    ]);
    const r = readInvocationStats({ dir: scratch });
    expect(r.perSkill.map((s) => s.skill)).toEqual(["alpha", "zebra"]);
  });

  test("skips malformed / skill-less / blank lines but keeps good ones", () => {
    writeLog([
      event("good", "2026-01-01T10:00:00Z"),
      "{ not json",
      JSON.stringify({ ts: "x", payload: { tool_input: {} } }), // no skill
      JSON.stringify({ ts: "x", payload: { tool_input: { skill: 123 } } }), // non-string
      "",
      "   ",
      event("good", "2026-01-02T10:00:00Z"),
    ]);
    const r = readInvocationStats({ dir: scratch });
    expect(r.totalEvents).toBe(2);
    expect(r.malformedLines).toBe(3);
    expect(r.perSkill[0]).toMatchObject({ skill: "good", count: 2 });
  });

  test("tolerates a missing timestamp without throwing", () => {
    writeLog([
      JSON.stringify({
        payload: { tool_input: { skill: "x" }, session_id: "s" },
      }),
      event("x", "2026-01-05T10:00:00Z"),
    ]);
    const r = readInvocationStats({ dir: scratch });
    expect(r.totalEvents).toBe(2);
    expect(r.perSkill[0]!.lastInvokedAt).toBe("2026-01-05T10:00:00Z");
  });

  test("counts user /slash invocations via command_name", () => {
    writeLog([
      slashEvent("soultrace", "2026-01-01T10:00:00Z"),
      slashEvent("soultrace", "2026-01-02T10:00:00Z"),
    ]);
    const r = readInvocationStats({ dir: scratch });
    expect(r.totalEvents).toBe(2);
    expect(r.perSkill[0]).toMatchObject({ skill: "soultrace", count: 2 });
  });

  test("aggregates model-invoked and /slash invocations of the same skill", () => {
    writeLog([
      event("diagnose", "2026-01-01T10:00:00Z"),
      slashEvent("diagnose", "2026-01-03T10:00:00Z"),
    ]);
    const r = readInvocationStats({ dir: scratch });
    expect(r.totalEvents).toBe(2);
    expect(r.perSkill).toHaveLength(1);
    expect(r.perSkill[0]).toMatchObject({
      skill: "diagnose",
      count: 2,
      firstInvokedAt: "2026-01-01T10:00:00Z",
      lastInvokedAt: "2026-01-03T10:00:00Z",
    });
  });

  test("ignores expansions that aren't slash_command", () => {
    writeLog([
      JSON.stringify({
        ts: "2026-01-01T10:00:00Z",
        payload: { expansion_type: "other", command_name: "not-a-skill" },
      }),
      slashEvent("real", "2026-01-02T10:00:00Z"),
    ]);
    const r = readInvocationStats({ dir: scratch });
    expect(r.totalEvents).toBe(1);
    expect(r.malformedLines).toBe(1);
    expect(r.perSkill[0]!.skill).toBe("real");
  });
});
