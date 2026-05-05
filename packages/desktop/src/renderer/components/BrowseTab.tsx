import React from "react";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";
import { SearchBar } from "./SearchBar.js";
import { DomainFilter } from "./DomainFilter.js";
import { SkillsGrid } from "./SkillsGrid.js";

interface Props {
  registry: RegistryEntry[];
  installed: InstalledSkill[];
  search: string;
  setSearch: (v: string) => void;
  domain: string | null;
  setDomain: (d: string | null) => void;
  onSelect: (entry: RegistryEntry) => void;
  onRebuild: () => void | Promise<void>;
  rebuilding: boolean;
}

export function BrowseTab({
  registry,
  installed,
  search,
  setSearch,
  domain,
  setDomain,
  onSelect,
  onRebuild,
  rebuilding,
}: Props): React.ReactElement {
  if (registry.length === 0) {
    return (
      <div className="empty-state">
        <strong>The registry is empty.</strong>
        <p>
          Add a skill folder under <code>skills/&lt;category&gt;/&lt;name&gt;/</code>{" "}
          with a <code>meta.json</code> or a <code>SKILL.md</code> with YAML frontmatter.
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

  const filtered = applyFilters(registry, search, domain);

  return (
    <div>
      <div className="filters-section">
        <SearchBar value={search} onChange={setSearch} />
        <DomainFilter
          registry={registry}
          selected={domain}
          onChange={setDomain}
        />
      </div>
      <p className="results-count">
        {filtered.length} of {registry.length} skill{registry.length === 1 ? "" : "s"}
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
  domain: string | null,
): RegistryEntry[] {
  const q = search.trim().toLowerCase();
  return registry.filter((e) => {
    if (domain && (e.domain ?? "other") !== domain) return false;
    if (!q) return true;
    if (e.name.toLowerCase().includes(q)) return true;
    if (e.description.toLowerCase().includes(q)) return true;
    if ((e.tags ?? []).some((t) => t.toLowerCase().includes(q))) return true;
    return false;
  });
}
