#!/usr/bin/env tsx
//
// Maintainer-internal: single entrypoint for the skill provenance &
// vendoring tools. Replaces the former one-script-per-command surface
// (`backfill:bundled` / `discover:bundled` / `vendor:skill` /
// `vendor:refresh` / `update:skill`) with `pnpm bank <command>`.
//
// Usage:
//   pnpm bank vendor   <owner/repo>@<id> [--path …] [--as …] [--force]
//   pnpm bank refresh  [--apply] [--only a,b] [--json]
//   pnpm bank backfill [--dry]
//   pnpm bank discover [--out FILE] [--apply FILE] [--source …]
//   pnpm bank update   <name> [--from …] [--bucket personal|vendored] [--dry]
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
  vendor: "vendor-skill.ts",
  refresh: "vendor-refresh.ts",
  backfill: "backfill-bundled-upstream.ts",
  discover: "discover-bundled-upstream.ts",
  update: "update-skill.ts",
};

const here = path.dirname(fileURLToPath(import.meta.url));

function usage(): void {
  console.error(
    [
      "Usage: pnpm bank <command> [args]",
      "",
      "Commands:",
      "  vendor    <owner/repo>@<id> [--path …] [--as …] [--force]        vendor a skill from a GitHub repo",
      "  refresh   [--apply] [--only a,b] [--json]                        bulk-refresh vendored skills vs upstream",
      "  backfill  [--dry]                                                stamp upstreams from bundled-upstream-mapping.json",
      "  discover  [--out FILE] [--apply FILE] [--source …]               auto-discover upstreams for unstamped skills",
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
