import type {
  AgentId,
  DrawerStateClassification,
  InstalledSkill,
  RegistryEntry,
} from "@skills-bank/core";

/**
 * Groups raw per-agent installations by skill name for the Installed
 * tab. Pure logic, kept out of `InstalledTab.tsx` because `InstalledGroup`
 * is also consumed by `App.tsx` and `ModalHost.tsx` (the resolve-all /
 * repair-all flows) — a presentational component should not be the type
 * source those import from.
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
