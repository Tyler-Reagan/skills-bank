import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repointAgentLinks } from "../agent-links.js";
import { getAgentSkillsDir, type AgentId } from "../agents.js";

/**
 * repointAgentLinks is the relocation primitive: after a skill folder is
 * moved oldDir → newDir, it rewrites every agent-dir symlink that pointed
 * at oldDir. SKILLS_BANK_HOME_OVERRIDE redirects the agent-dir scan into
 * the scratch tree instead of the dev's real ~/.claude/skills.
 */
let scratch: string;
let fakeHome: string;
const originalHomeOverride = process.env["SKILLS_BANK_HOME_OVERRIDE"];

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-agentlinks-"));
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

/** Create <agent>/skills/<name> as a symlink to `target`. Returns linkPath. */
function linkInAgent(agent: AgentId, name: string, target: string): string {
  const dir = getAgentSkillsDir(agent);
  fs.mkdirSync(dir, { recursive: true });
  const linkPath = path.join(dir, name);
  fs.symlinkSync(target, linkPath, "dir");
  return linkPath;
}

/** Simulate the folder move a caller does before invoking the primitive. */
function moveFolder(oldDir: string, newDir: string): void {
  fs.mkdirSync(path.dirname(newDir), { recursive: true });
  fs.renameSync(oldDir, newDir);
}

describe("repointAgentLinks", () => {
  test("repoints a link that resolved to oldDir, even after oldDir is gone", () => {
    const oldDir = path.join(scratch, "bank", "personal", "skill-a");
    const newDir = path.join(scratch, "bank", "vendored", "skill-a");
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, "SKILL.md"), "x");
    const linkPath = linkInAgent("claude", "skill-a", oldDir);

    moveFolder(oldDir, newDir); // oldDir no longer exists — the #167 case

    const { relinked, errors } = repointAgentLinks("skill-a", oldDir, newDir);

    expect(errors).toEqual([]);
    expect(relinked).toEqual([{ agent: "claude", linkPath }]);
    // Link now resolves to the new location (not dangling at oldDir).
    expect(fs.realpathSync(linkPath)).toBe(fs.realpathSync(newDir));
  });

  test("leaves a link pointing elsewhere untouched", () => {
    const oldDir = path.join(scratch, "bank", "personal", "skill-b");
    const newDir = path.join(scratch, "bank", "vendored", "skill-b");
    const unrelated = path.join(scratch, "elsewhere", "skill-b");
    fs.mkdirSync(oldDir, { recursive: true });
    fs.mkdirSync(unrelated, { recursive: true });
    const linkPath = linkInAgent("claude", "skill-b", unrelated);

    moveFolder(oldDir, newDir);
    const { relinked } = repointAgentLinks("skill-b", oldDir, newDir);

    expect(relinked).toEqual([]);
    expect(fs.realpathSync(linkPath)).toBe(fs.realpathSync(unrelated));
  });

  test("leaves a real directory untouched", () => {
    const oldDir = path.join(scratch, "bank", "personal", "skill-c");
    const newDir = path.join(scratch, "bank", "vendored", "skill-c");
    fs.mkdirSync(oldDir, { recursive: true });
    // A real dir (not a symlink) named the same in an agent dir.
    const realInAgent = path.join(getAgentSkillsDir("claude"), "skill-c");
    fs.mkdirSync(realInAgent, { recursive: true });
    fs.writeFileSync(path.join(realInAgent, "SKILL.md"), "unrelated");

    moveFolder(oldDir, newDir);
    const { relinked, errors } = repointAgentLinks("skill-c", oldDir, newDir);

    expect(relinked).toEqual([]);
    expect(errors).toEqual([]);
    expect(fs.lstatSync(realInAgent).isDirectory()).toBe(true);
    expect(fs.lstatSync(realInAgent).isSymbolicLink()).toBe(false);
  });

  test("never creates a self-referential link when linkPath === newDir", () => {
    // newDir IS the agent-dir path for this skill (the unregister-into-an-
    // agent-dir shape). After the move that path is a real dir, so there's
    // nothing to repoint and certainly no self-link.
    const newDir = path.join(getAgentSkillsDir("agents"), "skill-d");
    const oldDir = path.join(scratch, "bank", "personal", "skill-d");
    fs.mkdirSync(oldDir, { recursive: true });

    moveFolder(oldDir, newDir);
    const { relinked, errors } = repointAgentLinks("skill-d", oldDir, newDir);

    expect(relinked).toEqual([]);
    expect(errors).toEqual([]);
    expect(fs.lstatSync(newDir).isSymbolicLink()).toBe(false);
  });

  test("repoints across multiple agent dirs at once", () => {
    const oldDir = path.join(scratch, "bank", "personal", "skill-e");
    const newDir = path.join(scratch, "bank", "vendored", "skill-e");
    fs.mkdirSync(oldDir, { recursive: true });
    const claudeLink = linkInAgent("claude", "skill-e", oldDir);
    const agentsLink = linkInAgent("agents", "skill-e", oldDir);

    moveFolder(oldDir, newDir);
    const { relinked } = repointAgentLinks("skill-e", oldDir, newDir);

    const agents = relinked.map((r) => r.agent).sort();
    expect(agents).toEqual(["agents", "claude"]);
    expect(fs.realpathSync(claudeLink)).toBe(fs.realpathSync(newDir));
    expect(fs.realpathSync(agentsLink)).toBe(fs.realpathSync(newDir));
  });
});
