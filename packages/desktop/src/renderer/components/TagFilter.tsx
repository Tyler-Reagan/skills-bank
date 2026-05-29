import React from "react";
import type { RegistryEntry } from "@skills-bank/core";

interface Props {
  registry: RegistryEntry[];
  /** Derived + override tags per skill name; replaces raw `e.tags` for display and filtering. */
  effectiveTagsMap: Map<string, string[]>;
  selected: string[];
  onChange: (next: string[]) => void;
  /** Close-the-panel hook: invoked when the user picks a "Clear all" action so
   *  the parent can dismiss the dropdown immediately. Selection toggles keep
   *  the panel open so the user can pick multiple tags in one trip. */
  onClearAll?: () => void;
}

/**
 * Multi-select tag list. Rendered inside a dropdown panel anchored from the
 * "Tags ▾" trigger chip in `RegistryFilters`. Tags are derived live from the
 * union of every skill's effective tags (auto-inferred + user overrides),
 * sorted by frequency descending then alphabetical. A skill matches when at
 * least one selected tag appears in its effective tags (OR semantics). Empty
 * selection means no filter.
 */
export function TagFilter({
  registry,
  effectiveTagsMap,
  selected,
  onChange,
  onClearAll,
}: Props): React.ReactElement | null {
  const counts = new Map<string, number>();
  for (const e of registry) {
    for (const t of effectiveTagsMap.get(e.name) ?? e.tags ?? []) {
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
    <div className="tag-filter-panel">
      <div className="tag-filter-panel-header">
        <span className="tag-filter-panel-title">Filter by tag</span>
        <button
          type="button"
          className="tag-filter-clear"
          onClick={() => {
            onChange([]);
            onClearAll?.();
          }}
          disabled={selected.length === 0}
        >
          Clear
        </button>
      </div>
      <div className="tag-filter-panel-list">
        {ordered.map(([tag, count]) => {
          const isActive = selectedSet.has(tag);
          return (
            <button
              key={tag}
              type="button"
              className={`tag-filter-item${isActive ? " active" : ""}`}
              onClick={() => toggle(tag)}
              aria-pressed={isActive}
            >
              <span className="tag-filter-item-label">#{tag}</span>
              <span className="tag-filter-item-count">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
