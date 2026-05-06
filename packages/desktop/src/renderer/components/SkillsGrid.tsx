import React from "react";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";
import { SkillCard, statusForEntry } from "./SkillCard.js";

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
}

export function SkillsGrid({
  entries,
  installed,
  onSelect,
  emptyMessage,
  onClearFilters,
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
          <div style={{ marginTop: 16 }}>
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
      {entries.map((e, i) => (
        <SkillCard
          key={e.path}
          entry={e}
          status={statusForEntry(e, installed)}
          onSelect={() => onSelect(e)}
          index={i}
        />
      ))}
    </div>
  );
}
