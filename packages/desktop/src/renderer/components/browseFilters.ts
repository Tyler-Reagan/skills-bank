import type { RegistryEntry } from "@skills-bank/core";

/**
 * The Browse tab's filter + sort model — the pure algebra behind the
 * chip strip rendered by `RegistryFilters.tsx`. Kept in its own module
 * (not the `.tsx` component) because the consumers are non-presentational:
 * `BrowseTab.tsx` applies these to derive the visible slice, and the
 * `useBrowseFilters` / `useRescanController` hooks reference the types and
 * seed the active set. A React component should not be the source these
 * import from.
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

export interface ChipDef {
  tag: RegistryFilterTag;
  label: string;
  /** Short hover/title text — explains what the chip filters to. */
  title: string;
  matches: (entry: RegistryEntry) => boolean;
}

export const CHIP_DEFS: readonly ChipDef[] = [
  {
    tag: "updates",
    label: "Updates",
    title: "Skills with a newer version available from their Origin.",
    matches: (e) => e.skillUpdateAvailable === true,
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
