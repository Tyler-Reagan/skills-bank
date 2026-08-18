/**
 * PROTOTYPE — throwaway. Not production. Do not import from app code.
 *
 * Question (issue #222): Can Skills Bank write a v3 lockfile plus
 * ~/.agents/skills/<name>/ that `npx skills list --json -g` accepts,
 * without spawning npx and without importing the `skills` package?
 *
 * Verification *does* spawn npx — only to read back what we wrote.
 * The writer itself is plain fs.
 *
 * Run: pnpm exec tsx docs/research/prototype-npx-lock-writer.ts
 *
 * Isolates HOME to a temp dir. Never touches the real ~/.agents.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SKILLS_PKG = "skills@1.5.22";

type SkillLockEntry = {
  source: string;
  sourceType: string;
  sourceUrl: string;
  ref?: string;
  skillPath?: string;
  skillFolderHash: string;
  installedAt: string;
  updatedAt: string;
};

type SkillLockFile = {
  version: number;
  skills: Record<string, SkillLockEntry>;
  dismissed?: Record<string, boolean>;
};

/** Lift-able writer: speak npx's on-disk protocol. No npx, no npm import. */
export function writeCompatibleNpxInstall(opts: {
  home: string;
  name: string;
  skillMd: string;
  entry: Omit<SkillLockEntry, "installedAt" | "updatedAt">;
}): { lockPath: string; skillDir: string; lock: SkillLockFile } {
  const agentsDir = path.join(opts.home, ".agents");
  const skillDir = path.join(agentsDir, "skills", opts.name);
  const lockPath = path.join(agentsDir, ".skill-lock.json");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), opts.skillMd, "utf8");

  let lock: SkillLockFile = { version: 3, skills: {}, dismissed: {} };
  if (fs.existsSync(lockPath)) {
    lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as SkillLockFile;
  }
  const now = new Date().toISOString();
  const existing = lock.skills[opts.name];
  lock.version = 3;
  lock.skills[opts.name] = {
    ...opts.entry,
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
  };
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf8");
  return { lockPath, skillDir, lock };
}

function sha256Files(files: Record<string, string>): string {
  const hash = createHash("sha256");
  for (const rel of Object.keys(files).sort()) {
    hash.update(rel);
    hash.update(files[rel] ?? "");
  }
  return hash.digest("hex");
}

function listWithNpx(home: string): {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
} {
  const result = spawnSync("npx", ["-y", SKILLS_PKG, "list", "--json", "-g"], {
    env: {
      ...process.env,
      HOME: home,
      XDG_STATE_HOME: "",
    },
    encoding: "utf8",
    cwd: home,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

function parseListJson(stdout: string): unknown {
  const start = stdout.indexOf("[");
  if (start < 0) return null;
  return JSON.parse(stdout.slice(start)) as unknown;
}

function printControlPlanes(): void {
  console.log(`
=== Control planes considered (not built) ===

1. Compatible on-disk writer (this prototype)
   Electron already has Node fs. No new runtime. Matches the inversion:
   npx's files ARE the canonical store.

2. Spawn npx / import the skills package
   ADR-0003: packaged Electron has no reliable npx. Package is bin-only,
   engines.node >= 22.20.0; Electron 32 is Node 20. Ruled out as the
   default writer.

3. FastAPI + SQLModel as glue (typed contracts)
   The seam is right: a small interface the app calls, an adapter that
   speaks lockfile + canonical dir. Host that interface in packages/core
   (TypeScript). Do not add a Python process until a second caller exists.
   Do not persist ORM tables as a second record.

4. HTTP API inside Electron main
   IPC we already have. Same on-disk write.

Hinge for the inversion: (1) must work.
`);
}

function main(): void {
  printControlPlanes();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sb-npx-lock-writer-"));
  console.log(`Isolated HOME: ${home}\n`);

  const name = "sb-proto-lock-writer";
  const skillMd = `---
name: ${name}
description: Throwaway prototype skill. Delete with the temp HOME.
---

# ${name}

Prototype only.
`;
  const files = { "SKILL.md": skillMd };
  const written = writeCompatibleNpxInstall({
    home,
    name,
    skillMd,
    entry: {
      source: "Tyler-Reagan/skills-bank",
      sourceType: "github",
      sourceUrl: "https://github.com/Tyler-Reagan/skills-bank",
      ref: "main",
      skillFolderHash: sha256Files(files),
    },
  });

  console.log("Wrote:");
  console.log(`  lock:  ${written.lockPath}`);
  console.log(`  skill: ${written.skillDir}`);
  console.log("Lock entry:");
  console.log(JSON.stringify(written.lock.skills[name], null, 2));
  console.log("");

  console.log(`Spawning npx -y ${SKILLS_PKG} list --json -g (read-back only)...`);
  const listed = listWithNpx(home);
  console.log(`status: ${listed.status}`);
  if (listed.stderr.trim()) {
    console.log("stderr:");
    console.log(listed.stderr);
  }
  console.log("stdout:");
  console.log(listed.stdout);

  const parsed = parseListJson(listed.stdout);
  console.log("\n=== Verdict ===");
  const row = Array.isArray(parsed)
    ? parsed.find(
        (s: { name?: string }) =>
          s && typeof s === "object" && s.name === name,
      )
    : undefined;
  if (
    row &&
    typeof row === "object" &&
    row.sourceUrl === "https://github.com/Tyler-Reagan/skills-bank"
  ) {
    console.log(
      "ACCEPT: npx list --json -g returned our skill with our sourceUrl.",
    );
    process.exitCode = 0;
  } else {
    console.log("REJECT: npx did not echo our lock provenance.");
    console.log("parsed:", JSON.stringify(parsed, null, 2));
    process.exitCode = 1;
  }
  console.log(`\nTemp HOME left at ${home} (safe to rm -rf).`);
}

main();
