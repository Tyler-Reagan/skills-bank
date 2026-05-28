import React from "react";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";
import { SkillCard, agentsForSkill, statusForEntry } from "./SkillCard.js";

interface Props {
  entries: RegistryEntry[];
  installed: InstalledSkill[];
  onSelect: (entry: RegistryEntry) => void;
  emptyMessage?: React.ReactNode;
  /**
   * If provided, the empty-state renders a "Clear filters" CTA. Call it
   * only when filters are actually narrowing the result set; otherwise
   * pass undefined and the grid keeps its generic empty message.
   */
  onClearFilters?: () => void;
  /**
   * When set, cards expose quick-tag affordances (per-tag X + inline
   * add). Skipped for read-only contexts (e.g. Installed tab pending
   * cards rendered via synthetic entries — those have no registry
   * meta.json to write back to).
   */
  onSaveTags?: (name: string, next: string[]) => Promise<void> | void;
  /**
   * Bulk-install plumbing. When `selectMode` is true, each card
   * renders a leading checkbox; clicks on the card body toggle
   * selection rather than opening the detail drawer. Selection
   * state is owned by the caller (BrowseTab) so it survives
   * sort/filter changes. `isDisabled(entry)` returns true for
   * cards that should render with a non-interactive checkbox
   * (already installed); they stay visible so the user can see
   * what the bulk action would skip. `bulkStatus(entry)` annotates
   * per-card progress during a run.
   */
  selectMode?: boolean;
  selectedNames?: ReadonlySet<string>;
  onToggleSelect?: (name: string) => void;
  isDisabled?: (entry: RegistryEntry) => boolean;
  bulkStatus?: (
    entry: RegistryEntry,
  ) => "pending" | "installing" | "installed" | "failed" | undefined;
}

export function SkillsGrid({
  entries,
  installed,
  onSelect,
  emptyMessage,
  onClearFilters,
  onSaveTags,
  selectMode = false,
  selectedNames,
  onToggleSelect,
  isDisabled,
  bulkStatus,
}: Props): React.ReactElement {
  if (entries.length === 0) {
    return (
      <div className="empty-state">
        {emptyMessage ?? (
          <>
            <strong>No skills match the current filter.</strong>
            <p>Try a different search term or pick a different tag.</p>
          </>
        )}
        {onClearFilters && (
          <div className="skills-grid-clear-btn-wrap">
            <button className="btn primary" onClick={onClearFilters}>
              Clear filters
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="skills-grid">
      {entries.map((e, i) => {
        const status = bulkStatus?.(e);
        return (
          <SkillCard
            key={e.path}
            entry={e}
            status={statusForEntry(e, installed)}
            onSelect={() => onSelect(e)}
            index={i}
            agents={agentsForSkill(installed, e.name)}
            {...(onSaveTags
              ? { onSaveTags: (next: string[]) => onSaveTags(e.name, next) }
              : {})}
            selectMode={selectMode}
            selected={selectedNames?.has(e.name) ?? false}
            disableSelect={isDisabled?.(e) ?? false}
            {...(onToggleSelect
              ? { onToggleSelect: () => onToggleSelect(e.name) }
              : {})}
            {...(status ? { bulkInstallStatus: status } : {})}
          />
        );
      })}
    </div>
  );
}
