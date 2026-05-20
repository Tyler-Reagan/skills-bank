import React from "react";
import type { RegistryEntry } from "@skills-bank/core";
import { Icon } from "./Icon.js";
import { TagFilter } from "./TagFilter.js";

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
 * Cross-category combinations the model allows but the data forbids
 * (e.g. Bundled AND Yours, Personal AND Vendored) collapse to an
 * empty result set; the user sees "0 of N" and figures out which
 * chip to remove. No internal validation — the chip strip is
 * declarative.
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
  | "curated"
  | "user"
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
    tag: "curated",
    label: "Curated",
    title: "Skills curated as part of the bank's set — managed by Sync.",
    matches: (e) => e.source.source === "curated",
  },
  {
    tag: "user",
    label: "Mine",
    title: "Skills you authored or unlinked from a curated set.",
    matches: (e) => e.source.source === "user",
  },
  {
    tag: "personal",
    label: "Personal",
    title: "Skills authored in this repo (self-referential Origin or no Origin).",
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
    for (const e of registry) if ((e.tags?.length ?? 0) > 0) return true;
    return false;
  }, [registry]);

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
          // and `bundled` per the canonical chip ordering — render
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
                {def.label}{" "}
                <span className="filter-chip-count">({count})</span>
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
                Chips combine with <strong>AND</strong>. The chips fall on
                three independent axes — a skill can match one from each.
              </p>
              <dl className="filter-glossary-list">
                <dt>State</dt>
                <dd>
                  <strong>Updates</strong> — newer version available from
                  the skill's Origin.
                </dd>
                <dd>
                  <strong>Edited</strong> — local content has drifted from
                  the recorded baseline.
                </dd>
                <dd>
                  <strong>Missing</strong> — the skill's files are gone on
                  disk.
                </dd>
                <dd>
                  <strong>Installed only</strong> — currently installed in
                  one of your agent dirs.
                </dd>
                <dt>Provenance — where the bytes came from</dt>
                <dd>
                  <strong>Bundled</strong> — shipped with the app's
                  curation set; managed by Sync.
                </dd>
                <dd>
                  <strong>Yours</strong> — you added it (merge-import) or
                  detached it from the curation set.
                </dd>
                <dt>Location — folder bucket under <code>skills/</code></dt>
                <dd>
                  <strong>Personal</strong> — authored in this repo
                  (self-referential Origin or no Origin).
                </dd>
                <dd>
                  <strong>Vendored</strong> — harvested from external
                  authors' repos.
                </dd>
              </dl>
              <p className="filter-glossary-note">
                Chips that match every skill or no skills auto-hide — only
                the ones that actually narrow the view show.
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
