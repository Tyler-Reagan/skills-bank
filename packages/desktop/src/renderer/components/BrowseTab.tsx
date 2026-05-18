import React from "react";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";
import { InfoTooltip } from "./InfoTooltip.js";
import { SearchBar } from "./SearchBar.js";
import { SkillsGrid } from "./SkillsGrid.js";
import {
  RegistryFilters,
  applyChipFilters,
  applySort,
  floatToTop,
  type RegistryFilterTag,
  type RegistrySortState,
} from "./RegistryFilters.js";

const REGISTRY_TOOLTIP =
  "Skills in your registry — the curated bundled set by default, or a " +
  "GitHub repo you've linked. Click Refresh from <repo> in the header to " +
  "pull the latest; your local edits and added skills are preserved through " +
  "the diff-before-apply flow. Skills you install elsewhere appear in the " +
  "Installed tab.";

interface Props {
  registry: RegistryEntry[];
  installed: InstalledSkill[];
  search: string;
  setSearch: (v: string) => void;
  selectedTags: string[];
  setSelectedTags: (next: string[]) => void;
  /** When true, filter to skills with at least one ours installation. */
  installedOnly: boolean;
  setInstalledOnly: (v: boolean) => void;
  onSelect: (entry: RegistryEntry) => void;
  onSaveTags?: (name: string, next: string[]) => Promise<void> | void;
  onRebuild: () => void | Promise<void>;
  rebuilding: boolean;
  searchInputRef?: React.Ref<HTMLInputElement>;
  registryFilters: ReadonlySet<RegistryFilterTag>;
  setRegistryFilters: (next: Set<RegistryFilterTag>) => void;
  registrySort: RegistrySortState;
  setRegistrySort: (next: RegistrySortState) => void;
}

export function BrowseTab({
  registry,
  installed,
  search,
  setSearch,
  selectedTags,
  setSelectedTags,
  installedOnly,
  setInstalledOnly,
  onSelect,
  onSaveTags,
  onRebuild,
  rebuilding,
  searchInputRef,
  registryFilters,
  setRegistryFilters,
  registrySort,
  setRegistrySort,
}: Props): React.ReactElement {
  if (registry.length === 0) {
    return (
      <div className="empty-state">
        <strong>The registry is empty.</strong>
        <p>
          Add a skill folder under <code>skills/&lt;name&gt;/</code> with a{" "}
          <code>meta.json</code> or a <code>SKILL.md</code> with YAML
          frontmatter, or click <strong>Refresh from &lt;repo&gt;</strong> in
          the header to pull from your linked registry.
        </p>
        <div style={{ marginTop: 16 }}>
          <button
            className="btn primary"
            disabled={rebuilding}
            onClick={() => void onRebuild()}
          >
            {rebuilding ? (
              <>
                <span className="spinner inline" /> Rescanning
              </>
            ) : (
              "Rescan"
            )}
          </button>
        </div>
      </div>
    );
  }

  const installedNames = new Set(
    installed.filter((i) => i.kind === "ours").map((i) => i.name),
  );
  // Compose in this order: chip-filters narrow the registry by the
  // user's tag-like state filters; the search/tag/installedOnly pass
  // applies free-text + legacy filters; sort orders the survivors;
  // and when the user hasn't expressed any opinion (no chips, default
  // name-asc), float pending-update cards to the top so the Rescan
  // deep-link lands them in the obvious spot.
  const chipFiltered = applyChipFilters(registry, registryFilters);
  const filteredRaw = applyFilters(
    chipFiltered,
    search,
    selectedTags,
    installedOnly,
    installedNames,
  );
  const sorted = applySort(filteredRaw, registrySort);
  const isDefaultOrder =
    registryFilters.size === 0 &&
    registrySort.by === "name" &&
    registrySort.direction === "asc";
  const filtered = isDefaultOrder
    ? floatToTop(sorted, (e) => e.upstreamUpdateAvailable === true)
    : sorted;
  const installedFromRegistry = installedNames.size;
  const warningCount = registry.reduce(
    (acc, e) => acc + (e.warnings?.length ?? 0),
    0,
  );
  const filtersActive =
    search.length > 0 ||
    selectedTags.length > 0 ||
    installedOnly ||
    registryFilters.size > 0;

  return (
    <div>
      <div className="tab-intro">
        <span className="tab-intro-heading">
          <strong>Registry</strong>
          <InfoTooltip
            text={REGISTRY_TOOLTIP}
            label="What is the registry?"
          />
        </span>{" "}
        Browse and install skills from your registry. Click{" "}
        <strong>Refresh from &lt;repo&gt;</strong> in the header to pull the
        latest; your local edits and added skills are preserved. Click any card
        to view its details, then <strong>Install</strong> to link it into the
        agent directories you use (Claude Code, Cursor, etc.).
        <span className="meta-counts">
          <span>{registry.length} in registry</span>
          <span>·</span>
          <span>{installedFromRegistry} linked locally</span>
          {warningCount > 0 && (
            <>
              <span>·</span>
              <span>{warningCount} warnings</span>
            </>
          )}
        </span>
      </div>
      <div className="filters-section">
        <SearchBar value={search} onChange={setSearch} ref={searchInputRef} />
        <RegistryFilters
          registry={registry}
          active={registryFilters}
          onChange={setRegistryFilters}
          sort={registrySort}
          onSortChange={setRegistrySort}
          installedOnly={installedOnly}
          onInstalledOnlyChange={setInstalledOnly}
          installedCount={installedFromRegistry}
          selectedTags={selectedTags}
          onSelectedTagsChange={setSelectedTags}
        />
      </div>
      <p className="results-count">
        {filtered.length} of {registry.length} skill
        {registry.length === 1 ? "" : "s"}
      </p>
      <SkillsGrid
        entries={filtered}
        installed={installed}
        onSelect={onSelect}
        {...(onSaveTags ? { onSaveTags } : {})}
        onClearFilters={
          filtersActive
            ? () => {
                setSearch("");
                setSelectedTags([]);
                setInstalledOnly(false);
                setRegistryFilters(new Set());
              }
            : undefined
        }
      />
    </div>
  );
}

function applyFilters(
  registry: RegistryEntry[],
  search: string,
  selectedTags: string[],
  installedOnly: boolean,
  installedNames: Set<string>,
): RegistryEntry[] {
  const q = search.trim().toLowerCase();
  return registry.filter((e) => {
    if (installedOnly && !installedNames.has(e.name)) return false;
    if (
      selectedTags.length > 0 &&
      !selectedTags.some((t) => e.tags?.includes(t))
    ) {
      return false;
    }
    if (!q) return true;
    if (e.name.toLowerCase().includes(q)) return true;
    if (e.description.toLowerCase().includes(q)) return true;
    if ((e.tags ?? []).some((t) => t.toLowerCase().includes(q))) return true;
    return false;
  });
}
