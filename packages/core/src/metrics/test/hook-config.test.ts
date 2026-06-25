import { describe, expect, test } from "vitest";
import {
  addSkillHook,
  buildHookCommand,
  buildHookScript,
  hasSkillHook,
  removeSkillHook,
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

describe("addSkillHook", () => {
  test("adds a Skill matcher to empty settings", () => {
    const out = addSkillHook({}, CMD);
    expect(out.hooks!.PreToolUse).toEqual([
      { matcher: "Skill", hooks: [{ type: "command", command: CMD }] },
    ]);
    expect(hasSkillHook(out)).toBe(true);
  });

  test("idempotent — adding twice does not duplicate", () => {
    const once = addSkillHook({}, CMD);
    const twice = addSkillHook(once, CMD);
    expect(twice.hooks!.PreToolUse).toHaveLength(1);
    expect(twice.hooks!.PreToolUse![0]!.hooks).toHaveLength(1);
  });

  test("preserves other PreToolUse matchers and other top-level keys", () => {
    const base: ClaudeSettings = {
      model: "opus",
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] },
        ],
        PostToolUse: [{ matcher: "Edit", hooks: [] }],
      },
    };
    const out = addSkillHook(base, CMD);
    expect(out.model).toBe("opus");
    expect(out.hooks!.PostToolUse).toEqual(base.hooks!.PostToolUse);
    const matchers = out.hooks!.PreToolUse!.map((e) => e.matcher);
    expect(matchers).toEqual(["Bash", "Skill"]);
    // Does not mutate the input.
    expect(base.hooks!.PreToolUse).toHaveLength(1);
  });

  test("appends into an existing Skill matcher rather than duplicating it", () => {
    const base: ClaudeSettings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Skill",
            hooks: [{ type: "command", command: "other-tool" }],
          },
        ],
      },
    };
    const out = addSkillHook(base, CMD);
    expect(out.hooks!.PreToolUse).toHaveLength(1);
    expect(out.hooks!.PreToolUse![0]!.hooks).toHaveLength(2);
  });
});

describe("removeSkillHook", () => {
  test("removes only our command, dropping the now-empty matcher + hooks key", () => {
    const out = removeSkillHook(addSkillHook({}, CMD));
    expect(out.hooks).toBeUndefined();
  });

  test("leaves co-located non-ours hooks under the Skill matcher", () => {
    const base = addSkillHook(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: "Skill",
              hooks: [{ type: "command", command: "keep-me" }],
            },
          ],
        },
      },
      CMD,
    );
    const out = removeSkillHook(base);
    expect(out.hooks!.PreToolUse).toEqual([
      { matcher: "Skill", hooks: [{ type: "command", command: "keep-me" }] },
    ]);
  });

  test("preserves unrelated matchers and keys", () => {
    const base = addSkillHook(
      {
        model: "opus",
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "x" }] },
          ],
        },
      },
      CMD,
    );
    const out = removeSkillHook(base);
    expect(out.model).toBe("opus");
    expect(out.hooks!.PreToolUse).toEqual([
      { matcher: "Bash", hooks: [{ type: "command", command: "x" }] },
    ]);
    expect(hasSkillHook(out)).toBe(false);
  });

  test("no-op when nothing is installed", () => {
    expect(removeSkillHook({})).toEqual({});
    expect(hasSkillHook({})).toBe(false);
  });
});
