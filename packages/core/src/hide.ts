import fs from "node:fs";
import path from "node:path";
import { getStateDir } from "./paths.js";

const HIDDEN_CANON_FILE = "hidden-canon.json";

/**
 * Per-registry-root list of canon skills the user has hidden. Stored
 * at `<stateDir>/hidden-canon.json` — keeps it gitignored (the dir is
 * in the project's standard .gitignore) and naturally scoped to the
 * active linked registry so switching repos shows that repo's canon
 * fresh.
 *
 * Hide is purely a UI dormancy state: hidden skills retain
 * installations, tags, and agent links; they just don't surface in
 * the Browse/Registry views by default and aren't reachable via the
 * normal action surface. M5 chose this over an "unregister canon"
 * affordance because canon skills are upstream-owned — locally
 * unregistering them is irrecoverable from the UI.
 */
interface HiddenCanonFile {
  names: string[];
  updatedAt: string;
}

export function readHiddenCanonNames(registryRoot: string): Set<string> {
  const p = path.join(getStateDir(registryRoot), HIDDEN_CANON_FILE);
  if (!fs.existsSync(p)) return new Set();
  try {
    const raw = JSON.parse(
      fs.readFileSync(p, "utf8"),
    ) as Partial<HiddenCanonFile>;
    if (!Array.isArray(raw.names)) return new Set();
    return new Set(raw.names.filter((n): n is string => typeof n === "string"));
  } catch {
    return new Set();
  }
}

function writeHiddenCanonNames(
  registryRoot: string,
  names: Iterable<string>,
): void {
  const dir = getStateDir(registryRoot);
  fs.mkdirSync(dir, { recursive: true });
  const payload: HiddenCanonFile = {
    names: [...new Set(names)].sort(),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(dir, HIDDEN_CANON_FILE),
    JSON.stringify(payload, null, 2) + "\n",
  );
}

export function hideCanonSkill(registryRoot: string, name: string): void {
  const names = readHiddenCanonNames(registryRoot);
  names.add(name);
  writeHiddenCanonNames(registryRoot, names);
}

export function unhideCanonSkill(registryRoot: string, name: string): void {
  const names = readHiddenCanonNames(registryRoot);
  names.delete(name);
  writeHiddenCanonNames(registryRoot, names);
}
