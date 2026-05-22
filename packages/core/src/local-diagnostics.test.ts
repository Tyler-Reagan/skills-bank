import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanLocalDiagnostics } from "./local-diagnostics.js";

let scratch: string;
let registryRoot: string;
let fakeHome: string;
const originalHomeOverride = process.env["SKILLS_BANK_HOME_OVERRIDE"];

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-diag-"));
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
  const dir = path.join(
    fakeHome,
    `.${agent === "agents" ? "agents" : agent}`,
    "skills",
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("scanLocalDiagnostics", () => {
  test("returns clean report when no issues", () => {
    const report = scanLocalDiagnostics(registryRoot);
    expect(report.items).toEqual([]);
    expect(typeof report.scannedAt).toBe("string");
  });

  test("classifies unregistered installs and broken symlinks", () => {
    // Real-dir install in the generic agents dir (not symlinked to
    // the registry → unregistered-installs).
    const realInstall = path.join(agentDir("agents"), "my-skill");
    fs.mkdirSync(realInstall);
    fs.writeFileSync(
      path.join(realInstall, "SKILL.md"),
      "---\nname: my-skill\ndescription: x\n---\n",
    );

    // Broken symlink in a known agent dir.
    const missingTarget = path.join(scratch, "deleted");
    fs.symlinkSync(missingTarget, path.join(agentDir("claude"), "ghost"));

    const report = scanLocalDiagnostics(registryRoot);
    const categories = report.items.map((i) => i.category).sort();
    expect(categories).toEqual(["broken-symlinks", "unregistered-installs"]);

    const broken = report.items.find((i) => i.category === "broken-symlinks");
    expect(broken?.name).toBe("ghost");
    expect(broken?.agent).toBe("claude");

    const unreg = report.items.find(
      (i) => i.category === "unregistered-installs",
    );
    expect(unreg?.name).toBe("my-skill");
  });

  test("empty registryRoot returns empty report without throwing", () => {
    const report = scanLocalDiagnostics("");
    expect(report.items).toEqual([]);
    expect(typeof report.scannedAt).toBe("string");
  });
});
