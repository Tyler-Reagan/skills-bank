import React from "react";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";
import { SkillCard, type CardStatus } from "./SkillCard.js";
import { Icon } from "./Icon.js";
import type { ClassifiedGroup, InstalledGroup } from "./installedGrouping.js";

interface Props {
  /** The needs-attention slice of the parent's classified groups (non-empty). */
  groups: ClassifiedGroup[];
  onSelectIntegrated: (entry: RegistryEntry) => void;
  onRegisterOne: (entry: InstalledSkill) => void;
  onResolveConflicts?: (group: InstalledGroup) => void;
  onRepairBroken?: (group: InstalledGroup) => void;
  onResolveAllConflicts?: (groups: InstalledGroup[]) => void;
  onRepairAllBroken?: (groups: InstalledGroup[]) => void;
}

/**
 * The "Needs attention" section of the Installed tab: conflicts and
 * broken links that block a skill from working cleanly. Each card
 * resolves inline (no drawer detour); the header offers bulk repair /
 * resolve when more than one group shares a primary action.
 *
 * Rendered only when the slice is non-empty — the parent gates on that.
 */
export function NeedsAttentionSection({
  groups,
  onSelectIntegrated,
  onRegisterOne,
  onResolveConflicts,
  onRepairBroken,
  onResolveAllConflicts,
  onRepairAllBroken,
}: Props): React.ReactElement {
  // Bulk-resolve only applies to registered conflicts (the primary the
  // existing InstallCollisionModal can handle). It skips broken-symlink
  // groups (need source decisions) and unregistered-conflicts groups
  // (need per-installation registration choices, not per-agent
  // replace/delete/keep).
  const bulkResolvable = groups
    .filter(
      (c) => c.classification.capabilities.primary === "resolve-conflicts",
    )
    .map((c) => c.g);
  const bulkRepairable = groups
    .filter((c) => c.classification.capabilities.primary === "repair-broken")
    .map((c) => c.g);
  return (
    <section>
      <header className="section-header">
        <div>
          <h2 className="row-center-8">
            <span className="inline-center text-warn" aria-hidden="true">
              <Icon name="alert-triangle" size="sm" />
            </span>
            Needs attention <span className="count">({groups.length})</span>
          </h2>
          <p>
            Conflicts or broken links that block the skill from working cleanly.
            The action button on each card resolves it inline — no drawer
            detour.
          </p>
        </div>
        <div className="row-center-6">
          {bulkRepairable.length > 1 && onRepairAllBroken && (
            <button
              className="btn inline-center-6"
              onClick={() => onRepairAllBroken(bulkRepairable)}
              title={`Re-link the broken symlinks for ${bulkRepairable.length} skills in one step. If a link can't be repaired (the registry copy is gone) you'll be prompted to remove the dead links.`}
            >
              <Icon name="broken-link" size="sm" />
              Fix broken link(s) ({bulkRepairable.length})
            </button>
          )}
          {bulkResolvable.length > 1 && onResolveAllConflicts && (
            <button
              className="btn warn inline-center-6"
              onClick={() => onResolveAllConflicts(bulkResolvable)}
              title={`Replace duplicates with symlinks to Skills Bank for ${bulkResolvable.length} skills in one step.`}
            >
              <Icon name="alert-triangle" size="sm" />
              Resolve all ({bulkResolvable.length})
            </button>
          )}
        </div>
      </header>
      <div className="skills-grid">
        {groups.map((c, i) => {
          const { g, classification, entry, registryHit } = c;
          const s = g.representative;
          const status: CardStatus =
            g.kind === "foreign-symlink"
              ? { kind: "external", targetLabel: s.target ?? "" }
              : g.kind === "real-directory"
                ? { kind: "real-directory" }
                : g.kind === "broken-symlink"
                  ? { kind: "broken-symlink" }
                  : { kind: "installed" };
          const onCardClick = () => {
            if (registryHit) onSelectIntegrated(registryHit);
            else onRegisterOne(s);
          };
          const prim = classification.capabilities.primary;
          let inlineLabel: string | null = null;
          let inlineHandler: (() => void) | null = null;
          if (prim === "repair-broken" && onRepairBroken) {
            const n = classification.brokenCount;
            inlineLabel = `Fix broken link${n === 1 ? "" : "s"} (${n})`;
            inlineHandler = () => onRepairBroken(g);
          } else if (prim === "resolve-conflicts" && onResolveConflicts) {
            const n = classification.conflictCount;
            inlineLabel = `Resolve ${n} conflict${n === 1 ? "" : "s"}`;
            inlineHandler = () => onResolveConflicts(g);
          } else if (
            prim === "resolve-registration-conflicts" &&
            onResolveConflicts
          ) {
            // Multi-install unregistered: route to InstallCollisionModal
            // in its level-pure mode (delete/keep only, no
            // replace-with-symlink, no adopt). After resolving, the card
            // lands in Unregistered where the separate Register step
            // lives. App.tsx's onResolveConflicts derives the modal mode
            // from registry membership.
            const totalInstalls =
              classification.conflictCount + classification.brokenCount;
            inlineLabel = `Resolve ${totalInstalls} conflict${totalInstalls === 1 ? "" : "s"}`;
            inlineHandler = () => onResolveConflicts(g);
          }
          const inlineEnabled = inlineLabel !== null && inlineHandler !== null;
          const isBroken = prim === "repair-broken";
          return (
            <div key={g.name} className="action-cell">
              {inlineEnabled && inlineHandler && (
                <button
                  className="btn warn inline-center-6 fw-600"
                  onClick={inlineHandler}
                  title={
                    isBroken
                      ? "Try to find a usable source elsewhere; otherwise prompt to delete."
                      : `${classification.conflictCount} agent dir(s) have duplicate or stale entries — pick how to handle each.`
                  }
                >
                  <Icon name="alert-triangle" size="sm" />
                  {inlineLabel}
                </button>
              )}
              <SkillCard
                entry={entry}
                status={status}
                onSelect={onCardClick}
                index={i}
                agents={g.agents}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
