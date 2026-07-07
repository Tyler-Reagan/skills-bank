import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { reconcileFoldersToManifest } from "../reconcile-folders.js";
import {
  readLiveManifest,
  writeLiveManifest,
} from "../../manifest/manifest.js";

/**
 * Pins the F5 recovery invariant: reconcile heals a `url:null` candidate
 * from a surviving pre-#159 `.skills-bank.json` sidecar (old shape →
 * v6, `.git`-normalized), covering both a fresh orphan folder and an
 * existing all-null manifest row. A folder with no sidecar stays the
 * honest `url:null`.
 */

let scratch: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-reconcile-"));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function makeSkillFolder(
  bucket: "personal" | "vendored",
  name: string,
  sidecar?: unknown,
): void {
  const dir = path.join(scratch, "skills", bucket, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name}\n---\n`,
  );
  if (sidecar !== undefined) {
    fs.writeFileSync(
      path.join(dir, ".skills-bank.json"),
      JSON.stringify(sidecar, null, 2),
    );
  }
}

function byName(root: string, name: string) {
  return readLiveManifest(root).skills.find((s) => s.name === name)!;
}

describe("reconcileFoldersToManifest — F5 legacy-origin recovery", () => {
  test("heals a fresh orphan folder from its legacy sidecar", () => {
    makeSkillFolder("vendored", "mcp-builder", {
      source: "user",
      origin: {
        kind: "github",
        repo: "anthropics/skills",
        sourceUrl: "https://github.com/anthropics/skills.git",
        skillPath: "skills/mcp-builder/SKILL.md",
        skillFolderHash: "abc123",
      },
    });
    reconcileFoldersToManifest(scratch);
    const row = byName(scratch, "mcp-builder");
    expect(row.origin.url).toBe("https://github.com/anthropics/skills");
    expect(row.origin.skillPath).toBe("skills/mcp-builder/SKILL.md");
    expect(row.origin.hash).toBe("abc123");
  });

  test("heals an existing url:null manifest row from the sidecar", () => {
    makeSkillFolder("vendored", "grilling", {
      origin: {
        kind: "github",
        sourceUrl: "https://github.com/some/repo",
        skillPath: "skills/grilling/SKILL.md",
      },
    });
    // Simulate a registry already reconciled to all-null (my Phase-8 boot).
    writeLiveManifest(scratch, {
      schemaVersion: 6,
      skills: [
        { name: "grilling", origin: { url: null }, category: null, tags: [] },
      ],
    });
    reconcileFoldersToManifest(scratch);
    expect(byName(scratch, "grilling").origin.url).toBe(
      "https://github.com/some/repo",
    );
  });

  test("a folder with no sidecar stays the honest url:null", () => {
    makeSkillFolder("personal", "from-scratch");
    reconcileFoldersToManifest(scratch);
    expect(byName(scratch, "from-scratch").origin).toEqual({ url: null });
  });

  test("a genuinely-local sidecar (no sourceUrl/repo) stays url:null", () => {
    makeSkillFolder("personal", "local-only", {
      origin: { kind: "none", skillPath: "skills/local-only/SKILL.md" },
    });
    reconcileFoldersToManifest(scratch);
    expect(byName(scratch, "local-only").origin).toEqual({ url: null });
  });
});
