import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getAgent,
  getDefaultInstallAgents,
  getExistingAgents,
  type AgentId,
} from "../agents.js";

/**
 * getDefaultInstallAgents is the single choke point for skills-bank's
 * default install fan-out. It must never include the shared-agents dir
 * (`.agents/skills/`) — that's the npx skills CLI's canonical store, and
 * writing into it fights npx. SKILLS_BANK_HOME_OVERRIDE redirects the
 * agent-dir scan into a scratch tree instead of the dev's real ~/.
 */
let scratch: string;
let fakeHome: string;
const originalHomeOverride = process.env["SKILLS_BANK_HOME_OVERRIDE"];

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-defagents-"));
  fakeHome = path.join(scratch, "home");
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

/** Create the on-disk skills dir for an agent so it counts as "existing". */
function makeAgentDir(id: AgentId): void {
  fs.mkdirSync(path.join(fakeHome, getAgent(id).relativePath), {
    recursive: true,
  });
}

describe("getDefaultInstallAgents", () => {
  test("includes existing real agent dirs", () => {
    makeAgentDir("claude");
    makeAgentDir("cursor");
    const ids = getDefaultInstallAgents().map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(["claude", "cursor"]));
  });

  test("excludes the shared-agents dir even when it exists on disk", () => {
    makeAgentDir("claude");
    makeAgentDir("agents"); // npx's canonical .agents/skills store
    const ids = getDefaultInstallAgents().map((a) => a.id);
    expect(ids).toContain("claude");
    expect(ids).not.toContain("agents");
  });

  test("falls back to Claude when the only existing dir is shared-agents", () => {
    makeAgentDir("agents");
    const ids = getDefaultInstallAgents().map((a) => a.id);
    expect(ids).toEqual(["claude"]);
  });

  test("falls back to Claude when no agent dirs exist", () => {
    const ids = getDefaultInstallAgents().map((a) => a.id);
    expect(ids).toEqual(["claude"]);
  });

  test("shared-agents remains explicitly resolvable for opt-in installs", () => {
    // The exclusion is only about the *default* set; an explicit caller
    // passing opts.agents can still target the shared dir.
    expect(getAgent("agents").relativePath).toBe(".agents/skills");
    expect(getExistingAgents).toBeTypeOf("function");
  });
});
