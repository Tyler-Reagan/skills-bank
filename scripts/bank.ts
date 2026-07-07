#!/usr/bin/env tsx
//
// Maintainer-internal: single entrypoint for the skill provenance
// tools. `pnpm bank <command>`.
//
// Usage:
//   pnpm bank update <name> [--from …] [--bucket personal|vendored] [--dry]
//
// `vendor` / `refresh` / `backfill` / `discover` were retired with the
// origin-only provenance model (ADR-0020/0021, issue #159) — they wrote
// per-skill `.skills-bank.json`/`.skills-bank-hash` sidecars for the
// curated `skills/vendored/` bucket, which no manifest write-seam
// survives them and which the model deliberately leaves empty going
// forward (the maintainer's own skills live in the separate
// `Tyler-Reagan/skills` repo, not this bucket).
//
// Each command delegates to its implementation module. We reshape
// process.argv to drop the leading command token so each module's
// existing `process.argv` parsing (.slice(2) / .indexOf / .includes)
// sees its flags at the original positions — the modules stay unaware
// of the dispatcher and remain individually runnable for debugging via
// `tsx scripts/<module>.ts <args>`.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const COMMANDS: Record<string, string> = {
  update: "update-skill.ts",
};

const here = path.dirname(fileURLToPath(import.meta.url));

function usage(): void {
  console.error(
    [
      "Usage: pnpm bank <command> [args]",
      "",
      "Commands:",
      "  update    <name> [--from …] [--bucket personal|vendored] [--dry] pull a locally-edited skill back into the bank",
    ].join("\n"),
  );
}

const [command, ...rest] = process.argv.slice(2);

if (!command || command === "--help" || command === "-h") {
  usage();
  process.exit(command ? 0 : 1);
}

const target = COMMANDS[command];
if (!target) {
  console.error(`Unknown command: ${command}\n`);
  usage();
  process.exit(1);
}

const targetPath = path.join(here, target);
// Reshape to `[node, <module>, ...rest]` so the delegated module's
// process.argv parsing lines up exactly as if it were invoked directly.
process.argv = [process.argv[0]!, targetPath, ...rest];

await import(pathToFileURL(targetPath).href);
