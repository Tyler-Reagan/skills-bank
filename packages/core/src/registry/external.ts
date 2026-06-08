import fs from "node:fs";
import path from "node:path";
import { getStateDir } from "../shared/paths.js";

/**
 * Persistence for non-adopted (symlink-mode) registry entries. M3
 * generalized this from the foreign-symlink-only `register-external`
 * action to the unified register flow — any source kind can be
 * recorded here, and `buildRegistryIndex` merges these in as
 * `adopted: false` entries so the renderer sees them in the registry
 * view, not just the Installed tab.
 *
 * File layout kept identical to pre-M3 `external.json` so old entries
 * load forward without migration: `[{ name, target, registeredAt }]`.
 *
 * Lives in its own module to break the import cycle between build.ts
 * (which needs to read these entries to merge them into the index)
 * and import.ts (which writes them via the unified register op).
 */
export interface ExternalEntry {
  name: string;
  target: string;
  registeredAt: string;
}

export function externalRegistryPath(registryRoot: string): string {
  return path.join(getStateDir(registryRoot), "external.json");
}

export function readExternalRegistry(registryRoot: string): ExternalEntry[] {
  const p = externalRegistryPath(registryRoot);
  if (!fs.existsSync(p)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e): e is ExternalEntry =>
        e !== null &&
        typeof e === "object" &&
        typeof (e as ExternalEntry).name === "string" &&
        typeof (e as ExternalEntry).target === "string",
    );
  } catch {
    return [];
  }
}

export function writeExternalRegistry(
  registryRoot: string,
  name: string,
  target: string,
): void {
  const p = externalRegistryPath(registryRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const list = readExternalRegistry(registryRoot).filter(
    (e) => e.name !== name,
  );
  list.push({ name, target, registeredAt: new Date().toISOString() });
  fs.writeFileSync(p, JSON.stringify(list, null, 2) + "\n");
}

/**
 * Remove a non-adopted entry. Used by unregister (M4) and by the
 * adopt-on-second-register path when a previously symlink-mode entry
 * is re-registered with adoption.
 */
export function removeExternalRegistryEntry(
  registryRoot: string,
  name: string,
): void {
  const p = externalRegistryPath(registryRoot);
  if (!fs.existsSync(p)) return;
  const list = readExternalRegistry(registryRoot).filter(
    (e) => e.name !== name,
  );
  fs.writeFileSync(p, JSON.stringify(list, null, 2) + "\n");
}
