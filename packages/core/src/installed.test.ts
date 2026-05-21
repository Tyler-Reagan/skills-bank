import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listInstalled } from "./installed.js";

/**
 * Pins the data invariant the RegisterModal collision bug fix relies on:
 * `listInstalled` returns one row per (agent, name) pair, NOT a deduped
 * row keyed on name alone. When the same skill name exists as a
 * real-directory in one agent dir and a broken-symlink in another, both
 * rows must be present so the renderer can offer per-entry actions
 * (Register the real one; Remove the broken one) instead of collapsing
 * them under a single key.
 */

let scratch: string;
let registryRoot: string;
let fakeHome: string;
const originalHomeOverride = process.env["SKILLS_BANK_HOME_OVERRIDE"];

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-installed-"));
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
  if (originalHomeOverride === undefined) {
    delete process.env["SKILLS_BANK_HOME_OVERRIDE"];
  } else {
    process.env["SKILLS_BANK_HOME_OVERRIDE"] = originalHomeOverride;
  }
  fs.rmSync(scratch, { recursive: true, force: true });
});

function agentDir(agent: string): string {
  const dir = path.join(fakeHome, `.${agent === "agents" ? "agents" : agent}`, "skills");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("listInstalled — same-name across agent dirs", () => {
  test("returns one row per (agent, name) without name-based dedup", () => {
    // ui-ux-pro-max as a real directory in ~/.agents/skills/ — the
    // source-of-truth, what the user wants to register.
    const agentsReal = path.join(agentDir("agents"), "ui-ux-pro-max");
    fs.mkdirSync(agentsReal);
    fs.writeFileSync(
      path.join(agentsReal, "SKILL.md"),
      "---\nname: ui-ux-pro-max\ndescription: a real skill\n---\n",
    );

    // Stale broken symlinks left behind in ~/.claude/skills/ and
    // ~/.cursor/skills/ from prior installs. Targets do not exist.
    const missingTarget = path.join(scratch, "deleted-content");
    fs.symlinkSync(missingTarget, path.join(agentDir("claude"), "ui-ux-pro-max"));
    fs.symlinkSync(missingTarget, path.join(agentDir("cursor"), "ui-ux-pro-max"));

    const entries = listInstalled(registryRoot);
    const ours = entries.filter((e) => e.name === "ui-ux-pro-max");

    // All three discoverable installations must surface — the bug was
    // that they did, but the renderer's name-only React key collapsed
    // them. The data layer's contract is the per-(agent,name) row set.
    expect(ours).toHaveLength(3);
    expect(ours.map((e) => ({ agent: e.agent, kind: e.kind })).sort(byAgent))
      .toEqual([
        { agent: "agents", kind: "real-directory" },
        { agent: "claude", kind: "broken-symlink" },
        { agent: "cursor", kind: "broken-symlink" },
      ]);
  });
});

function byAgent(a: { agent: string }, b: { agent: string }): number {
  return a.agent.localeCompare(b.agent);
}
