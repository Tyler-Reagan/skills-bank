import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRegistryIndex } from "./build.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Two levels up from packages/core/src/, then into docs/.
const repoRoot = path.resolve(__dirname, "..", "..", "..");
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
  test("post-import on-disk shape (description present in meta.json + SKILL.md frontmatter) emits zero description-related warnings", () => {
    // Verifies Parts 1 and 2 in combination: after manifest import,
    // restoreAuxState has populated meta.json with the description
    // recovered from SKILL.md frontmatter. The build pass must then
    // emit no description-related warnings — neither the AJV
    // `required`-keyword complaint (suppressed by Part 2) nor the
    // human-readable "missing description" (now actually satisfied).
    const dir = path.join(registryRoot, "skills", "personal", "alpha");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      "---\nname: alpha\ndescription: A real description\n---\n# alpha\n",
    );
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify(
        { name: "alpha", description: "A real description" },
        null,
        2,
      ),
    );

    const index = buildRegistryIndex(registryRoot);
    const entry = index.entries.find((e) => e.name === "alpha");
    expect(entry).toBeDefined();
    expect(entry!.description).toBe("A real description");
    const warnings = entry!.warnings ?? [];
    const descriptionWarnings = warnings.filter((w) =>
      w.toLowerCase().includes("description"),
    );
    expect(descriptionWarnings).toEqual([]);
  });

  test("genuinely missing description (no frontmatter recovery) emits exactly one warning", () => {
    // With both fixes in place, a skill that truly has no description
    // anywhere should produce a single human-readable warning rather
    // than the AJV + human-readable duo it used to.
    const dir = path.join(registryRoot, "skills", "personal", "beta");
    fs.mkdirSync(dir, { recursive: true });
    // SKILL.md without frontmatter description so the fallback can't
    // recover anything.
    fs.writeFileSync(path.join(dir, "SKILL.md"), "# beta\n");
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify({ name: "beta" }, null, 2),
    );

    const index = buildRegistryIndex(registryRoot);
    const entry = index.entries.find((e) => e.name === "beta");
    expect(entry).toBeDefined();
    const warnings = entry!.warnings ?? [];
    const descriptionWarnings = warnings.filter((w) =>
      w.toLowerCase().includes("description"),
    );
    expect(descriptionWarnings).toEqual(["missing description"]);
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
