import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adoptNpxSkill, adoptableInstalledNames } from "../adopt.js";
import { scanExistingInstalls } from "../register.js";
import { buildRegistryIndex } from "../../registry/build.js";

/**
 * Adopt drives the ordinary Register move-in (ADR-0022) plus one extra
 * step: severing npx's canonical-store link. The fixture reproduces npx's
 * default on-disk layout — real content in the canonical store
 * (`.agents/skills/<name>`) with each agent dir symlinked at it.
 *
 * `fakeHome` is realpath-normalized: register resolves the move source via
 * `fs.realpathSync`, and on macOS a bare `mktemp` path is a symlink into
 * `/private/var`. Without normalizing, register's "recreate the vacated
 * source link" branch never fires (the raw vs. canonical paths differ), so
 * the very thing adopt has to clean up wouldn't exist and the test would
 * pass vacuously.
 */
let scratch: string;
let registryRoot: string;
let fakeHome: string;
const originalHomeOverride = process.env["SKILLS_BANK_HOME_OVERRIDE"];

beforeEach(() => {
  scratch = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-adopt-")),
  );
  registryRoot = path.join(scratch, "registry");
  fakeHome = path.join(scratch, "home");
  fs.mkdirSync(path.join(registryRoot, "skills", "personal"), {
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

function agentSkillsDir(agent: string): string {
  const dir = path.join(fakeHome, `.${agent}`, "skills");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Reproduce an `npx skills` symlink-mode install of `name`. */
function installViaNpx(name: string): {
  canonical: string;
  claudeLink: string;
} {
  const canonical = path.join(agentSkillsDir("agents"), name);
  fs.mkdirSync(canonical, { recursive: true });
  fs.writeFileSync(
    path.join(canonical, "SKILL.md"),
    `---\nname: ${name}\ndescription: a test skill\n---\n# ${name}\n`,
  );
  const claudeLink = path.join(agentSkillsDir("claude"), name);
  fs.symlinkSync(canonical, claudeLink, "dir");
  return { canonical, claudeLink };
}

describe("adoptNpxSkill", () => {
  test("moves the skill into the registry and repoints the agent link at the bank copy", () => {
    const { claudeLink } = installViaNpx("adopt-me");

    const result = adoptNpxSkill(registryRoot, "adopt-me");
    expect(result.ok).toBe(true);

    // Content now lives under the bank.
    const dest = path.join(registryRoot, "skills", "personal", "adopt-me");
    expect(fs.existsSync(path.join(dest, "SKILL.md"))).toBe(true);

    // The agent symlink resolves to the in-bank copy (not npx's store).
    expect(fs.realpathSync(claudeLink)).toBe(fs.realpathSync(dest));

    // It reads as a registered entry.
    const indexed = buildRegistryIndex(registryRoot).entries.find(
      (e) => e.name === "adopt-me",
    );
    expect(indexed).toBeDefined();
  });

  test("severs npx's canonical-store link rather than repointing it into the bank", () => {
    installViaNpx("adopt-me");

    expect(adoptNpxSkill(registryRoot, "adopt-me").ok).toBe(true);

    // The shared-agents (.agents/skills) entry must not survive as a link
    // into skills-bank's registry — that would invite `npx update` to
    // clobber the adopted copy. skills-bank never writes npx's store.
    const sharedLink = path.join(fakeHome, ".agents", "skills", "adopt-me");
    expect(fs.existsSync(sharedLink)).toBe(false);
    let lstat: fs.Stats | null = null;
    try {
      lstat = fs.lstatSync(sharedLink);
    } catch {
      lstat = null;
    }
    expect(lstat).toBeNull();
  });

  test("errors when no installed skill matches the name", () => {
    const result = adoptNpxSkill(registryRoot, "ghost");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no installed skill named/);
  });

  test("refuses a skill already in the registry", () => {
    installViaNpx("adopt-me");
    expect(adoptNpxSkill(registryRoot, "adopt-me").ok).toBe(true);
    // Second adopt: the scan now classifies it as `ours`.
    const again = adoptNpxSkill(registryRoot, "adopt-me");
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/already in the registry/);
  });
});

describe("adoptableInstalledNames", () => {
  test("includes an npx-installed skill and excludes names with no on-disk content", () => {
    installViaNpx("adopt-me");
    const names = adoptableInstalledNames(scanExistingInstalls(registryRoot));
    // Present on disk (real dir in the canonical store) → adoptable.
    expect(names.has("adopt-me")).toBe(true);
    // A lockfile-only ghost never appears in the scan → not adoptable.
    expect(names.has("ghost")).toBe(false);
  });

  test("excludes a skill already registered in the bank (kind 'ours')", () => {
    installViaNpx("adopt-me");
    expect(adoptNpxSkill(registryRoot, "adopt-me").ok).toBe(true);
    const names = adoptableInstalledNames(scanExistingInstalls(registryRoot));
    expect(names.has("adopt-me")).toBe(false);
  });
});
