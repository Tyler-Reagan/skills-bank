import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/** @deprecated since v1.20.3 — no callers anywhere in the repo; removal target: next minor (post-1.0 convention: one deprecation cycle). */
export function getClaudeHome(): string {
  return process.env["CLAUDE_HOME"] ?? path.join(os.homedir(), ".claude");
}

/** @deprecated since v1.20.3 — no callers anywhere in the repo; removal target: next minor (post-1.0 convention: one deprecation cycle). */
export function getClaudeSkillsDir(): string {
  return path.join(getClaudeHome(), "skills");
}

/**
 * Walks up from `start` looking for a directory that contains both `package.json`
 * (with name "skills-bank") and a `skills/` folder. Throws if not found.
 */
export function findRegistryRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  while (true) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg)) {
      try {
        const data = JSON.parse(fs.readFileSync(pkg, "utf8")) as {
          name?: string;
        };
        if (
          data.name === "skills-bank" &&
          fs.existsSync(path.join(dir, "skills"))
        ) {
          return dir;
        }
      } catch {
        // ignore
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not locate skills-bank registry root from ${start}. ` +
      `Run from inside the skills-bank repo or set SKILLS_BANK_ROOT.`,
  );
}

export function resolveRegistryRoot(explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  const env = process.env["SKILLS_BANK_ROOT"];
  if (env) return path.resolve(env);
  return findRegistryRoot();
}

export function getStateDir(registryRoot: string): string {
  return path.join(registryRoot, ".skills-bank");
}
