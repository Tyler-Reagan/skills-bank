import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detachOrigin, repointOrigin } from "../heal.js";
import {
  readSkillSource,
  writeSkillSource,
  type SkillSource,
} from "../source.js";
import { readRuntimeState, writeRuntimeState } from "../heal.js";
import { findSkillFolder } from "../walk.js";

let scratch: string;
let registryRoot: string;
let fakeHome: string;
let prevHome: string | undefined;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-restore-"));
  registryRoot = path.join(scratch, "registry");
  for (const b of ["personal", "vendored"]) {
    fs.mkdirSync(path.join(registryRoot, "skills", b), { recursive: true });
  }
  fakeHome = path.join(scratch, "home");
  fs.mkdirSync(fakeHome, { recursive: true });
  prevHome = process.env.SKILLS_BANK_HOME_OVERRIDE;
  process.env.SKILLS_BANK_HOME_OVERRIDE = fakeHome;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SKILLS_BANK_HOME_OVERRIDE;
  else process.env.SKILLS_BANK_HOME_OVERRIDE = prevHome;
  vi.unstubAllGlobals();
  fs.rmSync(scratch, { recursive: true, force: true });
});

function writeVendored(name: string, src: SkillSource): string {
  const dir = path.join(registryRoot, "skills", "vendored", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} description goes here\n---\n`,
  );
  writeSkillSource(dir, src);
  return dir;
}

function treeResponse(folder: string): Response {
  return new Response(
    JSON.stringify({
      sha: "rootsha",
      tree: [
        { path: folder, mode: "040000", type: "tree", sha: "fsha" },
        { path: `${folder}/SKILL.md`, mode: "100644", type: "blob", sha: "b1" },
      ],
      truncated: false,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function blobResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      encoding: "base64",
      content: Buffer.from(content).toString("base64"),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("detachOrigin", () => {
  test("severs origin, preserves provenance, clears probe failures, rehomes to personal", () => {
    const dir = writeVendored("electron", {
      source: "vendored",
      origin: {
        kind: "github",
        repo: "teachingai/full-stack-skills",
        skillPath: "skills/electron-skills/electron/SKILL.md",
        installedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    writeRuntimeState(dir, {
      probeFailureCount: 3,
      lastProbeFailureAt: "2026-06-20T00:00:00.000Z",
      fetchedAt: "2026-05-01T00:00:00.000Z",
    });

    const res = detachOrigin(registryRoot, "electron");
    expect(res.ok).toBe(true);

    // Rehomed vendored → personal.
    const ref = findSkillFolder(registryRoot, "electron");
    expect(ref?.bucket).toBe("personal");

    const after = readSkillSource(ref!.dir);
    expect(after.origin).toEqual({ kind: "none" });
    // Provenance is sticky — a detached vendored skill stays vendored.
    expect(after.source).toBe("vendored");

    // Probe-failure counters cleared; fetchedAt preserved.
    const rt = readRuntimeState(ref!.dir);
    expect(rt.probeFailureCount).toBeUndefined();
    expect(rt.fetchedAt).toBe("2026-05-01T00:00:00.000Z");
  });

  test("reports not-found for an unknown skill", () => {
    const res = detachOrigin(registryRoot, "ghost");
    expect(res.ok).toBe(false);
  });
});

describe("repointOrigin", () => {
  const oldOrigin = {
    kind: "github" as const,
    repo: "mattpocock/skills",
    skillPath: "skills/engineering/diagnose/SKILL.md",
    skillFolderHash: "oldhash",
    installedAt: "2026-01-01T00:00:00.000Z",
  };

  test("success: writes the new origin, clears probe failures, stays vendored", async () => {
    const dir = writeVendored("diagnose", {
      source: "vendored",
      origin: oldOrigin,
    });
    writeRuntimeState(dir, { probeFailureCount: 3 });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        // installSkillFiles: tree probe, then the SKILL.md blob.
        return (
          fetchCalls++ === 0
            ? treeResponse("skills/new/diagnose")
            : blobResponse(
                "---\nname: diagnose\ndescription: relocated diagnose skill\n---\n",
              )
        ) as Response;
      }),
    );

    const res = await repointOrigin(
      registryRoot,
      "diagnose",
      { repo: "mattpocock/skills", skillPath: "skills/new/diagnose/SKILL.md" },
      null,
    );
    expect(res.ok).toBe(true);

    const after = readSkillSource(dir);
    expect(after.origin?.repo).toBe("mattpocock/skills");
    expect(after.origin?.skillPath).toBe("skills/new/diagnose/SKILL.md");
    // Immutable install timestamp carried through.
    expect(after.origin?.installedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(readRuntimeState(dir).probeFailureCount).toBeUndefined();
    // Stayed vendored (no bucket move on repoint).
    expect(findSkillFolder(registryRoot, "diagnose")?.bucket).toBe("vendored");
  });

  test("failure: restores the prior marker so a bad target leaves no broken pointer", async () => {
    const dir = writeVendored("diagnose", {
      source: "vendored",
      origin: oldOrigin,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Not Found", { status: 404 }) as Response),
    );

    const res = await repointOrigin(
      registryRoot,
      "diagnose",
      { repo: "someone/gone", skillPath: "skills/x/diagnose/SKILL.md" },
      null,
    );
    expect(res.ok).toBe(false);

    // Marker rolled back to the original origin.
    const after = readSkillSource(dir);
    expect(after.origin).toEqual(oldOrigin);
  });
});

let fetchCalls = 0;
beforeEach(() => {
  fetchCalls = 0;
});
