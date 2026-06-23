import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adoptIntoLinkedRepo } from "./adopt.js";
import { writeRepoFileAsBranch } from "./files.js";

vi.mock("./files.js");

let scratch: string;
let registryRoot: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-adopt-"));
  registryRoot = path.join(scratch, "registry");
  for (const b of ["personal", "vendored"]) {
    fs.mkdirSync(path.join(registryRoot, "skills", b), { recursive: true });
  }
  vi.mocked(writeRepoFileAsBranch).mockResolvedValue({
    ok: true,
    commitSha: "commit-sha",
    branchName: "adopt/electron",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  fs.rmSync(scratch, { recursive: true, force: true });
});

function writeSkillWithExtras(name: string): string {
  const dir = path.join(registryRoot, "skills", "personal", name);
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} desc\n---\n`,
  );
  fs.writeFileSync(path.join(dir, "scripts", "run.sh"), "echo hi\n");
  // Sidecars that must NOT be committed.
  fs.writeFileSync(
    path.join(dir, ".skills-bank.json"),
    JSON.stringify({ source: "vendored", origin: { kind: "none" } }),
  );
  fs.writeFileSync(path.join(dir, ".skills-bank-hash"), "deadbeef");
  return dir;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("adoptIntoLinkedRepo", () => {
  test("commits content files (skipping sidecars) and opens a PR", async () => {
    writeSkillWithExtras("electron");

    // ghFetch (PR list → empty, then PR create).
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse([])) // GET pulls (none open)
        .mockResolvedValueOnce(
          jsonResponse({ number: 7, html_url: "https://gh/pr/7" }, 201),
        ), // POST pulls
    );

    const res = await adoptIntoLinkedRepo({
      registryRoot,
      name: "electron",
      linkedRepo: "Me/skills",
      baseBranch: "main",
      destPath: "skills/tools/electron",
      token: "tok",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.prNumber).toBe(7);
    expect(res.htmlUrl).toBe("https://gh/pr/7");
    expect(res.fileCount).toBe(2);

    // Only content files, at the destination path; no sidecars.
    const committed = vi
      .mocked(writeRepoFileAsBranch)
      .mock.calls.map((c) => c[0].path)
      .sort();
    expect(committed).toEqual([
      "skills/tools/electron/SKILL.md",
      "skills/tools/electron/scripts/run.sh",
    ]);
    for (const p of committed) {
      expect(p).not.toContain(".skills-bank");
    }
  });

  test("reuses an existing open PR on the branch", async () => {
    writeSkillWithExtras("electron");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse([{ number: 3, html_url: "https://gh/pr/3" }]),
        ),
    );

    const res = await adoptIntoLinkedRepo({
      registryRoot,
      name: "electron",
      linkedRepo: "Me/skills",
      baseBranch: "main",
      destPath: "skills/tools/electron",
      token: "tok",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.prNumber).toBe(3);
  });

  test("fails cleanly when a file commit fails", async () => {
    writeSkillWithExtras("electron");
    vi.mocked(writeRepoFileAsBranch).mockResolvedValueOnce({
      ok: false,
      status: 422,
      message: "boom",
    });

    const res = await adoptIntoLinkedRepo({
      registryRoot,
      name: "electron",
      linkedRepo: "Me/skills",
      baseBranch: "main",
      destPath: "skills/tools/electron",
      token: "tok",
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toMatch(/boom/);
  });

  test("reports not-found for an unknown skill", async () => {
    const res = await adoptIntoLinkedRepo({
      registryRoot,
      name: "ghost",
      linkedRepo: "Me/skills",
      baseBranch: "main",
      destPath: "skills/x",
      token: "tok",
    });
    expect(res.ok).toBe(false);
  });
});
