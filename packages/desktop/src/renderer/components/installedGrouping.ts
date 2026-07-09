import type {
  AgentId,
  DrawerStateClassification,
  InstalledSkill,
  RegistryEntry,
} from "@skills-bank/core";

/**
 * Pure logic for the Installed tab: grouping raw per-agent installations
 * by skill name, classifying which installations are a resolvable
 * Conflict, and building a stand-in registry entry for an unregistered
 * skill. Kept out of `InstalledTab.tsx` because these are also consumed
 * by `App.tsx` and `ModalHost.tsx` (the resolve-all / repair-all /
 * drawer flows) — a presentational component should not be the source
 * those import from.
 */

export interface InstalledGroup {
  name: string;
  agents: AgentId[];
  representative: InstalledSkill;
  /**
   * Group-level status: "ours" if ANY installation is properly linked
   * to the registry; otherwise the most actionable straggler kind in
   * source-priority order (real-directory > foreign-symlink > broken).
   * Was previously "first-encountered, only downgrades from ours" which
   * stranded find-skills-style skills (registered + leftover real-dir
   * elsewhere) in the Not-Registered section.
   */
  kind: InstalledSkill["kind"];
  /**
   * Non-ours installations of the same skill name in agent dirs other
   * than the registry-symlink ones. Surfaced to the drawer as
   * resolvable conflicts (duplicate real-dir, stale symlink, etc.).
   */
  conflicts: InstalledSkill[];
}

export function aggregateByName(installed: InstalledSkill[]): InstalledGroup[] {
  const map = new Map<string, InstalledGroup>();
  for (const i of installed) {
    const existing = map.get(i.name);
    if (!existing) {
      map.set(i.name, {
        name: i.name,
        agents: [i.agent],
        representative: i,
        kind: i.kind,
        conflicts: i.kind === "ours" ? [] : [i],
      });
      continue;
    }
    if (!existing.agents.includes(i.agent)) existing.agents.push(i.agent);

    // Upgrade group to "ours" if any entry is registry-managed —
    // surfaces the skill in the Registered section even when stragglers
    // exist elsewhere.
    if (i.kind === "ours") {
      if (existing.kind !== "ours") {
        existing.kind = "ours";
        existing.representative = i;
      }
    } else {
      existing.conflicts.push(i);
      // No upgrade. If existing already "ours", keep it. Otherwise pick
      // the more actionable kind (real-directory beats foreign-symlink
      // beats broken-symlink) so the card status reads usefully.
      if (
        existing.kind !== "ours" &&
        kindRank(i.kind) > kindRank(existing.kind)
      ) {
        existing.kind = i.kind;
        existing.representative = i;
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * An `InstalledGroup` paired with its drawer-state classification and the
 * resolved registry entry (real hit or a synthetic stand-in). Produced
 * once in `InstalledTab` and sliced into the needs-attention / registered
 * / unregistered sections; `NeedsAttentionSection` consumes its slice.
 */
export interface ClassifiedGroup {
  g: InstalledGroup;
  classification: DrawerStateClassification;
  entry: RegistryEntry;
  registryHit: RegistryEntry | undefined;
}

function kindRank(k: InstalledSkill["kind"]): number {
  switch (k) {
    case "real-directory":
      return 3;
    case "foreign-symlink":
      return 2;
    case "broken-symlink":
      return 1;
    default:
      return 0;
  }
}

/**
 * Which of a skill's installations count as a resolvable Conflict, and
 * whether "replace with symlink to registry" can be offered. Registered
 * skills exclude broken-symlink entries (Repair handles those
 * separately) and can offer replace-with-symlink (there's a registry
 * copy to point at); unregistered skills include broken entries (no
 * separate repair path exists yet) and can't offer replace-with-symlink
 * (nothing to point at until the user picks one to Register). Was
 * duplicated identically across App.tsx's InstalledTab wiring and
 * ModalHost's drawer + InstallConflictModal wiring.
 */
export function selectResolvableConflicts(
  installations: InstalledSkill[],
  isRegistered: boolean,
): { conflicts: InstalledSkill[]; allowReplaceWithSymlink: boolean } {
  const conflicts = isRegistered
    ? installations.filter(
        (i) => i.kind !== "ours" && i.kind !== "broken-symlink",
      )
    : installations.filter((i) => i.kind !== "ours");
  return { conflicts, allowReplaceWithSymlink: isRegistered };
}

/**
 * A stand-in `RegistryEntry` for a skill that isn't registered yet, so
 * the drawer can render the same Register / Manage-links / Remove
 * surface it shows for a real registry hit. Prefers the real hit when
 * one exists (a registered skill with stragglers elsewhere).
 */
export function syntheticEntryFromInstall(
  install: InstalledSkill,
  registryHit: RegistryEntry | undefined,
): RegistryEntry {
  return (
    registryHit ?? {
      name: install.name,
      description: install.target ?? install.linkPath,
      path: install.linkPath,
      origin: { url: null },
    }
  );
}
