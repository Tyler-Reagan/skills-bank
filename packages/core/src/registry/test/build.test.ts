import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRegistryIndex } from "../build.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Climb from src/registry/test/ up to the repo root, then into docs/.
const repoRoot = path.resolve(__dirname, "..", "..", "..", "..", "..");
const realSchemaPath = path.join(repoRoot, "docs", "meta-schema.json");

let scratch: string;
let registryRoot: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-build-"));
  registryRoot = path.join(scratch, "registry");
  fs.mkdirSync(path.join(registryRoot, "skills", "personal"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(registryRoot, "skills", "vendored"), {
    recursive: true,
  });
  // Mirror the real meta-schema into the scratch registry so AJV
  // validation kicks in the same way it does in production.
  fs.mkdirSync(path.join(registryRoot, "docs"), { recursive: true });
  fs.copyFileSync(
    realSchemaPath,
    path.join(registryRoot, "docs", "meta-schema.json"),
  );
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("buildRegistryIndex — description warning convergence", () => {
  test("SKILL.md frontmatter with name + description emits zero warnings", () => {
    const dir = path.join(registryRoot, "skills", "personal", "alpha");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      "---\nname: alpha\ndescription: A real description\n---\n# alpha\n",
    );

    const index = buildRegistryIndex(registryRoot);
    const entry = index.entries.find((e) => e.name === "alpha");
    expect(entry).toBeDefined();
    expect(entry!.description).toBe("A real description");
    expect(entry!.warnings ?? []).toEqual([]);
  });

  test("SKILL.md without frontmatter emits missing-name and missing-description warnings", () => {
    const dir = path.join(registryRoot, "skills", "personal", "beta");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), "# beta\n");

    const index = buildRegistryIndex(registryRoot);
    const entry = index.entries.find((e) => e.name === "beta");
    expect(entry).toBeDefined();
    const warnings = entry!.warnings ?? [];
    expect(warnings).toContain("missing name (using folder name)");
    expect(warnings).toContain("missing description");
  });

  test("non-required AJV violations still emit (regression guard for the filter)", () => {
    // Pattern violation on `name` is keyword:"pattern", not "required" —
    // the suppression filter must not swallow it. (Schema requires
    // lowercase alphanum + hyphen; uppercase trips it.)
    // Frontmatter is the primary source, so the violation is placed there.
    const dir = path.join(registryRoot, "skills", "personal", "gamma");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      "---\nname: GAMMA-UPPERCASE\ndescription: ok\n---\n# gamma\n",
    );

    const index = buildRegistryIndex(registryRoot);
    const entry = index.entries.find(
      (e) => e.name === "GAMMA-UPPERCASE" || e.name === "gamma",
    );
    expect(entry).toBeDefined();
    const warnings = entry!.warnings ?? [];
    // At least one AJV warning about the name pattern survived.
    expect(warnings.some((w) => w.startsWith("SKILL.md frontmatter"))).toBe(
      true,
    );
  });
});
