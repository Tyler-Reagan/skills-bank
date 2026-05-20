import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { forkSkill } from "./fork.js";
import { writeSyncedHash } from "./heal.js";
import { writeSkillSource } from "./source.js";

/**
 * Suite 6 per ADR-0006 — forkSkill invariants. Each test fixtures
 * a scratch registry with at least one vendored skill that has a
 * GitHub origin pointer; the tests probe the six pinned invariants.
 */

let scratch: string;
let registryRoot: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-fork-"));
  registryRoot = path.join(scratch, "registry");
  fs.mkdirSync(path.join(registryRoot, "skills", "personal"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(registryRoot, "skills", "vendored"), {
    recursive: true,
  });
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function writeVendoredWithOrigin(name: string): string {
  const dir = path.join(registryRoot, "skills", "vendored", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: vendored\n---\n# ${name}`,
  );
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify({ name, description: "vendored" }),
  );
  writeSkillSource(dir, {
    source: "curated",
    origin: {
      kind: "github",
      repo: "u/r",
      skillPath: `skills/${name}/SKILL.md`,
      skillFolderHash: "abcd",
    },
  });
  writeSyncedHash(dir, "abcd");
  return dir;
}

describe("forkSkill", () => {
  test("success path: vendored → personal with origin cleared + source flipped", () => {
    const vendoredDir = writeVendoredWithOrigin("alpha");
    const r = forkSkill(registryRoot, "alpha");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newDir).toBe(
      path.join(registryRoot, "skills", "personal", "alpha"),
    );
    expect(r.ref.bucket).toBe("personal");

    // Vendored copy removed.
    expect(fs.existsSync(vendoredDir)).toBe(false);
    // Personal copy materialized.
    expect(fs.existsSync(r.newDir)).toBe(true);
    expect(fs.readFileSync(path.join(r.newDir, "SKILL.md"), "utf8")).toMatch(
      /vendored/,
    );

    // Marker: origin cleared, source flipped to user.
    const marker = JSON.parse(
      fs.readFileSync(path.join(r.newDir, ".skills-bank.json"), "utf8"),
    ) as { source: string; origin?: unknown };
    expect(marker.source).toBe("user");
    expect(marker.origin).toBeUndefined();

    // Synced-hash sidecar dropped by unlinkOrigin.
    expect(fs.existsSync(path.join(r.newDir, ".skills-bank-hash"))).toBe(
      false,
    );

    // Scratch cleaned up.
    const scratchRoot = path.join(registryRoot, ".skills-bank", "scratch");
    if (fs.existsSync(scratchRoot)) {
      expect(fs.readdirSync(scratchRoot)).toEqual([]);
    }
  });

  test("collision: personal/<name> exists → no mutation, structured error", () => {
    const vendoredDir = writeVendoredWithOrigin("beta");
    const personalDir = path.join(
      registryRoot,
      "skills",
      "personal",
      "beta",
    );
    fs.mkdirSync(personalDir, { recursive: true });
    fs.writeFileSync(path.join(personalDir, "SKILL.md"), "# pre-existing");

    const r = forkSkill(registryRoot, "beta");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("collision");
    if (r.reason !== "collision") return;
    expect(r.existingDir).toBe(personalDir);

    // Vendored copy untouched.
    expect(fs.existsSync(vendoredDir)).toBe(true);
    expect(
      fs.readFileSync(path.join(personalDir, "SKILL.md"), "utf8"),
    ).toBe("# pre-existing");
  });

  test("no-origin: vendored skill without origin pointer is refused", () => {
    const dir = path.join(registryRoot, "skills", "vendored", "gamma");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), "# gamma");
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify({ name: "gamma", description: "x" }),
    );
    writeSkillSource(dir, { source: "curated" });

    const r = forkSkill(registryRoot, "gamma");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("no-origin");
    // Skill still in vendored/.
    expect(fs.existsSync(dir)).toBe(true);
  });

  test("source-missing: unknown skill name is refused", () => {
    const r = forkSkill(registryRoot, "ghost");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("source-missing");
  });

  test("not-vendored: personal-bucket skill is refused (fork's narrow contract)", () => {
    const dir = path.join(registryRoot, "skills", "personal", "delta");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), "# delta");
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify({ name: "delta", description: "x" }),
    );
    writeSkillSource(dir, {
      source: "user",
      origin: { kind: "github", repo: "u/r", skillPath: "delta/SKILL.md" },
    });

    const r = forkSkill(registryRoot, "delta");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("not-vendored");
  });

  test("source preserved on collision (atomicity before commit point)", () => {
    // The validation chain runs pre-flight: source-missing →
    // not-vendored → no-origin → collision. Any failure short-
    // circuits BEFORE the scratch dir is even created.
    const vendoredDir = writeVendoredWithOrigin("epsilon");
    fs.mkdirSync(
      path.join(registryRoot, "skills", "personal", "epsilon"),
      { recursive: true },
    );
    const r = forkSkill(registryRoot, "epsilon");
    expect(r.ok).toBe(false);

    // No scratch dir was created.
    const scratchRoot = path.join(registryRoot, ".skills-bank", "scratch");
    expect(fs.existsSync(scratchRoot)).toBe(false);
    // Vendored copy fully intact, including its marker.
    expect(fs.existsSync(vendoredDir)).toBe(true);
    const marker = JSON.parse(
      fs.readFileSync(path.join(vendoredDir, ".skills-bank.json"), "utf8"),
    ) as { source: string; origin?: { repo?: string } };
    expect(marker.source).toBe("curated");
    expect(marker.origin?.repo).toBe("u/r");
  });
});
