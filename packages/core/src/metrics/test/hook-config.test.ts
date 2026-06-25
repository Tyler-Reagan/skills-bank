import { describe, expect, test } from "vitest";
import {
  addTrackingHooks,
  buildHookCommand,
  buildHookScript,
  hasTrackingHooks,
  HOOK_TIMEOUT_SECONDS,
  removeTrackingHooks,
  type ClaudeSettings,
} from "../hook-config.js";

const CMD = buildHookCommand("/home/u/.skills-bank/skill-invocation-hook.sh");

describe("buildHookScript / buildHookCommand", () => {
  test("script is POSIX sh, always exits 0, references the log path", () => {
    const s = buildHookScript("/home/u/.skills-bank/invocations.jsonl");
    expect(s.startsWith("#!/bin/sh")).toBe(true);
    expect(s).toContain("exit 0");
    expect(s).toContain("/home/u/.skills-bank/invocations.jsonl");
  });

  test("single-quotes paths with spaces / apostrophes safely", () => {
    expect(buildHookCommand("/Users/O'Brien/x.sh")).toBe(
      `sh '/Users/O'\\''Brien/x.sh'`,
    );
    expect(buildHookScript("/has space/log").includes("'/has space/log'")).toBe(
      true,
    );
  });
});

describe("addTrackingHooks", () => {
  test("installs under both events with the right matchers + timeout", () => {
    const out = addTrackingHooks({}, CMD);
    expect(out.hooks!.PreToolUse).toEqual([
      {
        matcher: "Skill",
        hooks: [
          { type: "command", command: CMD, timeout: HOOK_TIMEOUT_SECONDS },
        ],
      },
    ]);
    expect(out.hooks!.UserPromptExpansion).toEqual([
      {
        matcher: "*",
        hooks: [
          { type: "command", command: CMD, timeout: HOOK_TIMEOUT_SECONDS },
        ],
      },
    ]);
    expect(hasTrackingHooks(out)).toBe(true);
  });

  test("idempotent — adding twice does not duplicate in either event", () => {
    const twice = addTrackingHooks(addTrackingHooks({}, CMD), CMD);
    expect(twice.hooks!.PreToolUse).toHaveLength(1);
    expect(twice.hooks!.PreToolUse![0]!.hooks).toHaveLength(1);
    expect(twice.hooks!.UserPromptExpansion).toHaveLength(1);
    expect(twice.hooks!.UserPromptExpansion![0]!.hooks).toHaveLength(1);
  });

  test("backfills a missing event (older single-event config)", () => {
    // Simulate a config that only had the PreToolUse hook.
    const legacy: ClaudeSettings = {
      hooks: {
        PreToolUse: [
          { matcher: "Skill", hooks: [{ type: "command", command: CMD }] },
        ],
      },
    };
    expect(hasTrackingHooks(legacy)).toBe(true);
    const out = addTrackingHooks(legacy, CMD);
    // PreToolUse untouched (already ours), UserPromptExpansion added.
    expect(out.hooks!.PreToolUse![0]!.hooks).toHaveLength(1);
    expect(out.hooks!.UserPromptExpansion).toHaveLength(1);
  });

  test("preserves other events, matchers, and top-level keys; no input mutation", () => {
    const base: ClaudeSettings = {
      model: "opus",
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] },
        ],
        PostToolUse: [{ matcher: "Edit", hooks: [] }],
      },
    };
    const out = addTrackingHooks(base, CMD);
    expect(out.model).toBe("opus");
    expect(out.hooks!.PostToolUse).toEqual(base.hooks!.PostToolUse);
    expect(out.hooks!.PreToolUse!.map((e) => e.matcher)).toEqual([
      "Bash",
      "Skill",
    ]);
    expect(base.hooks!.PreToolUse).toHaveLength(1); // input untouched
    expect(base.hooks!.UserPromptExpansion).toBeUndefined();
  });
});

describe("removeTrackingHooks", () => {
  test("removes our hook from every event and drops emptied keys", () => {
    const out = removeTrackingHooks(addTrackingHooks({}, CMD));
    expect(out.hooks).toBeUndefined();
    expect(hasTrackingHooks(out)).toBe(false);
  });

  test("leaves co-located non-ours hooks and unrelated events intact", () => {
    const base = addTrackingHooks(
      {
        model: "opus",
        hooks: {
          PreToolUse: [
            { matcher: "Skill", hooks: [{ type: "command", command: "keep" }] },
          ],
          PostToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "x" }] },
          ],
        },
      },
      CMD,
    );
    const out = removeTrackingHooks(base);
    expect(out.model).toBe("opus");
    expect(out.hooks!.PreToolUse).toEqual([
      { matcher: "Skill", hooks: [{ type: "command", command: "keep" }] },
    ]);
    expect(out.hooks!.PostToolUse).toEqual([
      { matcher: "Bash", hooks: [{ type: "command", command: "x" }] },
    ]);
    expect(out.hooks!.UserPromptExpansion).toBeUndefined();
  });

  test("no-op when nothing is installed", () => {
    expect(removeTrackingHooks({})).toEqual({});
    expect(hasTrackingHooks({})).toBe(false);
  });
});
