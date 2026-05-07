import React from "react";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";
import { InfoTooltip } from "./InfoTooltip.js";
import { SearchBar } from "./SearchBar.js";
import { TagFilter } from "./TagFilter.js";
import { SkillsGrid } from "./SkillsGrid.js";

const REGISTRY_TOOLTIP =
  "Curated skills and metadata maintained by this app. Not the only source — " +
  "installs from elsewhere appear in the Installed tab.";

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
  onRebuild: () => void | Promise<void>;
  rebuilding: boolean;
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
  onRebuild,
  rebuilding,
}: Props): React.ReactElement {
  if (registry.length === 0) {
    return (
      <div className="empty-state">
        <strong>The registry is empty.</strong>
        <p>
          Add a skill folder under <code>skills/&lt;name&gt;/</code> with a{" "}
          <code>meta.json</code> or a <code>SKILL.md</code> with YAML
          frontmatter.
        </p>
        <div style={{ marginTop: 16 }}>
          <button
            className="btn primary"
            disabled={rebuilding}
            onClick={() => void onRebuild()}
          >
            {rebuilding ? (
              <>
                <span className="spinner inline" /> Refreshing…
              </>
            ) : (
              "Refresh"
            )}
          </button>
        </div>
      </div>
    );
  }

  const installedNames = new Set(
    installed.filter((i) => i.kind === "ours").map((i) => i.name),
  );
  const filtered = applyFilters(
    registry,
    search,
    selectedTags,
    installedOnly,
    installedNames,
  );
  const installedFromRegistry = installedNames.size;
  const warningCount = registry.reduce(
    (acc, e) => acc + (e.warnings?.length ?? 0),
    0,
  );
  const filtersActive =
    search.length > 0 || selectedTags.length > 0 || installedOnly;

  return (
    <div>
      <div className="tab-intro">
        <span className="tab-intro-heading">
          <strong>Registry</strong>
          <InfoTooltip text={REGISTRY_TOOLTIP} label="What is the registry?" />
        </span>{" "}
        Skills published in this app's registry — portable across machines,
        shared via git. Click any card to view its details, then{" "}
        <strong>Install</strong> to link it into the agent directories you
        use (Claude Code, Cursor, etc.).
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
        <SearchBar value={search} onChange={setSearch} />
        <div className="filter-row">
          <button
            type="button"
            className={`filter-chip${installedOnly ? " active" : ""}`}
            onClick={() => setInstalledOnly(!installedOnly)}
            aria-pressed={installedOnly}
            title={
              installedOnly
                ? "Showing only registry skills you have installed"
                : "Show only registry skills you have installed"
            }
          >
            Installed only{" "}
            <span className="filter-chip-count">
              ({installedFromRegistry})
            </span>
          </button>
          <TagFilter
            registry={registry}
            selected={selectedTags}
            onChange={setSelectedTags}
          />
        </div>
      </div>
      <p className="results-count">
        {filtered.length} of {registry.length} skill
        {registry.length === 1 ? "" : "s"}
      </p>
      <SkillsGrid
        entries={filtered}
        installed={installed}
        onSelect={onSelect}
        onClearFilters={
          filtersActive
            ? () => {
                setSearch("");
                setSelectedTags([]);
                setInstalledOnly(false);
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
