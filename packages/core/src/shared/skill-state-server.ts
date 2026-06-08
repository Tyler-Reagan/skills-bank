import { buildRegistryIndex } from "../build.js";
import { listInstalled } from "../installed.js";
import {
  classifyDrawerState,
  type ClassifyOptions,
  type DrawerStateClassification,
} from "./skill-state.js";
import type { RegistryEntry } from "./types.js";

/**
 * Classify a skill by name against the current state of `registryRoot`.
 * Convenience for IPC handlers that need to consult the capability
 * table before mutating state. Returns null when the name has no
 * registry entry and no installations — there's nothing to classify.
 *
 * Lives in a node-only module (uses build/installed) so the
 * renderer-safe `skill-state` entry stays free of node imports.
 *
 * Synthesizes a minimal RegistryEntry for unregistered installations
 * so the unregistered branch of the classifier has the inputs it
 * expects. Keeps callers from having to know that asymmetry.
 */
export function classifySkillByName(
  registryRoot: string,
  name: string,
  options: ClassifyOptions = {},
): DrawerStateClassification | null {
  const index = buildRegistryIndex(registryRoot);
  const installed = listInstalled(registryRoot, { index });
  const entry = index.entries.find((e) => e.name === name);
  const mine = installed.filter((i) => i.name === name);
  if (!entry && mine.length === 0) return null;

  const classifyEntry: RegistryEntry =
    entry ??
    ({
      name,
      description: "",
      path: mine[0]?.linkPath ?? name,
      source: { source: "user" },
    } as RegistryEntry);

  return classifyDrawerState(classifyEntry, installed, !!entry, options);
}
