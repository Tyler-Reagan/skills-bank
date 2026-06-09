// Local-disk diagnostics aggregator. Walks agent dirs + the registry
// index to surface "needs attention" items in four categories:
//   - unregistered installs in agent dirs (foreign-symlink + real-directory)
//   - broken symlinks (symlink target gone)
//   - external-target-missing (non-adopted entries whose target vanished)
//   - registry-folder-missing (adopted entries whose registry folder is gone)
//
// Local-only — no network calls. Reuses existing primitives:
//   - `listInstalled` walks agent dirs + custom dirs and classifies each
//     installation by `InstalledKind`.
//   - `buildRegistryIndex` populates the `missing: true` flag on entries
//     whose on-disk presence is gone.
//
// Renderer consumes the report to render a "Needs attention" section on
// the Installed tab; per-item fix actions reuse the existing register /
// deleteUnregistered / forgetMissing IPCs.

import { buildRegistryIndex } from "../registry/build.js";
import { listInstalled } from "./installed.js";
import type { InstalledSkill } from "../shared/types.js";

export type DiagnosticCategory =
  | "unregistered-installs"
  | "broken-symlinks"
  | "external-target-missing"
  | "registry-folder-missing";

export interface DiagnosticItem {
  category: DiagnosticCategory;
  /** Skill name (or symlink basename for broken links). */
  name: string;
  /** One-line human-readable context. */
  detail: string;
  /**
   * Stable id for React keys + dispatch routing. Composed of category,
   * agent, name, and customDir so the same name landing in multiple
   * agent dirs gets distinct entries.
   */
  itemId: string;
  /**
   * Agent the item lives in (for category 1 + 2). Absent for missing-
   * file categories where the issue is registry-side.
   */
  agent?: string;
  /** Custom dir path if the entry came from one. */
  customDir?: string;
}

export interface DiagnosticReport {
  items: DiagnosticItem[];
  scannedAt: string;
}

export interface ScanLocalDiagnosticsOptions {
  customSkillsDirs?: string[];
}

export function scanLocalDiagnostics(
  registryRoot: string,
  opts: ScanLocalDiagnosticsOptions = {},
): DiagnosticReport {
  const items: DiagnosticItem[] = [];
  const scannedAt = new Date().toISOString();

  if (!registryRoot) {
    return { items, scannedAt };
  }

  let installed: InstalledSkill[];
  try {
    const index = buildRegistryIndex(registryRoot);

    // Categories 3 & 4: missing-files on registered entries. `missing`
    // is set by buildRegistryIndex when the prior persisted index had
    // the name but `<registryRoot>/skills/<name>/` (adopted) or the
    // external target (non-adopted) is gone.
    for (const entry of index.entries) {
      if (entry.missing !== true) continue;
      const isExternal = entry.adopted === false;
      items.push({
        category: isExternal
          ? "external-target-missing"
          : "registry-folder-missing",
        name: entry.name,
        detail: isExternal
          ? `External target gone: ${entry.path}`
          : `Registry folder gone: ${entry.path}`,
        itemId: `${isExternal ? "ext" : "reg"}-missing::${entry.name}`,
      });
    }

    installed = listInstalled(registryRoot, {
      index,
      ...(opts.customSkillsDirs ? { customDirs: opts.customSkillsDirs } : {}),
    });
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
            ? `Symlink in ${inst.agent}${
                inst.customDir ? ` (${inst.customDir})` : ""
              } → ${inst.target ?? "(unresolved)"}`
            : `Real directory in ${inst.agent}${
                inst.customDir ? ` (${inst.customDir})` : ""
              }`,
        itemId: `unreg::${inst.agent}::${inst.name}::${inst.customDir ?? ""}`,
        agent: inst.agent,
        ...(inst.customDir ? { customDir: inst.customDir } : {}),
      });
    } else if (inst.kind === "broken-symlink") {
      items.push({
        category: "broken-symlinks",
        name: inst.name,
        detail: `Broken symlink in ${inst.agent}${
          inst.customDir ? ` (${inst.customDir})` : ""
        }${inst.target ? ` → ${inst.target}` : ""}`,
        itemId: `broken::${inst.agent}::${inst.name}::${inst.customDir ?? ""}`,
        agent: inst.agent,
        ...(inst.customDir ? { customDir: inst.customDir } : {}),
      });
    }
  }

  return { items, scannedAt };
}
