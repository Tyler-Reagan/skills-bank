import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyRegistration, scanExistingInstalls } from "../register.js";
import { readExternalRegistry } from "../../registry/external.js";
import { buildRegistryIndex } from "../../registry/build.js";
import type { InstalledSkill } from "../../shared/types.js";

/**
 * Contract for the split register primitives (issue #125):
 *   - `register` is RECORD-ONLY — it writes an external.json row
 *     (adopted:false) and never moves files.
 *   - `move-into-bank` RELOCATES files into the registry's skills/ tree
 *     and sweeps agent symlinks onto the in-bank copy.
 *   - `scanExistingInstalls({ customDirs })` walks user custom dirs so
 *     keep-in-place skills are discoverable.
 *
 * SKILLS_BANK_HOME_OVERRIDE redirects every agent-dir scan/sweep into
 * the scratch tree instead of the dev's real ~/.claude/skills.
 */
let scratch: string;
let registryRoot: string;
let fakeHome: string;
const originalHomeOverride = process.env["SKILLS_BANK_HOME_OVERRIDE"];

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-register-"));
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
  const dir = path.join(fakeHome, `.${agent}`, "skills");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Create a real skill directory with a minimal SKILL.md, return its path. */
function writeRealSkill(dir: string, name: string): string {
  const skillDir = path.join(dir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: a test skill\n---\n# ${name}\n`,
  );
  return skillDir;
}

describe("register (record-only)", () => {
  test("records an external.json row and leaves files in place", () => {
    const customRoot = path.join(scratch, "work-repo");
    const src = writeRealSkill(customRoot, "keep-me");

    const report = scanExistingInstalls(registryRoot, {
      customDirs: [customRoot],
    });
    const entry = report.entries.find((e) => e.name === "keep-me")!;
    expect(entry.kind).toBe("real-directory");
    expect(entry.customDir).toBe(customRoot);

    const result = applyRegistration(
      entry,
      {
        type: "register",
        name: "keep-me",
        agent: entry.agent,
        customDir: customRoot,
      },
      { registryRoot },
    );
    expect(result.ok).toBe(true);

    // Files stay at the source — nothing moved into the bank.
    expect(fs.existsSync(path.join(src, "SKILL.md"))).toBe(true);
    expect(
      fs.existsSync(path.join(registryRoot, "skills", "personal", "keep-me")),
    ).toBe(false);

    // external.json row written, pointing at the in-place source.
    const external = readExternalRegistry(registryRoot);
    expect(external.map((e) => e.name)).toContain("keep-me");
    // Recorded target is the realpath of the source (resolves macOS's
    // /var → /private/var symlink), so compare against realpath.
    expect(external.find((e) => e.name === "keep-me")?.target).toBe(
      fs.realpathSync(src),
    );

    // The index surfaces it as a non-adopted entry.
    const indexed = buildRegistryIndex(registryRoot).entries.find(
      (e) => e.name === "keep-me",
    );
    expect(indexed?.adopted).toBe(false);
  });

  test("refuses a broken-symlink source", () => {
    const entry: InstalledSkill = {
      name: "ghost",
      agent: "claude",
      linkPath: path.join(agentDir("claude"), "ghost"),
      target: path.join(scratch, "missing"),
      kind: "broken-symlink",
    };
    const result = applyRegistration(
      entry,
      { type: "register", name: "ghost" },
      { registryRoot },
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/broken symlink/);
  });
});

describe("move-into-bank", () => {
  test("relocates files into the bank and sweeps the agent link", () => {
    // A real-directory install in the generic agents dir.
    const src = writeRealSkill(agentDir("agents"), "mover");

    const report = scanExistingInstalls(registryRoot);
    const entry = report.entries.find((e) => e.name === "mover")!;
    expect(entry.kind).toBe("real-directory");

    const result = applyRegistration(
      entry,
      {
        type: "move-into-bank",
        name: "mover",
        agent: entry.agent,
        agents: ["claude"],
      },
      { registryRoot },
    );
    expect(result.ok).toBe(true);

    // Files now live in the bank; the source dir is gone.
    const dest = path.join(registryRoot, "skills", "personal", "mover");
    expect(fs.existsSync(path.join(dest, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(src)).toBe(false);

    // The requested agent link points at the in-bank copy.
    const claudeLink = path.join(agentDir("claude"), "mover");
    expect(fs.realpathSync(claudeLink)).toBe(fs.realpathSync(dest));

    // It now reads as adopted in the index.
    const indexed = buildRegistryIndex(registryRoot).entries.find(
      (e) => e.name === "mover",
    );
    expect(indexed?.adopted).not.toBe(false);
  });
});

describe("scanExistingInstalls({ customDirs })", () => {
  test("surfaces custom-dir entries that the agent-dir scan misses", () => {
    const customRoot = path.join(scratch, "external-skills");
    writeRealSkill(customRoot, "from-custom");

    const without = scanExistingInstalls(registryRoot);
    expect(without.entries.map((e) => e.name)).not.toContain("from-custom");

    const withCustom = scanExistingInstalls(registryRoot, {
      customDirs: [customRoot],
    });
    const hit = withCustom.entries.find((e) => e.name === "from-custom");
    expect(hit?.customDir).toBe(customRoot);
  });
});
