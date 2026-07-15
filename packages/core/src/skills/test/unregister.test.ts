import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyRegistration, scanExistingInstalls } from "../register.js";
import { dismissUnregisterFailure, unregisterSkill } from "../unregister.js";
import { readLiveManifest } from "../../manifest/manifest.js";
import { reconcileFoldersToManifest } from "../../registry/reconcile-folders.js";
import { getRuntimeEntry } from "../../registry/runtime-map.js";

/**
 * Round-trip contract (ADR-0022 + issue #167): a skill registered from
 * an agent dir into the bank, then unregistered, must leave the original
 * agent-dir symlink REPOINTED at the destination — not dangling at the
 * deleted bank path. This is the exact regression fixed in commit
 * 01a7f0a; without repointAgentLinks reading the raw target, the sweep
 * skipped every link (realpathSync threw on the already-deleted source).
 */
let scratch: string;
let registryRoot: string;
let fakeHome: string;
const originalHomeOverride = process.env["SKILLS_BANK_HOME_OVERRIDE"];

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-unregister-"));
  registryRoot = path.join(scratch, "registry");
  fakeHome = path.join(scratch, "home");
  fs.mkdirSync(path.join(registryRoot, "skills"), { recursive: true });
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

function writeRealSkill(dir: string, name: string): string {
  const skillDir = path.join(dir, name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: a test skill\n---\n# ${name}\n`,
  );
  return skillDir;
}

describe("unregister", () => {
  test("register→unregister repoints the agent link at the destination", () => {
    // Stray real-directory install in the Claude agent dir.
    writeRealSkill(agentDir("claude"), "round-trip");
    const claudeLink = path.join(fakeHome, ".claude", "skills", "round-trip");

    // Register: moves files into the bank, claude link → bank copy.
    const scan = scanExistingInstalls(registryRoot);
    const entry = scan.entries.find((e) => e.name === "round-trip")!;
    const reg = applyRegistration(
      entry,
      { type: "register", name: "round-trip", agents: ["claude"] },
      { registryRoot, confirmDestructive: true },
    );
    expect(reg.ok).toBe(true);
    reconcileFoldersToManifest(registryRoot);
    const bankDir = path.join(registryRoot, "skills", "personal", "round-trip");
    expect(fs.realpathSync(claudeLink)).toBe(fs.realpathSync(bankDir));

    // Unregister: moves files out to the shared agents dir.
    const result = unregisterSkill("round-trip", {
      registryRoot,
      destination: "agents",
    });
    expect(result.ok).toBe(true);

    const destDir = path.join(fakeHome, ".agents", "skills", "round-trip");
    // Files moved out of the bank.
    expect(fs.existsSync(bankDir)).toBe(false);
    expect(fs.existsSync(path.join(destDir, "SKILL.md"))).toBe(true);
    // The claude link is repointed at the destination — NOT dangling.
    expect(fs.lstatSync(claudeLink).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(claudeLink)).toBe(fs.realpathSync(destDir));
    // And the sweep reported it.
    expect(result.rewrites.some((r) => r.agent === "claude" && r.removed)).toBe(
      true,
    );

    // Manifest row dropped.
    const manifest = readLiveManifest(registryRoot);
    expect(manifest.skills.some((s) => s.name === "round-trip")).toBe(false);
  });
});

/**
 * Unregister Failure marker (issue #211/#215): a failed attempt leaves
 * the folder and manifest row untouched, so the runtime map's
 * `unregisterFailedAt` is the only record it happened. Pins: a
 * destination collision writes it, a successful retry clears it
 * (dropped along with the whole runtime entry once the row goes), and
 * dismissal clears it without unregistering.
 */
describe("unregister — Unregister Failure marker", () => {
  function registerRoundTrip(name: string): void {
    writeRealSkill(agentDir("claude"), name);
    const scan = scanExistingInstalls(registryRoot);
    const entry = scan.entries.find((e) => e.name === name)!;
    const reg = applyRegistration(
      entry,
      { type: "register", name, agents: ["claude"] },
      { registryRoot, confirmDestructive: true },
    );
    expect(reg.ok).toBe(true);
    reconcileFoldersToManifest(registryRoot);
  }

  test("a destination collision marks the failure without touching the row", () => {
    registerRoundTrip("collide-me");
    // Pre-occupy the unregister destination so the move refuses.
    const destDir = path.join(fakeHome, ".agents", "skills", "collide-me");
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, "occupied.txt"), "not mine");

    const result = unregisterSkill("collide-me", {
      registryRoot,
      destination: "agents",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("unregister.destination-collision");

    // The row and folder are exactly as they were before the attempt.
    const bankDir = path.join(registryRoot, "skills", "personal", "collide-me");
    expect(fs.existsSync(bankDir)).toBe(true);
    const manifest = readLiveManifest(registryRoot);
    expect(manifest.skills.some((s) => s.name === "collide-me")).toBe(true);

    // But the marker is set.
    expect(
      getRuntimeEntry(registryRoot, "collide-me").unregisterFailedAt,
    ).toEqual(expect.any(String));
  });

  test("a successful retry clears the marker along with the dropped row", () => {
    registerRoundTrip("retry-me");
    const destDir = path.join(fakeHome, ".agents", "skills", "retry-me");
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, "occupied.txt"), "not mine");

    const failed = unregisterSkill("retry-me", {
      registryRoot,
      destination: "agents",
    });
    expect(failed.ok).toBe(false);
    expect(
      getRuntimeEntry(registryRoot, "retry-me").unregisterFailedAt,
    ).toEqual(expect.any(String));

    // Clear the collision, then retry.
    fs.rmSync(destDir, { recursive: true, force: true });
    const retried = unregisterSkill("retry-me", {
      registryRoot,
      destination: "agents",
    });
    expect(retried.ok).toBe(true);
    expect(getRuntimeEntry(registryRoot, "retry-me")).toEqual({});
  });

  test("dismissUnregisterFailure clears the marker without unregistering", () => {
    registerRoundTrip("dismiss-me");
    const destDir = path.join(fakeHome, ".agents", "skills", "dismiss-me");
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, "occupied.txt"), "not mine");

    const failed = unregisterSkill("dismiss-me", {
      registryRoot,
      destination: "agents",
    });
    expect(failed.ok).toBe(false);
    expect(
      getRuntimeEntry(registryRoot, "dismiss-me").unregisterFailedAt,
    ).toEqual(expect.any(String));

    dismissUnregisterFailure(registryRoot, "dismiss-me");

    expect(getRuntimeEntry(registryRoot, "dismiss-me")).toEqual({});
    // The skill is still registered — dismissal doesn't unregister it.
    const manifest = readLiveManifest(registryRoot);
    expect(manifest.skills.some((s) => s.name === "dismiss-me")).toBe(true);
  });
});
