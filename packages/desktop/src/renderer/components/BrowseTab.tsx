import React, { useCallback, useEffect, useMemo, useState } from "react";
import type {
  LabelsMap,
  ManifestSkill,
  RegistryEntry,
} from "@skills-bank/core";
import {
  categoryRules,
  categoryDisplayName,
  effectiveLabels,
} from "@skills-bank/core/labels";
import { DisclosureChevron } from "./DisclosureChevron.js";
import { Icon } from "./Icon.js";
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
import { useRegistry } from "../RegistryContext.js";
import { useBrowseFilters } from "../hooks/useBrowseFilters.js";

const CATEGORY_ORDER = categoryRules.map((r) => r.category);

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
  "GitHub repo you've linked. When linked, click Pull from <repo> in the " +
  "header to pull the latest; your local edits and added skills are preserved " +
  "through the diff-before-apply flow. Skills you install elsewhere appear " +
  "in the Installed tab.";

interface Props {
  onSelect: (entry: RegistryEntry) => void;
  onSaveTags?: (name: string, next: string[]) => Promise<void> | void;
  onRebuild: () => void | Promise<void>;
  rebuilding: boolean;
  searchInputRef?: React.Ref<HTMLInputElement>;
  registryFilters: ReadonlySet<RegistryFilterTag>;
  setRegistryFilters: (next: Set<RegistryFilterTag>) => void;
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
  /**
   * Tier-3 (v1.9): live manifest-import progress used to render the
   * "Incoming via manifest" ghost-card band at the top of this tab.
   * Null when no import is in flight (or just settled and cleared).
   */
  manifestImportProgress?: {
    completed: number;
    total: number;
    currentName: string;
    manifestNames: string[];
    manifestSkills: ManifestSkill[];
    errors: Map<string, string>;
    dismissed: Set<string>;
    settled: Set<string>;
  } | null;
  /** Retry a failed ghost — re-mirrors the skill via the retry IPC. */
  onRetryGhost?: (skill: ManifestSkill) => void;
  /** Dismiss a failed (or pending) ghost; pure renderer-side state. */
  onDismissGhost?: (name: string) => void;
  /** Increment when label overrides change so the section grouping re-fetches. */
  labelsRefreshKey?: number;
  /** Start a label-review session over the visible registry. */
  onStartReview?: (entries: RegistryEntry[]) => void;
}

export function BrowseTab({
  onSelect,
  onSaveTags,
  onRebuild,
  rebuilding,
  searchInputRef,
  registryFilters,
  setRegistryFilters,
  onBulkInstall,
  bulkInstall,
  manifestImportProgress,
  onRetryGhost,
  onDismissGhost,
  labelsRefreshKey,
  onStartReview,
}: Props): React.ReactElement {
  const { visibleRegistry: registry, installed } = useRegistry();
  const {
    search,
    setSearch,
    selectedTags,
    setSelectedTags,
    installedOnly,
    setInstalledOnly,
    registrySort,
    setRegistrySort,
  } = useBrowseFilters();
  const [selectMode, setSelectMode] = useState(false);
  const [selectedNames, setSelectedNames] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [labelsMap, setLabelsMap] = useState<LabelsMap>({});
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set(),
  );
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(false);
  const running = bulkInstall != null && bulkInstall.current != null;

  useEffect(() => {
    void window.skillsBank.readLabels().then((map) => {
      setLabelsMap(map);
      setBannerDismissed(Boolean(map["__meta"]?.bannerDismissed));
    });
  }, [labelsRefreshKey]);

  const dismissBanner = useCallback(async () => {
    setBannerDismissed(true);
    await window.skillsBank.updateLabel("__meta", { bannerDismissed: true });
  }, []);

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
          frontmatter, or click <strong>Pull from &lt;repo&gt;</strong> in the
          header to pull from your linked registry.
        </p>
        <div className="mt-16">
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
    () =>
      new Set(installed.filter((i) => i.kind === "ours").map((i) => i.name)),
    [installed],
  );
  const effectiveTagsMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const entry of registry) {
      map.set(
        entry.name,
        effectiveLabels({ category: null, tags: [] }, labelsMap[entry.name])
          .tags,
      );
    }
    return map;
  }, [registry, labelsMap]);

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
      effectiveTagsMap,
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
    effectiveTagsMap,
  ]);

  const sections = useMemo(() => {
    const byCategory = new Map<string | null, RegistryEntry[]>();
    for (const entry of filtered) {
      const cat = effectiveLabels(
        { category: null, tags: [] },
        labelsMap[entry.name],
      ).category;
      const bucket = byCategory.get(cat) ?? [];
      bucket.push(entry);
      byCategory.set(cat, bucket);
    }

    const ordered: { category: string; entries: RegistryEntry[] }[] = [];
    for (const cat of CATEGORY_ORDER) {
      const entries = byCategory.get(cat);
      if (entries && entries.length > 0) {
        ordered.push({ category: cat, entries });
      }
    }
    const uncategorized = byCategory.get(null);
    if (uncategorized && uncategorized.length > 0) {
      ordered.push({ category: "Uncategorized", entries: uncategorized });
    }
    return ordered;
  }, [filtered, labelsMap]);

  const toggleSection = useCallback((category: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  const allCollapsed =
    sections.length > 0 &&
    sections.every((s) => collapsedSections.has(s.category));

  const toggleAllSections = useCallback(() => {
    setCollapsedSections(
      allCollapsed ? new Set() : new Set(sections.map((s) => s.category)),
    );
  }, [allCollapsed, sections]);
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

  // Tier-3 ghost-card band. Filter to manifest entries not already
  // in the registry (per design: ghosts only for net-new arrivals)
  // and not dismissed by the user. Computed every render so each
  // arrival/dismissal updates promptly. Cheap — typical manifests
  // are small.
  const registryNamesSet = useMemo(
    () => new Set(registry.map((e) => e.name)),
    [registry],
  );
  const ghostSkills =
    manifestImportProgress?.manifestSkills.filter(
      (s) =>
        !registryNamesSet.has(s.name) &&
        !manifestImportProgress.dismissed.has(s.name),
    ) ?? [];

  return (
    <div>
      {ghostSkills.length > 0 && manifestImportProgress && (
        <GhostBand
          skills={ghostSkills}
          progress={manifestImportProgress}
          {...(onRetryGhost ? { onRetry: onRetryGhost } : {})}
          {...(onDismissGhost ? { onDismiss: onDismissGhost } : {})}
        />
      )}
      <div className="tab-intro">
        <span className="tab-intro-heading">
          <strong>Registry</strong>
          <InfoTooltip text={REGISTRY_TOOLTIP} label="What is the registry?" />
        </span>{" "}
        Browse and install skills from your registry. When linked, click{" "}
        <strong>Pull from &lt;repo&gt;</strong> in the header to pull the
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
      {!bannerDismissed && onStartReview && registry.length > 0 && (
        <LabelsFirstRunBanner
          onReview={() =>
            onStartReview(filtered.length > 0 ? filtered : registry)
          }
          onDismiss={() => void dismissBanner()}
        />
      )}
      <div className="filters-section">
        <SearchBar value={search} onChange={setSearch} ref={searchInputRef} />
        <RegistryFilters
          registry={registry}
          effectiveTagsMap={effectiveTagsMap}
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
      <div className="row-between-8 my-8">
        <p
          className="results-count mt-0 mb-0"
          aria-live="polite"
          aria-atomic="true"
        >
          {filtered.length} of {registry.length} skill
          {registry.length === 1 ? "" : "s"}
        </p>
        <div className="row-between-8">
          {sections.length >= 2 && (
            <button
              type="button"
              className={`expand-collapse-btn${allCollapsed ? " all-collapsed" : ""}`}
              onClick={toggleAllSections}
            >
              <DisclosureChevron open={!allCollapsed} />
              {allCollapsed ? "Expand all" : "Collapse all"}
            </button>
          )}
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
              {selectMode ? "Cancel select" : "Bulk install"}
            </button>
          )}
        </div>
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
      {filtered.length === 0 ? (
        <SkillsGrid
          entries={[]}
          installed={installed}
          onSelect={onSelect}
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
      ) : (
        sections.map(({ category, entries }) => (
          <CategorySection
            key={category}
            category={category}
            entries={entries}
            open={!collapsedSections.has(category)}
            onToggle={() => toggleSection(category)}
            installed={installed}
            onSelect={onSelect}
            effectiveTagsMap={effectiveTagsMap}
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
          />
        ))
      )}
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
      className="bulk-install-bar"
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
      <span aria-live="polite" className="text-13 text-muted">
        {running && bulkInstall
          ? `Installing ${done + 1} of ${total} — ${bulkInstall.current ?? ""}`
          : bulkInstall &&
              (bulkInstall.succeeded.size > 0 || bulkInstall.failed.size > 0)
            ? `Finished: ${bulkInstall.succeeded.size} installed, ${bulkInstall.failed.size} failed`
            : `${selectedInstallable.length} selected (already-installed skills are skipped)`}
      </span>
      <div className="row-end ml-auto">
        <button
          className="btn primary"
          onClick={() => void onRun()}
          disabled={running || selectedInstallable.length === 0}
        >
          {running ? (
            <>
              <span className="spinner inline" /> Installing
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

/**
 * Tier-3 ghost-card band rendered at the top of BrowseTab when a
 * manifest import is in flight. One row per net-new manifest skill
 * (existing registry entries are excluded — they don't ghost). Each
 * row carries per-skill status:
 *   - pending (default): shimmer skeleton, awaiting its turn
 *   - current: highlighted, currently being mirrored
 *   - errored: red border + Retry + Dismiss buttons
 *   - settled (no error): faded check, awaiting band dissolution
 *
 * The band dissolves automatically when the host clears
 * `manifestImportProgress` in the import's `finally` — at which
 * point the registry has been refreshed and the new cards appear
 * in their natural alphabetical positions in the main grid.
 */
function GhostBand({
  skills,
  progress,
  onRetry,
  onDismiss,
}: {
  skills: ManifestSkill[];
  progress: {
    completed: number;
    total: number;
    currentName: string;
    errors: Map<string, string>;
    settled: Set<string>;
  };
  onRetry?: (skill: ManifestSkill) => void;
  onDismiss?: (name: string) => void;
}): React.ReactElement {
  return (
    <section
      className="ghost-band"
      aria-label="Skills incoming via manifest import"
    >
      <header className="row-center-8 mb-8">
        <h2 className="mt-0 mb-0 text-13">
          Incoming via manifest{" "}
          <span className="text-subtle fw-400">
            ({progress.completed}/{progress.total})
          </span>
        </h2>
      </header>
      <ul className="ghost-band-grid">
        {skills.map((skill) => {
          const error = progress.errors.get(skill.name);
          const isCurrent = progress.currentName === skill.name && !error;
          const isSettled = progress.settled.has(skill.name) && !error;
          const status = error
            ? "errored"
            : isCurrent
              ? "current"
              : isSettled
                ? "settled"
                : "pending";
          return (
            <li
              key={skill.name}
              className={`ghost-card ghost-${status} ghost-card-body${status === "errored" ? " ghost-card-body--errored" : ""}`}
            >
              <div className="ghost-card-name-row">
                {status === "pending" && (
                  <span
                    className="spinner inline ghost-pending-spinner"
                    aria-hidden="true"
                  />
                )}
                {status === "current" && (
                  <span className="spinner inline" aria-hidden="true" />
                )}
                {status === "settled" && (
                  <Icon name="check" size="sm" aria-hidden={true} />
                )}
                {status === "errored" && (
                  <Icon name="alert-triangle" size="sm" aria-hidden={true} />
                )}
                <span className="ghost-card-name">{skill.name}</span>
              </div>
              {error && <div className="ghost-card-error">{error}</div>}
              {error && (
                <div className="ghost-card-actions">
                  {onRetry && (
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => onRetry(skill)}
                    >
                      Retry
                    </button>
                  )}
                  {onDismiss && (
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => onDismiss(skill.name)}
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface CategorySectionProps {
  category: string;
  entries: RegistryEntry[];
  open: boolean;
  onToggle: () => void;
  installed: import("@skills-bank/core").InstalledSkill[];
  onSelect: (entry: RegistryEntry) => void;
  onSaveTags?: (name: string, next: string[]) => Promise<void> | void;
  effectiveTagsMap?: Map<string, string[]>;
  selectMode?: boolean;
  selectedNames?: ReadonlySet<string>;
  onToggleSelect?: (name: string) => void;
  isDisabled?: (entry: RegistryEntry) => boolean;
  bulkStatus?: (
    entry: RegistryEntry,
  ) => "pending" | "installing" | "installed" | "failed" | undefined;
}

function CategorySection({
  category,
  entries,
  open,
  onToggle,
  installed,
  onSelect,
  onSaveTags,
  effectiveTagsMap,
  selectMode = false,
  selectedNames,
  onToggleSelect,
  isDisabled,
  bulkStatus,
}: CategorySectionProps): React.ReactElement {
  const label =
    category === "Uncategorized"
      ? "Uncategorized"
      : categoryDisplayName(category);

  return (
    <section className="category-section">
      <button
        type="button"
        className="category-section-header"
        aria-expanded={open}
        onClick={onToggle}
      >
        <DisclosureChevron open={open} />
        <span className="category-section-name">{label}</span>
        <span className="category-section-count">{entries.length}</span>
      </button>
      {open && (
        <div className="category-section-body">
          <SkillsGrid
            entries={entries}
            installed={installed}
            onSelect={onSelect}
            {...(effectiveTagsMap ? { effectiveTagsMap } : {})}
            {...(onSaveTags && !selectMode ? { onSaveTags } : {})}
            selectMode={selectMode}
            selectedNames={selectedNames}
            onToggleSelect={onToggleSelect}
            isDisabled={isDisabled}
            bulkStatus={bulkStatus}
          />
        </div>
      )}
    </section>
  );
}

interface LabelsFirstRunBannerProps {
  onReview: () => void;
  onDismiss: () => void;
}

function LabelsFirstRunBanner({
  onReview,
  onDismiss,
}: LabelsFirstRunBannerProps): React.ReactElement {
  return (
    <div className="labels-banner" role="status">
      <span className="labels-banner-text">
        Skills are now organized by category and tag. Review to customize how
        yours are grouped.
      </span>
      <div className="labels-banner-actions">
        <button type="button" className="btn btn-sm" onClick={onReview}>
          Review labels
        </button>
        <button
          type="button"
          className="labels-banner-dismiss"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          ✕
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
  effectiveTagsMap: Map<string, string[]>,
): RegistryEntry[] {
  const q = search.trim().toLowerCase();
  return registry.filter((e) => {
    const tags = effectiveTagsMap.get(e.name) ?? e.tags ?? [];
    if (installedOnly && !installedNames.has(e.name)) return false;
    if (selectedTags.length > 0 && !selectedTags.some((t) => tags.includes(t)))
      return false;
    if (!q) return true;
    if (e.name.toLowerCase().includes(q)) return true;
    if (e.description.toLowerCase().includes(q)) return true;
    if (tags.some((t) => t.toLowerCase().includes(q))) return true;
    return false;
  });
}
