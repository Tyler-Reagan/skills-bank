import React from "react";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";
import { SkillCard, statusForEntry } from "./SkillCard.js";

interface Props {
  entries: RegistryEntry[];
  installed: InstalledSkill[];
  onSelect: (entry: RegistryEntry) => void;
  emptyMessage?: React.ReactNode;
}

export function SkillsGrid({
  entries,
  installed,
  onSelect,
  emptyMessage,
}: Props): React.ReactElement {
  if (entries.length === 0) {
    return (
      <div className="empty-state">
        {emptyMessage ?? (
          <>
            <strong>No skills match the current filter.</strong>
            <p>Try clearing the search or picking a different domain.</p>
          </>
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
