import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { moveSkillBucket } from "../bucket-move.js";

let scratch: string;
let registryRoot: string;
let fakeHome: string;
let prevHome: string | undefined;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-rehome-"));
  registryRoot = path.join(scratch, "registry");
  for (const b of ["personal", "vendored"]) {
    fs.mkdirSync(path.join(registryRoot, "skills", b), { recursive: true });
  }
  // Redirect agent dirs into scratch so symlink repointing is testable.
  fakeHome = path.join(scratch, "home");
  fs.mkdirSync(fakeHome, { recursive: true });
  prevHome = process.env.SKILLS_BANK_HOME_OVERRIDE;
  process.env.SKILLS_BANK_HOME_OVERRIDE = fakeHome;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SKILLS_BANK_HOME_OVERRIDE;
  else process.env.SKILLS_BANK_HOME_OVERRIDE = prevHome;
  fs.rmSync(scratch, { recursive: true, force: true });
});

function writeSkill(bucket: "personal" | "vendored", name: string): string {
  const dir = path.join(registryRoot, "skills", bucket, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} desc\n---\n`,
  );
  return dir;
}

/** Link a skill into a fake agent dir, returning the link path. */
function linkInto(agentRel: string, name: string, target: string): string {
  const skillsDir = path.join(fakeHome, agentRel);
  fs.mkdirSync(skillsDir, { recursive: true });
  const linkPath = path.join(skillsDir, name);
  fs.symlinkSync(target, linkPath, "dir");
  return linkPath;
}

describe("moveSkillBucket", () => {
  test("moves the folder vendored → personal", () => {
    const oldDir = writeSkill("vendored", "electron");
    const res = moveSkillBucket(registryRoot, "electron", "personal");

    expect(res.ok).toBe(true);
    expect(res.fromBucket).toBe("vendored");
    expect(fs.existsSync(oldDir)).toBe(false);
    const newDir = path.join(registryRoot, "skills", "personal", "electron");
    expect(fs.existsSync(path.join(newDir, "SKILL.md"))).toBe(true);
    expect(res.newDir).toBe(newDir);
  });

  test("repoints agent symlinks that pointed at the old location", () => {
    const oldDir = writeSkill("vendored", "electron");
    const claudeLink = linkInto(".claude/skills", "electron", oldDir);
    const cursorLink = linkInto(".cursor/skills", "electron", oldDir);

    const res = moveSkillBucket(registryRoot, "electron", "personal");
    const newDir = path.join(registryRoot, "skills", "personal", "electron");

    expect(res.relinked.sort()).toEqual(["claude", "cursor"]);
    for (const link of [claudeLink, cursorLink]) {
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(path.resolve(path.dirname(link), fs.readlinkSync(link))).toBe(
        newDir,
      );
      // Link resolves to a real SKILL.md (not dangling).
      expect(fs.existsSync(path.join(link, "SKILL.md"))).toBe(true);
    }
  });

  test("leaves foreign symlinks (pointing elsewhere) untouched", () => {
    const oldDir = writeSkill("vendored", "electron");
    const elsewhere = path.join(scratch, "elsewhere-electron");
    fs.mkdirSync(elsewhere, { recursive: true });
    const foreign = linkInto(".claude/skills", "electron", elsewhere);

    const res = moveSkillBucket(registryRoot, "electron", "personal");

    expect(res.relinked).toEqual([]);
    expect(path.resolve(path.dirname(foreign), fs.readlinkSync(foreign))).toBe(
      elsewhere,
    );
    void oldDir;
  });

  test("no-op when already in the target bucket", () => {
    const dir = writeSkill("personal", "diagnose");
    const res = moveSkillBucket(registryRoot, "diagnose", "personal");
    expect(res.ok).toBe(true);
    expect(res.relinked).toEqual([]);
    expect(fs.existsSync(path.join(dir, "SKILL.md"))).toBe(true);
  });

  test("refuses when the destination path already exists", () => {
    writeSkill("vendored", "electron");
    writeSkill("personal", "electron"); // collision target
    // findSkillFolder throws on a cross-bucket name collision, which is
    // the stronger guard; assert the operation does not silently succeed.
    expect(() =>
      moveSkillBucket(registryRoot, "electron", "personal"),
    ).toThrow();
  });

  test("reports not-found for an unknown skill", () => {
    const res = moveSkillBucket(registryRoot, "nope", "personal");
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not found/);
  });
});
