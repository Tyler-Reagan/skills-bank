import React from "react";
import type { RegistryEntry } from "@skills-bank/core";

interface Props {
  registry: RegistryEntry[];
  selected: string[];
  onChange: (next: string[]) => void;
}

/**
 * Multi-select tag filter. Pills are derived live from the union of every
 * skill's `tags`, sorted by frequency descending then alphabetical.
 * Clicking toggles selection. A skill matches when at least one selected
 * tag appears in its `tags` (OR semantics). Empty selection means no
 * filter.
 */
export function TagFilter({
  registry,
  selected,
  onChange,
}: Props): React.ReactElement | null {
  const counts = new Map<string, number>();
  for (const e of registry) {
    for (const t of e.tags ?? []) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  const ordered = Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });

  if (ordered.length === 0) return null;

  const selectedSet = new Set(selected);
  const toggle = (tag: string) => {
    if (selectedSet.has(tag)) onChange(selected.filter((t) => t !== tag));
    else onChange([...selected, tag]);
  };

  return (
    <div className="domain-filter">
      <button
        className={`domain-pill ${selected.length === 0 ? "active" : ""}`}
        onClick={() => onChange([])}
      >
        All <span className="count">{registry.length}</span>
      </button>
      {ordered.map(([tag, count]) => {
        const isActive = selectedSet.has(tag);
        return (
          <button
            key={tag}
            className={`domain-pill ${isActive ? "active" : ""}`}
            onClick={() => toggle(tag)}
          >
            #{tag} <span className="count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
