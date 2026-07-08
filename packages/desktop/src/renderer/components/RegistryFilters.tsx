import React from "react";
import type { RegistryEntry } from "@skills-bank/core";
import { Icon } from "./Icon.js";

/**
 * Filter chip strip + sort control above the Browse grid.
 *
 * Filter model: `RegistryFilterTag`s are toggleable chips that combine
 * with AND semantics. The "All" chip is mutually exclusive with the
 * rest — clicking it clears the set. The other chips toggle into and
 * out of the active set independently.
 *
 * Two parallel filter affordances render in the same strip but live on
 * separate state:
 *   - `installedOnly` (boolean) — sits next to the registry-state
 *     chips because it reads as another state filter, but isn't part
 *     of the `RegistryFilterTag` union.
 *   - Tag dropdown ("Tags ▾") — anchored multi-select rendered via
 *     `TagFilter` in panel form; selection count shows on the trigger.
 *
 * Cross-category combinations that are mutually exclusive (e.g.
 * Personal AND Vendored) collapse to an empty result set; the user
 * sees "0 of N" and removes the conflicting chip. No internal
 * validation — the chip strip is declarative.
 *
 * Sort: orthogonal to filters. Two modes — "name" (alphabetical) and
 * "age" (by `lastCommit.date`, ascending = oldest first to surface
 * stale skills). Each mode has its own preferred default direction
 * which the user can flip via the direction button.
 */

export type RegistryFilterTag =
  | "updates"
  | "edited"
  | "missing"
  | "personal"
  | "vendored";

type RegistrySortBy = "name" | "age";
type RegistrySortDirection = "asc" | "desc";

export interface RegistrySortState {
  by: RegistrySortBy;
  direction: RegistrySortDirection;
}

interface ChipDef {
  tag: RegistryFilterTag;
  label: string;
  /** Short hover/title text — explains what the chip filters to. */
  title: string;
  matches: (entry: RegistryEntry) => boolean;
}

const CHIP_DEFS: readonly ChipDef[] = [
  {
    tag: "updates",
    label: "Updates",
    title: "Skills with a newer version available from their Origin.",
    matches: (e) => e.originUpdateAvailable === true,
  },
  {
    tag: "edited",
    label: "Edited",
    title: "Skills you've edited since their last Origin snapshot.",
    matches: (e) => e.drift === true,
  },
  {
    tag: "missing",
    label: "Missing",
    title: "Skills whose files are gone on disk.",
    matches: (e) => e.missing === true,
  },
  {
    tag: "personal",
    label: "Personal",
    title:
      "Skills authored in this repo (self-referential Origin or no Origin).",
    matches: (e) => e.bucket === "personal",
  },
  {
    tag: "vendored",
    label: "Vendored",
    title: "Skills harvested from external authors' repos.",
    matches: (e) => e.bucket === "vendored",
  },
];

/**
 * Apply the active chip set to a registry slice. Empty set = pass
 * everything through. Non-empty = entries must match every active
 * chip (AND).
 */
export function applyChipFilters(
  registry: RegistryEntry[],
  active: ReadonlySet<RegistryFilterTag>,
): RegistryEntry[] {
  if (active.size === 0) return registry;
  const predicates = CHIP_DEFS.filter((c) => active.has(c.tag)).map(
    (c) => c.matches,
  );
  return registry.filter((e) => predicates.every((p) => p(e)));
}

/**
 * Apply a sort to a filtered slice. Returns a new array; doesn't
 * mutate.
 *
 * Name sort: locale-aware, case-insensitive.
 *
 * Age sort: by `lastCommit.date` ISO timestamp. Entries without a
 * lastCommit sort to the end regardless of direction — they're
 * effectively "unknown age" and shouldn't surface as either the
 * stalest or freshest.
 */
export function applySort(
  entries: RegistryEntry[],
  sort: RegistrySortState,
): RegistryEntry[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (sort.by === "name") {
      return sign * a.name.localeCompare(b.name);
    }
    const ad = a.lastCommit?.date;
    const bd = b.lastCommit?.date;
    if (!ad && !bd) return a.name.localeCompare(b.name);
    if (!ad) return 1;
    if (!bd) return -1;
    if (ad === bd) return a.name.localeCompare(b.name);
    return sign * (ad < bd ? -1 : 1);
  });
}

/**
 * Optional priority sort: float entries matching `priority` to the
 * top regardless of the user's chosen sort. Used for the default
 * view where pending-update skills surface above everything else
 * when the user hasn't filtered or sorted explicitly.
 */
export function floatToTop(
  entries: RegistryEntry[],
  priority: (e: RegistryEntry) => boolean,
): RegistryEntry[] {
  const top: RegistryEntry[] = [];
  const rest: RegistryEntry[] = [];
  for (const e of entries) (priority(e) ? top : rest).push(e);
  return [...top, ...rest];
}

interface Props {
  registry: RegistryEntry[];
  /** Derived + override tags per skill name; replaces raw `e.tags` for display and filtering. */
  effectiveTagsMap: Map<string, string[]>;
  active: ReadonlySet<RegistryFilterTag>;
  onChange: (next: Set<RegistryFilterTag>) => void;
  sort: RegistrySortState;
  onSortChange: (next: RegistrySortState) => void;
  /** Boolean filter rendered as a chip adjacent to the state chips. */
  installedOnly: boolean;
  onInstalledOnlyChange: (next: boolean) => void;
  /** Pre-computed count of registry skills with at least one ours installation. */
  installedCount: number;
  /** Selected tag set for the Tags ▾ dropdown. */
  selectedTags: string[];
  onSelectedTagsChange: (next: string[]) => void;
}

export function RegistryFilters({
  registry,
  effectiveTagsMap,
  active,
  onChange,
  sort,
  onSortChange,
  installedOnly,
  onInstalledOnlyChange,
  installedCount,
  selectedTags,
  onSelectedTagsChange,
}: Props): React.ReactElement {
  const counts = React.useMemo(() => {
    const out = new Map<RegistryFilterTag, number>();
    for (const def of CHIP_DEFS) {
      let n = 0;
      for (const e of registry) if (def.matches(e)) n++;
      out.set(def.tag, n);
    }
    return out;
  }, [registry]);

  const allActive =
    active.size === 0 && !installedOnly && selectedTags.length === 0;

  // Tags dropdown state — owned here because the trigger is here too.
  const [tagsOpen, setTagsOpen] = React.useState(false);
  const tagsWrapRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!tagsOpen) return;
    const onDocDown = (ev: MouseEvent) => {
      const node = tagsWrapRef.current;
      if (node && ev.target instanceof Node && !node.contains(ev.target)) {
        setTagsOpen(false);
      }
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setTagsOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [tagsOpen]);

  // Glossary popover state — surfaces what each filter chip means
  // since the labels alone don't disambiguate the two orthogonal
  // axes (provenance vs location).
  const [glossaryOpen, setGlossaryOpen] = React.useState(false);
  const glossaryWrapRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!glossaryOpen) return;
    const onDocDown = (ev: MouseEvent) => {
      const node = glossaryWrapRef.current;
      if (node && ev.target instanceof Node && !node.contains(ev.target)) {
        setGlossaryOpen(false);
      }
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setGlossaryOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [glossaryOpen]);

  function toggle(tag: RegistryFilterTag): void {
    const next = new Set(active);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    onChange(next);
  }

  function clearAll(): void {
    // The "All" chip is a one-click reset for every filter affordance
    // that lives in this strip — chip set, installedOnly, and tag
    // selection. Search stays put (it's its own input outside the
    // strip).
    onChange(new Set());
    if (installedOnly) onInstalledOnlyChange(false);
    if (selectedTags.length > 0) onSelectedTagsChange([]);
  }

  function toggleSortBy(): void {
    onSortChange({
      by: sort.by === "name" ? "age" : "name",
      // Sensible defaults per mode: name → A-Z; age → oldest first
      // (the surfacing-stale framing) so toggling between them
      // doesn't strand the user in a reversed direction. Both modes
      // happen to land on "asc" by default — kept as a single literal
      // rather than a useless ternary.
      direction: "asc",
    });
  }

  function toggleSortDirection(): void {
    onSortChange({
      by: sort.by,
      direction: sort.direction === "asc" ? "desc" : "asc",
    });
  }

  // Are there any tags in the registry at all? If not, hide the
  // Tags trigger entirely — same null-result behaviour TagFilter
  // had pre-refactor.
  const hasAnyTags = React.useMemo(() => {
    for (const tags of effectiveTagsMap.values())
      if (tags.length > 0) return true;
    return false;
  }, [effectiveTagsMap]);

  return (
    <div className="registry-filters">
      <div className="registry-filters-chips" role="group" aria-label="Filters">
        <button
          type="button"
          className={`filter-chip${allActive ? " active" : ""}`}
          onClick={clearAll}
          aria-pressed={allActive}
          title="Clear all filters"
        >
          All
        </button>
        {CHIP_DEFS.map((def) => {
          // The boolean `installedOnly` chip sits between `missing`
          // and `personal` per the canonical chip ordering — render
          // it inline when we hit that seam.
          const chipNode = (() => {
            const isActive = active.has(def.tag);
            const count = counts.get(def.tag) ?? 0;
            // Suppress degenerate chips: a filter with zero matches is
            // a no-op (greys out anyway), and one that matches every
            // entry doesn't narrow the view — both surface as visual
            // noise. Keep an active chip visible regardless so the
            // user can always un-apply it from this strip.
            const useful = count > 0 && count < registry.length;
            if (!useful && !isActive) return null;
            return (
              <button
                key={def.tag}
                type="button"
                className={`filter-chip${isActive ? " active" : ""}`}
                onClick={() => toggle(def.tag)}
                aria-pressed={isActive}
                title={def.title}
              >
                {def.label} <span className="filter-chip-count">({count})</span>
              </button>
            );
          })();
          if (def.tag === "missing") {
            return (
              <React.Fragment key="missing-plus-installed">
                {chipNode}
                <button
                  key="installed-only"
                  type="button"
                  className={`filter-chip${installedOnly ? " active" : ""}`}
                  onClick={() => onInstalledOnlyChange(!installedOnly)}
                  aria-pressed={installedOnly}
                  title={
                    installedOnly
                      ? "Showing only registry skills you have installed"
                      : "Show only registry skills you have installed"
                  }
                >
                  Installed only{" "}
                  <span className="filter-chip-count">({installedCount})</span>
                </button>
              </React.Fragment>
            );
          }
          return chipNode;
        })}
        <div
          className="filter-glossary-wrap"
          ref={glossaryWrapRef}
          role="group"
          aria-label="Filter glossary"
        >
          <button
            type="button"
            className="filter-chip filter-glossary-trigger"
            onClick={() => setGlossaryOpen((v) => !v)}
            aria-haspopup="dialog"
            aria-expanded={glossaryOpen}
            aria-label="What do these filters mean?"
            title="What do these filters mean?"
          >
            <Icon name="info" size="sm" />
          </button>
          {glossaryOpen && (
            <div
              className="filter-glossary-panel"
              role="dialog"
              aria-label="Filter chip glossary"
            >
              <p className="filter-glossary-intro">
                Chips combine with <strong>AND</strong> across two axes.
              </p>
              <dl className="filter-glossary-list">
                <dt>State</dt>
                <dd>
                  <strong>Updates</strong> — newer version available from the
                  skill's Origin.
                </dd>
                <dd>
                  <strong>Edited</strong> — local content has drifted from the
                  recorded baseline.
                </dd>
                <dd>
                  <strong>Missing</strong> — the skill's files are gone on disk.
                </dd>
                <dd>
                  <strong>Installed only</strong> — currently linked into one of
                  your agent dirs.
                </dd>
                <dt>
                  Location — bucket under <code>skills/</code>
                </dt>
                <dd>
                  <strong>Personal</strong> — authored in this repo.
                </dd>
                <dd>
                  <strong>Vendored</strong> — harvested from an external repo.
                </dd>
              </dl>
              <p className="filter-glossary-note">
                Chips that match every skill or no skills auto-hide — only the
                ones that actually narrow the view show.
              </p>
            </div>
          )}
        </div>
      </div>
      <div className="registry-filters-right">
        {hasAnyTags && (
          <div
            className="tag-filter-wrap"
            ref={tagsWrapRef}
            role="group"
            aria-label="Filter by tag"
          >
            <button
              type="button"
              className={`filter-chip tag-filter-trigger${
                selectedTags.length > 0 ? " active" : ""
              }${tagsOpen ? " open" : ""}`}
              onClick={() => setTagsOpen((v) => !v)}
              aria-haspopup="true"
              aria-expanded={tagsOpen}
              title="Filter by tag"
            >
              Tags
              {selectedTags.length > 0 && (
                <>
                  {" "}
                  <span className="filter-chip-count">
                    ({selectedTags.length})
                  </span>
                </>
              )}{" "}
              <Icon
                name="chevron-down"
                size="sm"
                className="tag-filter-chevron"
              />
            </button>
            {tagsOpen && (
              <TagFilter
                registry={registry}
                effectiveTagsMap={effectiveTagsMap}
                selected={selectedTags}
                onChange={onSelectedTagsChange}
                onClearAll={() => setTagsOpen(false)}
              />
            )}
          </div>
        )}
        <div
          className="registry-filters-sort"
          role="group"
          aria-label="Sort registry"
        >
          <button
            type="button"
            className="filter-chip sort-chip"
            onClick={toggleSortBy}
            title={
              sort.by === "name"
                ? "Sorting alphabetically. Click to sort by age (last commit date) — surfaces stale skills."
                : "Sorting by age (last commit date). Click to sort alphabetically."
            }
          >
            <Icon name={sort.by === "name" ? "sort-az" : "clock"} size="sm" />{" "}
            {sort.by === "name" ? "Name" : "Age"}
          </button>
          <button
            type="button"
            className="filter-chip sort-chip"
            onClick={toggleSortDirection}
            title={
              sort.direction === "asc"
                ? sort.by === "name"
                  ? "A-Z. Click to flip to Z-A."
                  : "Oldest first (stale at top). Click to flip to newest first."
                : sort.by === "name"
                  ? "Z-A. Click to flip to A-Z."
                  : "Newest first. Click to flip to oldest first."
            }
            aria-label={`Sort direction: ${sort.direction === "asc" ? "ascending" : "descending"}`}
          >
            <Icon
              name={sort.direction === "asc" ? "arrow-up" : "arrow-down"}
              size="sm"
            />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── TagFilter (internal) ────────────────────────────────────────────
// Folded in from its own file: single-parent dropdown-panel content,
// not a reusable component.

interface TagFilterProps {
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
function TagFilter({
  registry,
  effectiveTagsMap,
  selected,
  onChange,
  onClearAll,
}: TagFilterProps): React.ReactElement | null {
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
