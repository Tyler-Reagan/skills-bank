// Local-disk diagnostics aggregator. Walks agent dirs + the registry
// index to surface Skill Diagnostics in three categories:
//   - unregistered installs in agent dirs (foreign-symlink + real-directory)
//   - broken symlinks (symlink target gone)
//   - registry-folder-missing (registered entries whose registry folder is gone)
//
// Local-only — no network calls. Reuses existing primitives:
//   - `listInstalled` walks agent dirs and classifies each installation
//     by `InstalledKind`.
//   - `buildRegistryIndex` populates the `missing: true` flag on entries
//     whose on-disk presence is gone.
//
// Not currently wired into the desktop renderer — the Installed tab's
// "Needs attention" section computes the same three categories
// continuously from the classifier instead of an on-demand scan (the
// dedicated local-diagnostics IPC that used to feed a parallel section
// was retired). Kept as a pure primitive in case a future consumer
// (CLI, a different host) wants a point-in-time snapshot.

import { buildRegistryIndex } from "../registry/build.js";
import { listInstalled } from "./installed.js";
import type { InstalledSkill } from "../shared/types.js";

export type SkillDiagnosticCategory =
  | "unregistered-installs"
  | "broken-symlinks"
  | "registry-folder-missing";

export interface SkillDiagnosticItem {
  category: SkillDiagnosticCategory;
  /** Skill name (or symlink basename for broken links). */
  name: string;
  /** One-line human-readable context. */
  detail: string;
  /**
   * Stable id for React keys + dispatch routing. Composed of category,
   * agent, and name so the same name landing in multiple agent dirs
   * gets distinct entries.
   */
  itemId: string;
  /**
   * Agent the item lives in (for category 1 + 2). Absent for the
   * missing-files category where the issue is registry-side.
   */
  agent?: string;
}

export interface SkillDiagnosticReport {
  items: SkillDiagnosticItem[];
  scannedAt: string;
}

export function scanLocalDiagnostics(
  registryRoot: string,
): SkillDiagnosticReport {
  const items: SkillDiagnosticItem[] = [];
  const scannedAt = new Date().toISOString();

  if (!registryRoot) {
    return { items, scannedAt };
  }

  let installed: InstalledSkill[];
  try {
    const index = buildRegistryIndex(registryRoot);

    // Category 3: missing-files on registered entries. `missing` is set
    // by buildRegistryIndex when the prior persisted index had the name
    // but `<registryRoot>/skills/<name>/` is gone.
    for (const entry of index.entries) {
      if (entry.missing !== true) continue;
      items.push({
        category: "registry-folder-missing",
        name: entry.name,
        detail: `Registry folder gone: ${entry.path}`,
        itemId: `reg-missing::${entry.name}`,
      });
    }

    installed = listInstalled(registryRoot, { index });
  } catch {
    // Index build failure leaves diagnostics empty — the renderer
    // shows "All clean" rather than surfacing a misleading partial
    // report. Aligns with the upstream-probe early-return semantics.
    return { items, scannedAt };
  }

  // Categories 1 & 2: from agent-dir installations.
  for (const inst of installed) {
    if (inst.kind === "foreign-symlink" || inst.kind === "real-directory") {
      items.push({
        category: "unregistered-installs",
        name: inst.name,
        detail:
          inst.kind === "foreign-symlink"
            ? `Symlink in ${inst.agent} → ${inst.target ?? "(unresolved)"}`
            : `Real directory in ${inst.agent}`,
        itemId: `unreg::${inst.agent}::${inst.name}`,
        agent: inst.agent,
      });
    } else if (inst.kind === "broken-symlink") {
      items.push({
        category: "broken-symlinks",
        name: inst.name,
        detail: `Broken symlink in ${inst.agent}${
          inst.target ? ` → ${inst.target}` : ""
        }`,
        itemId: `broken::${inst.agent}::${inst.name}`,
        agent: inst.agent,
      });
    }
  }

  return { items, scannedAt };
}
