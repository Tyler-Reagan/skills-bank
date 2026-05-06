import React from "react";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";
import { SearchBar } from "./SearchBar.js";
import { TagFilter } from "./TagFilter.js";
import { SkillsGrid } from "./SkillsGrid.js";

interface Props {
  registry: RegistryEntry[];
  installed: InstalledSkill[];
  search: string;
  setSearch: (v: string) => void;
  selectedTags: string[];
  setSelectedTags: (next: string[]) => void;
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
          <code>meta.json</code> or a <code>SKILL.md</code> with YAML frontmatter.
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

  const filtered = applyFilters(registry, search, selectedTags);
  const installedFromRegistry = installed.filter((i) => i.kind === "ours").length;
  const warningCount = registry.reduce(
    (acc, e) => acc + (e.warnings?.length ?? 0),
    0,
  );

  return (
    <div>
      <div className="tab-intro">
        <strong>Registry.</strong> Skills published in this skills-bank repo —
        portable across machines, shared via git. Click any card to view its
        details, then <strong>Install</strong> to symlink it into{" "}
        <code>~/.claude/skills</code> on this machine.
        <span className="meta-counts">
          <span>{registry.length} in registry</span>
          <span>·</span>
          <span>{installedFromRegistry} installed locally</span>
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
        <TagFilter
          registry={registry}
          selected={selectedTags}
          onChange={setSelectedTags}
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
      />
    </div>
  );
}

function applyFilters(
  registry: RegistryEntry[],
  search: string,
  selectedTags: string[],
): RegistryEntry[] {
  const q = search.trim().toLowerCase();
  return registry.filter((e) => {
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
