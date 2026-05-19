import React, { useCallback, useMemo, useState } from "react";
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

/** Per-skill state during a bulk-install run. */
export interface BulkInstallState {
  /** Names currently in the queue. */
  queue: ReadonlySet<string>;
  /** Name currently being installed, if any. */
  current: string | null;
  /** Names installed successfully this run. */
  succeeded: ReadonlySet<string>;
  /** name → reason for the failure. */
  failed: ReadonlyMap<string, string>;
}

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
  /**
   * Bulk-install runner. Called with the user's selected skill
   * names when they click "Install N selected". The host (App.tsx)
   * loops over the list calling window.skillsBank.install for each
   * and reports per-step progress back via `bulkInstall`. BrowseTab
   * disables the toggle + selection UI while a run is in flight.
   * Optional: when omitted, the bulk-install button is hidden —
   * keeps the affordance off-screen if a host doesn't wire it.
   */
  onBulkInstall?: (names: string[]) => Promise<void> | void;
  bulkInstall?: BulkInstallState | null;
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
  onBulkInstall,
  bulkInstall,
}: Props): React.ReactElement {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedNames, setSelectedNames] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const running = bulkInstall != null && bulkInstall.current != null;

  const toggleSelect = useCallback((name: string) => {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedNames(new Set());
  }, []);
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
                <span className="spinner inline" /> Rescanning…
              </>
            ) : (
              "Rescan"
            )}
          </button>
        </div>
      </div>
    );
  }

  const installedNames = useMemo(
    () => new Set(installed.filter((i) => i.kind === "ours").map((i) => i.name)),
    [installed],
  );
  // Compose in this order: chip-filters narrow the registry by the
  // user's tag-like state filters; the search/tag/installedOnly pass
  // applies free-text + legacy filters; sort orders the survivors;
  // and when the user hasn't expressed any opinion (no chips, default
  // name-asc), float pending-update cards to the top so the Rescan
  // deep-link lands them in the obvious spot. Memoized so an unrelated
  // re-render (e.g. a sibling tab's state changing) doesn't re-sort.
  const filtered = useMemo(() => {
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
    return isDefaultOrder
      ? floatToTop(sorted, (e) => e.originUpdateAvailable === true)
      : sorted;
  }, [
    registry,
    registryFilters,
    search,
    selectedTags,
    installedOnly,
    installedNames,
    registrySort,
  ]);
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          margin: "8px 0",
        }}
      >
        <p
          className="results-count"
          aria-live="polite"
          aria-atomic="true"
          style={{ margin: 0 }}
        >
          {filtered.length} of {registry.length} skill
          {registry.length === 1 ? "" : "s"}
        </p>
        {onBulkInstall && (
          <button
            className="btn"
            onClick={() => {
              if (selectMode) exitSelectMode();
              else setSelectMode(true);
            }}
            disabled={running}
            aria-pressed={selectMode}
            title={
              selectMode
                ? "Exit bulk-install mode"
                : "Select multiple skills to install in one batch"
            }
          >
            {selectMode ? "Cancel select" : "Bulk install…"}
          </button>
        )}
      </div>
      {selectMode && onBulkInstall && (
        <BulkInstallBar
          filtered={filtered}
          selectedNames={selectedNames}
          setSelectedNames={setSelectedNames}
          installedNames={installedNames}
          bulkInstall={bulkInstall}
          running={running}
          onRun={async () => {
            const names = Array.from(selectedNames).filter(
              (n) => !installedNames.has(n),
            );
            if (names.length === 0) return;
            await onBulkInstall(names);
          }}
          onExit={exitSelectMode}
        />
      )}
      <SkillsGrid
        entries={filtered}
        installed={installed}
        onSelect={onSelect}
        {...(onSaveTags && !selectMode ? { onSaveTags } : {})}
        selectMode={selectMode}
        selectedNames={selectedNames}
        onToggleSelect={toggleSelect}
        isDisabled={(e) => installedNames.has(e.name)}
        bulkStatus={(e) => {
          if (!bulkInstall) return undefined;
          if (bulkInstall.current === e.name) return "installing";
          if (bulkInstall.succeeded.has(e.name)) return "installed";
          if (bulkInstall.failed.has(e.name)) return "failed";
          if (bulkInstall.queue.has(e.name)) return "pending";
          return undefined;
        }}
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

interface BulkInstallBarProps {
  filtered: RegistryEntry[];
  selectedNames: ReadonlySet<string>;
  setSelectedNames: (next: ReadonlySet<string>) => void;
  installedNames: ReadonlySet<string>;
  bulkInstall: BulkInstallState | null | undefined;
  running: boolean;
  onRun: () => Promise<void> | void;
  onExit: () => void;
}

function BulkInstallBar({
  filtered,
  selectedNames,
  setSelectedNames,
  installedNames,
  bulkInstall,
  running,
  onRun,
  onExit,
}: BulkInstallBarProps): React.ReactElement {
  const installable = filtered.filter((e) => !installedNames.has(e.name));
  const selectedInstallable = installable.filter((e) =>
    selectedNames.has(e.name),
  );
  const allSelected =
    installable.length > 0 && selectedInstallable.length === installable.length;

  const total = bulkInstall
    ? bulkInstall.succeeded.size +
      bulkInstall.failed.size +
      (bulkInstall.current ? 1 : 0) +
      bulkInstall.queue.size
    : 0;
  const done = bulkInstall
    ? bulkInstall.succeeded.size + bulkInstall.failed.size
    : 0;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        padding: "8px 12px",
        margin: "0 0 12px",
        border: "1px solid var(--border)",
        background: "var(--surface-2, var(--surface, transparent))",
        borderRadius: 6,
      }}
      role="region"
      aria-label="Bulk install action bar"
    >
      <button
        className="btn"
        onClick={() => {
          if (allSelected) {
            // Deselect only the visible-installable subset — leave any
            // selections outside the current filter view untouched so
            // narrowing the filter doesn't silently drop picks.
            const next = new Set(selectedNames);
            for (const e of installable) next.delete(e.name);
            setSelectedNames(next);
          } else {
            const next = new Set(selectedNames);
            for (const e of installable) next.add(e.name);
            setSelectedNames(next);
          }
        }}
        disabled={running || installable.length === 0}
      >
        {allSelected
          ? "Deselect visible"
          : `Select all visible (${installable.length})`}
      </button>
      <span aria-live="polite" style={{ fontSize: 13, color: "var(--text-2)" }}>
        {running && bulkInstall
          ? `Installing ${done + 1} of ${total} — ${bulkInstall.current ?? ""}…`
          : bulkInstall &&
              (bulkInstall.succeeded.size > 0 ||
                bulkInstall.failed.size > 0)
            ? `Finished: ${bulkInstall.succeeded.size} installed, ${bulkInstall.failed.size} failed`
            : `${selectedInstallable.length} selected (already-installed skills are skipped)`}
      </span>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button
          className="btn primary"
          onClick={() => void onRun()}
          disabled={running || selectedInstallable.length === 0}
        >
          {running ? (
            <>
              <span className="spinner inline" /> Installing…
            </>
          ) : (
            `Install ${selectedInstallable.length} selected`
          )}
        </button>
        <button className="btn" onClick={onExit} disabled={running}>
          Done
        </button>
      </div>
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
