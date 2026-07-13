import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRegistryIndex } from "../build.js";
import { writeLiveManifest } from "../../manifest/manifest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Climb from src/registry/test/ up to the repo root, then into docs/.
const repoRoot = path.resolve(__dirname, "..", "..", "..", "..", "..");
const realSchemaPath = path.join(
  repoRoot,
  "docs",
  "skill-frontmatter-schema.json",
);

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
  // Mirror the real frontmatter schema into the scratch registry so AJV
  // validation kicks in the same way it does in production.
  fs.mkdirSync(path.join(registryRoot, "docs"), { recursive: true });
  fs.copyFileSync(
    realSchemaPath,
    path.join(registryRoot, "docs", "skill-frontmatter-schema.json"),
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

  test("entry.name is always the folder name, even when frontmatter disagrees", () => {
    // A skill folder registered as "renamed-folder" whose SKILL.md still
    // declares the old name — e.g. a hand-renamed folder that wasn't
    // re-authored. entry.name must track the folder (the identity every
    // renderer lookup keys on), with the mismatch surfaced as a warning
    // instead of silently trusting the stale frontmatter.
    const dir = path.join(registryRoot, "skills", "personal", "renamed-folder");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      "---\nname: old-name\ndescription: still works\n---\n",
    );

    const index = buildRegistryIndex(registryRoot);
    expect(index.entries.find((e) => e.name === "old-name")).toBeUndefined();
    const entry = index.entries.find((e) => e.name === "renamed-folder");
    expect(entry).toBeDefined();
    expect(
      entry!.warnings?.some(
        (w) =>
          w.includes('declares name "old-name"') &&
          w.includes('registered as "renamed-folder"'),
      ),
    ).toBe(true);
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

/**
 * #204 — duplicate-origin detection. Two manifest rows sharing the same
 * `origin.url` + `skillPath` (the same upstream file registered twice
 * under different local names) get flagged so the user can resolve it;
 * neither row is ever auto-deleted.
 */
describe("buildRegistryIndex — duplicate-origin detection", () => {
  function writeSkill(bucket: "personal" | "vendored", name: string): void {
    const dir = path.join(registryRoot, "skills", bucket, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name}\n---\n`,
    );
  }

  test("flags two rows sharing the same origin.url + skillPath", () => {
    writeSkill("vendored", "diagnose");
    writeSkill("vendored", "diagnosing-bugs");
    writeLiveManifest(registryRoot, {
      schemaVersion: 6,
      skills: [
        {
          name: "diagnose",
          origin: {
            url: "https://github.com/mattpocock/skills",
            skillPath: "skills/engineering/diagnosing-bugs/SKILL.md",
          },
          category: null,
          tags: [],
        },
        {
          name: "diagnosing-bugs",
          origin: {
            url: "https://github.com/mattpocock/skills",
            skillPath: "skills/engineering/diagnosing-bugs/SKILL.md",
          },
          category: null,
          tags: [],
        },
      ],
    });

    const index = buildRegistryIndex(registryRoot);
    const a = index.entries.find((e) => e.name === "diagnose")!;
    const b = index.entries.find((e) => e.name === "diagnosing-bugs")!;
    expect(a.duplicateOriginNames).toEqual(["diagnosing-bugs"]);
    expect(b.duplicateOriginNames).toEqual(["diagnose"]);
  });

  test("keys off the manifest/folder name, not the frontmatter name (#204 real-world shape)", () => {
    // The actual diagnose/diagnosing-bugs bug: both folders' SKILL.md
    // frontmatter reads `name: diagnosing-bugs` (a stray copy carried the
    // frontmatter along), so buildOneEntry's displayed `.name` collapses
    // both onto "diagnosing-bugs" even though they're two distinct
    // manifest rows ("diagnose" and "diagnosing-bugs"). Detection must
    // still find the pair by the manifest/folder name, not the (collided)
    // displayed name — grouping by displayed name would make every name
    // in the group filter itself out and produce an empty duplicate list.
    for (const folder of ["diagnose", "diagnosing-bugs"]) {
      const dir = path.join(registryRoot, "skills", "vendored", folder);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "SKILL.md"),
        "---\nname: diagnosing-bugs\ndescription: shared description\n---\n",
      );
    }
    writeLiveManifest(registryRoot, {
      schemaVersion: 6,
      skills: [
        {
          name: "diagnose",
          origin: {
            url: "https://github.com/mattpocock/skills",
            skillPath: "skills/engineering/diagnosing-bugs/SKILL.md",
          },
          category: null,
          tags: [],
        },
        {
          name: "diagnosing-bugs",
          origin: {
            url: "https://github.com/mattpocock/skills",
            skillPath: "skills/engineering/diagnosing-bugs/SKILL.md",
          },
          category: null,
          tags: [],
        },
      ],
    });

    const index = buildRegistryIndex(registryRoot);
    // entry.name is always the folder/manifest name (#204 follow-up) —
    // both entries must be independently reachable, not collapsed onto
    // one displayed "diagnosing-bugs".
    const diagnose = index.entries.find((e) => e.name === "diagnose");
    const diagnosingBugs = index.entries.find(
      (e) => e.name === "diagnosing-bugs",
    );
    expect(diagnose).toBeDefined();
    expect(diagnosingBugs).toBeDefined();
    expect(diagnose!.duplicateOriginNames).toEqual(["diagnosing-bugs"]);
    expect(diagnosingBugs!.duplicateOriginNames).toEqual(["diagnose"]);
    // The stray frontmatter is surfaced as a warning, not silently trusted.
    expect(
      diagnose!.warnings?.some((w) => w.includes('registered as "diagnose"')),
    ).toBe(true);
  });

  test("does not flag rows with the same url but a different skillPath", () => {
    writeSkill("vendored", "alpha-skill");
    writeSkill("vendored", "beta-skill");
    writeLiveManifest(registryRoot, {
      schemaVersion: 6,
      skills: [
        {
          name: "alpha-skill",
          origin: {
            url: "https://github.com/someone/repo",
            skillPath: "skills/alpha/SKILL.md",
          },
          category: null,
          tags: [],
        },
        {
          name: "beta-skill",
          origin: {
            url: "https://github.com/someone/repo",
            skillPath: "skills/beta/SKILL.md",
          },
          category: null,
          tags: [],
        },
      ],
    });

    const index = buildRegistryIndex(registryRoot);
    const a = index.entries.find((e) => e.name === "alpha-skill")!;
    const b = index.entries.find((e) => e.name === "beta-skill")!;
    expect(a.duplicateOriginNames ?? []).toEqual([]);
    expect(b.duplicateOriginNames ?? []).toEqual([]);
  });

  test("never flags url:null local skills, even with matching names", () => {
    writeSkill("personal", "from-scratch-1");
    writeSkill("personal", "from-scratch-2");
    writeLiveManifest(registryRoot, {
      schemaVersion: 6,
      skills: [
        {
          name: "from-scratch-1",
          origin: { url: null },
          category: null,
          tags: [],
        },
        {
          name: "from-scratch-2",
          origin: { url: null },
          category: null,
          tags: [],
        },
      ],
    });

    const index = buildRegistryIndex(registryRoot);
    const a = index.entries.find((e) => e.name === "from-scratch-1")!;
    const b = index.entries.find((e) => e.name === "from-scratch-2")!;
    expect(a.duplicateOriginNames ?? []).toEqual([]);
    expect(b.duplicateOriginNames ?? []).toEqual([]);
  });
});
