#!/usr/bin/env tsx
//
// User-facing CLI: publish a locally-authored skill to a bank repo
// as a pull request. Counterpart to `vendor:skill` (which pulls
// upstream content INTO this repo); `publish:skill` pushes a local
// skill OUT to a bank fork the user controls.
//
// Usage:
//
//   pnpm publish:skill <name> --to <owner/repo>
//   pnpm publish:skill <name> --to <owner/repo> --from <path>
//   pnpm publish:skill <name> --to <owner/repo> --bucket vendored
//   pnpm publish:skill <name> --to <owner/repo> --branch <branch-name>
//   pnpm publish:skill <name> --to <owner/repo> --dry
//
// Default source path: ~/.claude/skills/<name>/. Override with
// --from. Default bucket: personal (the assumption is that you
// authored this skill; pass --bucket vendored if you're publishing
// a curated mirror of someone else's work).
//
// The script:
//
//   1. Validates meta.json against docs/meta-schema.json from THIS
//      repo (the schema is identical across bank forks). Refuses
//      to publish on a schema violation.
//   2. Clones <owner/repo> into a temp dir via `gh repo clone`,
//      using the user's gh auth.
//   3. Copies the skill folder into skills/<bucket>/<name>/ on a
//      new branch (default: publish/<name>).
//   4. Stamps .skills-bank.json with `source: "yours"`, capturing
//      that the bank repo received this skill from the user's
//      local install (rather than from a third-party upstream).
//   5. Commits, pushes, and opens a PR against the target repo's
//      default branch via `gh pr create`.
//
// --dry skips steps 2–5 and instead prints the validation result
// plus a summary of what would be published. Use it to sanity-check
// a skill before opening a PR.
//
// What this script does NOT do (yet — see docs/plans/bank-mode-persistence.md):
//
//   * In-app "Publish" button. The desktop UI for this lands when
//     bank-mode-persistence has shipped; that plan adds the notion
//     of a "publish target" stored per-bank in app state, so the
//     UI can call this same flow without a --to flag.
//   * Auto-detect upstream and route to that repo. Always requires
//     --to <owner/repo> for now — explicit is safer.
//
// Requires `gh` (authenticated) and `git` on PATH.

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

interface Args {
  name: string;
  to: string;
  bucket: "personal" | "vendored";
  fromPath: string;
  branch: string;
  dry: boolean;
}

function usage(): never {
  console.error(
    "usage: pnpm publish:skill <name> --to <owner/repo> [--from <path>] [--bucket personal|vendored] [--branch <name>] [--dry]",
  );
  process.exit(1);
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  if (argv.length === 0) usage();
  const name = argv[0]!;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    console.error(`invalid skill name: ${name} (must match meta.json pattern)`);
    usage();
  }
  let to = "";
  let bucket: "personal" | "vendored" = "personal";
  let fromPath = "";
  let branch = `publish/${name}`;
  let dry = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--to") to = argv[++i] ?? "";
    else if (a === "--from") fromPath = argv[++i] ?? "";
    else if (a === "--bucket") {
      const b = argv[++i];
      if (b !== "personal" && b !== "vendored") {
        console.error(`--bucket must be personal or vendored (got ${b})`);
        usage();
      }
      bucket = b;
    } else if (a === "--branch") branch = argv[++i] ?? branch;
    else if (a === "--dry") dry = true;
    else if (a === "--help" || a === "-h") usage();
    else {
      console.error(`unknown arg: ${a}`);
      usage();
    }
  }
  if (!to || !/^[\w.-]+\/[\w.-]+$/.test(to)) {
    console.error(`--to <owner/repo> is required and must be a valid slug`);
    usage();
  }
  if (!fromPath) {
    fromPath = path.join(os.homedir(), ".claude", "skills", name);
  }
  return { name, to, bucket, fromPath, branch, dry };
}

function validateSkillFolder(folder: string): { ok: true } | { ok: false; reason: string } {
  if (!fs.existsSync(folder)) {
    return { ok: false, reason: `source folder not found: ${folder}` };
  }
  const stat = fs.statSync(folder);
  if (!stat.isDirectory()) {
    return { ok: false, reason: `source path is not a directory: ${folder}` };
  }
  const skillMd = path.join(folder, "SKILL.md");
  if (!fs.existsSync(skillMd)) {
    return { ok: false, reason: `missing SKILL.md in ${folder}` };
  }
  const metaPath = path.join(folder, "meta.json");
  if (!fs.existsSync(metaPath)) {
    return {
      ok: false,
      reason: `missing meta.json in ${folder} — every published skill must ship one (synthesize from SKILL.md frontmatter if needed)`,
    };
  }
  let meta: unknown;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch (err) {
    return { ok: false, reason: `meta.json is invalid JSON: ${(err as Error).message}` };
  }
  const schemaPath = path.join(repoRoot, "docs", "meta-schema.json");
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const ajv = new (Ajv as unknown as { new (opts: object): {
    compile: (s: unknown) => (d: unknown) => boolean;
  } })({ allErrors: true, strict: false });
  (addFormats as unknown as (a: unknown) => void)(ajv);
  const validate = ajv.compile(schema);
  if (!validate(meta)) {
    return {
      ok: false,
      reason: `meta.json fails schema validation against docs/meta-schema.json`,
    };
  }
  return { ok: true };
}

async function run(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, { cwd: opts.cwd, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

// Stream stdout/stderr to the terminal — used for git push and
// gh pr create where the user wants to see auth prompts and live
// progress rather than waiting for a buffered chunk.
async function runStreamed(
  cmd: string,
  args: string[],
  opts: { cwd?: string } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
    });
  });
}

function copyFolder(src: string, dest: string): number {
  let count = 0;
  function walk(s: string, d: string): void {
    fs.mkdirSync(d, { recursive: true });
    for (const entry of fs.readdirSync(s, { withFileTypes: true })) {
      // Skip the local source marker — destination gets a fresh one.
      // Skip the synced-hash sidecar — only meaningful in the source
      // registry's drift-detection context.
      if (entry.name === ".skills-bank.json" || entry.name === ".skills-bank-hash") continue;
      const sp = path.join(s, entry.name);
      const dp = path.join(d, entry.name);
      if (entry.isDirectory()) walk(sp, dp);
      else if (entry.isFile()) {
        fs.copyFileSync(sp, dp);
        count++;
      } else if (entry.isSymbolicLink()) {
        const target = fs.readlinkSync(sp);
        fs.symlinkSync(target, dp);
        count++;
      }
    }
  }
  walk(src, dest);
  return count;
}

async function publish(): Promise<void> {
  const args = parseArgs();
  console.log(`▸ Publishing ${args.name} from ${args.fromPath}`);
  console.log(`  → ${args.to} (bucket: ${args.bucket}, branch: ${args.branch})`);

  const validation = validateSkillFolder(args.fromPath);
  if (!validation.ok) {
    console.error(`\n✖ Validation failed: ${validation.reason}`);
    process.exit(1);
  }
  console.log(`✓ Local validation passed`);

  if (args.dry) {
    console.log("\n--dry: would copy folder, push branch, and open PR. Stopping here.");
    return;
  }

  // Verify gh auth before doing any disk work — fail fast.
  try {
    await run("gh", ["auth", "status"]);
  } catch {
    console.error(
      "\n✖ `gh auth status` failed — run `gh auth login` before publishing.",
    );
    process.exit(1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "publish-skill-"));
  const cloneDir = path.join(tmp, "bank");
  console.log(`\n▸ Cloning ${args.to} → ${cloneDir}`);
  await runStreamed("gh", ["repo", "clone", args.to, cloneDir, "--", "--depth=1"]);

  // Refuse if the destination already has this skill — surfaces
  // accidental name collisions before we make a branch with a
  // misleading diff. The maintainer either picks a new name or
  // (intentionally) replaces upstream via `vendor:skill --force` on
  // the bank side, not via publish.
  for (const bucket of ["personal", "vendored"] as const) {
    const dest = path.join(cloneDir, "skills", bucket, args.name);
    if (fs.existsSync(dest)) {
      console.error(
        `\n✖ ${args.to} already has skills/${bucket}/${args.name}. ` +
          `Pick a new --name, or open a PR by hand if this is an intentional update.`,
      );
      process.exit(1);
    }
  }

  await run("git", ["checkout", "-b", args.branch], { cwd: cloneDir });

  const destFolder = path.join(cloneDir, "skills", args.bucket, args.name);
  const copied = copyFolder(args.fromPath, destFolder);
  console.log(`✓ Mirrored ${copied} files into skills/${args.bucket}/${args.name}/`);

  // Stamp a fresh .skills-bank.json marking provenance as "yours" —
  // the bank received this skill from the user's local authoring
  // pipeline rather than from a third-party upstream. The repo's
  // own backfill/discover scripts can later promote this to a
  // bundled marker once it's been adopted by maintainers.
  const marker = {
    source: "yours" as const,
    upstream: { kind: "none" as const },
  };
  fs.writeFileSync(
    path.join(destFolder, ".skills-bank.json"),
    JSON.stringify(marker, null, 2) + "\n",
  );

  await run("git", ["add", "."], { cwd: cloneDir });
  await run(
    "git",
    [
      "commit",
      "-m",
      `feat(${args.bucket}): add ${args.name} skill`,
    ],
    { cwd: cloneDir },
  );

  console.log(`\n▸ Pushing ${args.branch} to origin`);
  await runStreamed("git", ["push", "-u", "origin", args.branch], { cwd: cloneDir });

  console.log(`\n▸ Opening PR`);
  await runStreamed(
    "gh",
    [
      "pr",
      "create",
      "--fill",
      "--title",
      `Add ${args.name} skill`,
      "--body",
      `Publishes the locally-authored \`${args.name}\` skill into \`skills/${args.bucket}/\`.\n\nGenerated via \`pnpm publish:skill\`. Run \`pnpm validate && pnpm build:index\` on this branch before merging.`,
    ],
    { cwd: cloneDir },
  );

  console.log(`\n✓ Published. Clone dir kept at ${cloneDir} for inspection.`);
}

publish().catch((err) => {
  console.error("publish:skill failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
