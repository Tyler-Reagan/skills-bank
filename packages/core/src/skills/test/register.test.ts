import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyRegistration, scanExistingInstalls } from "../register.js";
import { buildRegistryIndex } from "../../registry/build.js";
import { getStateDir } from "../../shared/paths.js";
import type { InstalledSkill } from "../../shared/types.js";

/**
 * Contract for register (ADR-0022 — the registry is adopted-only):
 *   - `register` moves a stray on-disk skill's files into the registry's
 *     skills/ tree and sweeps agent symlinks onto the in-bank copy. There
 *     is no record-only / in-place mode.
 *   - broken-symlink sources have no usable content and are refused.
 *
 * SKILLS_BANK_HOME_OVERRIDE redirects every agent-dir scan/sweep into
 * the scratch tree instead of the dev's real ~/.claude/skills.
 */
let scratch: string;
let registryRoot: string;
let fakeHome: string;
const originalHomeOverride = process.env["SKILLS_BANK_HOME_OVERRIDE"];

beforeEach(() => {
  // realpath-normalized: register resolves the move source via realpathSync,
  // so a raw macOS `mktemp` path (a symlink into /private/var) would diverge
  // from the swept linkPath and mask register's vacated-source handling.
  // Normalizing makes the sweep behave as it does on a real home path.
  scratch = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-register-")),
  );
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

describe("register", () => {
  test("moves files into the bank and sweeps the agent link", () => {
    // A real-directory install in the generic agents dir.
    const src = writeRealSkill(agentDir("agents"), "mover");

    const report = scanExistingInstalls(registryRoot);
    const entry = report.entries.find((e) => e.name === "mover")!;
    expect(entry.kind).toBe("real-directory");

    const result = applyRegistration(
      entry,
      {
        type: "register",
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

    // It reads as a registered entry in the index.
    const indexed = buildRegistryIndex(registryRoot).entries.find(
      (e) => e.name === "mover",
    );
    expect(indexed).toBeDefined();
  });

  test("never writes a symlink into npx's canonical store (.agents/skills/)", () => {
    // npx symlink-mode layout: real content in .agents/skills/, agent dirs
    // symlinked at it. `.agents` is read-only territory (#189/#200).
    const canonical = writeRealSkill(agentDir("agents"), "npx-skill");
    const claudeLink = path.join(agentDir("claude"), "npx-skill");
    fs.symlinkSync(canonical, claudeLink, "dir");

    const report = scanExistingInstalls(registryRoot);
    const entry = report.entries.find(
      (e) => e.name === "npx-skill" && e.agent === "agents",
    )!;

    const result = applyRegistration(
      entry,
      { type: "register", name: "npx-skill" },
      { registryRoot, confirmDestructive: true },
    );
    expect(result.ok).toBe(true);

    const dest = path.join(registryRoot, "skills", "personal", "npx-skill");

    // Other agents converge on the in-bank copy…
    expect(fs.realpathSync(claudeLink)).toBe(fs.realpathSync(dest));

    // …but the shared-agents store is NOT repopulated with a link into the
    // registry — nothing survives there at all (the real dir was moved out;
    // register must not recreate a symlink in its place).
    const sharedEntry = path.join(agentDir("agents"), "npx-skill");
    let lstat: fs.Stats | null = null;
    try {
      lstat = fs.lstatSync(sharedEntry);
    } catch {
      lstat = null;
    }
    expect(lstat).toBeNull();
  });

  test("severs a stale shared-agents symlink instead of repointing it into the registry", () => {
    // Source real dir lives in .claude; .agents holds a symlink pointing at it
    // (a plausible prior fan-out). After the move, the .agents link would
    // dangle — register must sever it, never repoint it at the bank copy.
    const source = writeRealSkill(agentDir("claude"), "shared");
    const sharedLink = path.join(agentDir("agents"), "shared");
    fs.symlinkSync(source, sharedLink, "dir");

    const report = scanExistingInstalls(registryRoot);
    const entry = report.entries.find(
      (e) => e.name === "shared" && e.agent === "claude",
    )!;

    const result = applyRegistration(
      entry,
      { type: "register", name: "shared" },
      { registryRoot, confirmDestructive: true },
    );
    expect(result.ok).toBe(true);

    // The .agents link is gone — not repointed at the registry copy.
    let lstat: fs.Stats | null = null;
    try {
      lstat = fs.lstatSync(sharedLink);
    } catch {
      lstat = null;
    }
    expect(lstat).toBeNull();
  });

  test("rotates registration-*.json audit logs, keeping only the newest 50 (#204)", () => {
    const stateDir = getStateDir(registryRoot);
    fs.mkdirSync(stateDir, { recursive: true });
    for (let i = 0; i < 50; i++) {
      const p = path.join(stateDir, `registration-old-${i}.json`);
      fs.writeFileSync(p, "{}");
      const t = (Date.now() - (100 - i) * 1000) / 1000;
      fs.utimesSync(p, t, t);
    }

    writeRealSkill(agentDir("agents"), "rotator");
    const report = scanExistingInstalls(registryRoot);
    const entry = report.entries.find((e) => e.name === "rotator")!;
    const result = applyRegistration(
      entry,
      { type: "register", name: "rotator", agent: entry.agent },
      { registryRoot },
    );
    expect(result.ok).toBe(true);

    const logs = fs
      .readdirSync(stateDir)
      .filter((n) => n.startsWith("registration-"));
    expect(logs.length).toBe(50);
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
  });
});
