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
  | "bundled"
  | "yours"
  | "personal"
  | "vendored";

export type RegistrySortBy = "name" | "age";
export type RegistrySortDirection = "asc" | "desc";

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
    title: "Skills with a newer version available from their authoritative upstream.",
    matches: (e) => e.upstreamUpdateAvailable === true,
  },
  {
    tag: "edited",
    label: "Edited",
    title: "Skills you've edited since their last upstream snapshot.",
    matches: (e) => e.drift === true,
  },
  {
    tag: "missing",
    label: "Missing",
    title: "Skills whose files are gone on disk.",
    matches: (e) => e.missing === true,
  },
  {
    tag: "bundled",
    label: "Bundled",
    title: "Skills shipped with the app and managed by Sync.",
    matches: (e) => e.source.source === "bundled",
  },
  {
    tag: "yours",
    label: "Yours",
    title: "Skills you've added, merged in, or detached from Sync.",
    matches: (e) => e.source.source === "yours",
  },
  {
    tag: "personal",
    label: "Personal",
    title: "Skills authored in this repo (self-referential upstream or no upstream).",
    matches: (e) => e.bucket === "personal",
  },
  {
    tag: "vendored",
    label: "Vendored",
    title: "Skills harvested from external authors' repos.",
    matches: (e) => e.bucket === "vendored",
  },
];

/** All chip definitions, for renderers that want to enumerate. */
export const REGISTRY_CHIPS = CHIP_DEFS;

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
}

export function RegistryFilters({
  registry,
  active,
  onChange,
  sort,
  onSortChange,
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

  const allActive = active.size === 0;

  function toggle(tag: RegistryFilterTag): void {
    const next = new Set(active);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    onChange(next);
  }

  function clearAll(): void {
    onChange(new Set());
  }

  function toggleSortBy(): void {
    onSortChange({
      by: sort.by === "name" ? "age" : "name",
      // Sensible defaults per mode: name → A-Z; age → oldest first
      // (the surfacing-stale framing) so toggling between them
      // doesn't strand the user in a reversed direction.
      direction: sort.by === "name" ? "asc" : "asc",
    });
  }

  function toggleSortDirection(): void {
    onSortChange({
      by: sort.by,
      direction: sort.direction === "asc" ? "desc" : "asc",
    });
  }

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
          const isActive = active.has(def.tag);
          const count = counts.get(def.tag) ?? 0;
          return (
            <button
              key={def.tag}
              type="button"
              className={`filter-chip${isActive ? " active" : ""}`}
              onClick={() => toggle(def.tag)}
              aria-pressed={isActive}
              title={def.title}
              disabled={count === 0 && !isActive}
            >
              {def.label}{" "}
              <span className="filter-chip-count">({count})</span>
            </button>
          );
        })}
      </div>
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
  );
}
