#!/usr/bin/env tsx
//
// Dev-mode helper: wipe the Skills Bank desktop app's userData state so
// the next launch behaves like a first install. Use this between manual
// test runs of LoginScreen / sync / repo-picker flows.
//
// Default mode deletes:
//   - config.json   (registryRoot, persona)
//   - auth.enc      (encrypted GitHub token)
//
// `--hard` additionally deletes:
//   - registry/     (the entire app-managed registry directory, including
//                    .skills-bank/ state and any synced or imported skills)
//
// Run via: `pnpm run desktop:reset` or `pnpm run desktop:reset --hard`.
// Caveat: if `SKILLS_BANK_ROOT` is set in your shell, the next launch will
// auto-set persona=convenience at boot and skip the LoginScreen — `unset`
// it before relaunching if you're testing the LoginScreen path.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function userDataDir(): string {
  const appName = "Skills Bank";
  switch (process.platform) {
    case "darwin":
      return path.join(os.homedir(), "Library", "Application Support", appName);
    case "win32":
      return path.join(
        process.env["APPDATA"] ?? path.join(os.homedir(), "AppData", "Roaming"),
        appName,
      );
    default:
      // Linux / freebsd / etc. — Electron uses XDG_CONFIG_HOME.
      return path.join(
        process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config"),
        appName,
      );
  }
}

function rm(target: string, label: string): void {
  if (!fs.existsSync(target)) {
    console.log(`  - ${label}: not present (skip)`);
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`  ✓ removed ${label}`);
}

const hard = process.argv.includes("--hard");
const dir = userDataDir();

console.log(`Resetting desktop config under:\n  ${dir}\n`);

if (!fs.existsSync(dir)) {
  console.log("  (userData dir does not exist — nothing to reset)");
  process.exit(0);
}

rm(path.join(dir, "config.json"), "config.json");
rm(path.join(dir, "auth.enc"), "auth.enc");
if (hard) {
  rm(path.join(dir, "registry"), "registry/ (full wipe)");
}

console.log(
  hard
    ? "\nReset complete (hard). Next launch starts fresh — LoginScreen, no skills, no token."
    : "\nReset complete. Next launch shows LoginScreen.",
);
console.log(
  "If SKILLS_BANK_ROOT is set in your shell, `unset` it before relaunching to see the LoginScreen.",
);
