import React, { useEffect, useRef, useMemo, useState } from "react";
import { SearchBar } from "./primitives.js";
import type { LabelsMap, RegistryEntry } from "@skills-bank/core";
import {
  categoryRules,
  categoryDisplayName,
  deriveLabels,
} from "@skills-bank/core/labels";
import { useLabels } from "../LabelsContext.js";
import { Modal, ModalCloseButton, modalFooter } from "./modalStyles.js";
import { Icon } from "./Icon.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import {
  ConflictActionPicker,
  type PickerOption,
} from "./ConflictActionPicker.js";
import { useRegistry } from "../RegistryContext.js";

// ── Types ─────────────────────────────────────────────────────────────────────

type LabelScope = "both" | "categories" | "tags";
type SortKey = "name-asc" | "name-desc" | "category" | "uncategorized-first";

interface Proposal {
  name: string;
  currentCategory: string | null;
  currentTags: string[];
  proposedCategory: string | null;
  proposedTags: string[];
  hasChange: boolean;
}

type Phase =
  | { kind: "browse" }
  | { kind: "gen-scope" }
  | { kind: "gen-skills" }
  | {
      kind: "gen-review";
      proposals: Proposal[];
      checkedNames: Set<string>;
      noChangeExpanded: boolean;
    }
  | { kind: "applying" };

interface Props {
  onClose: () => void;
  onOpenSkill: (entry: RegistryEntry) => void;
  drawerOpen?: boolean;
}

// ── Static option lists ───────────────────────────────────────────────────────

const SCOPE_OPTIONS: PickerOption<LabelScope>[] = [
  {
    value: "both",
    label: "Both categories and tags",
    description:
      "Suggest a category and relevant tags for each selected skill.",
  },
  {
    value: "categories",
    label: "Categories only",
    description:
      "Only suggest which category each selected skill belongs to. Existing tags are preserved.",
  },
  {
    value: "tags",
    label: "Tags only",
    description:
      "Only suggest tag keywords for each selected skill. Existing categories are preserved.",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function useOutsideClick(
  ref: React.RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        ref.current &&
        e.target instanceof Node &&
        !ref.current.contains(e.target)
      ) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref, onClose]);
}

function tagsAreEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface StepIndicatorProps {
  current: 1 | 2 | 3;
}

function StepIndicator({ current }: StepIndicatorProps) {
  return (
    <div className="gen-step-indicator" aria-label={`Step ${current} of 3`}>
      {([1, 2, 3] as const).map((n, i) => (
        <React.Fragment key={n}>
          {i > 0 && (
            <span
              className={`gen-step-line${current > n - 1 ? " gen-step-line--done" : ""}`}
            />
          )}
          <span
            className={`gen-step-dot${current >= n ? " gen-step-dot--done" : ""}`}
          />
        </React.Fragment>
      ))}
      <span className="gen-step-label">Step {current} of 3</span>
    </div>
  );
}

interface TagsDropdownProps {
  selected: string[];
  onChange: (next: string[]) => void;
  allTags: [string, number][];
}

function TagsDropdown({ selected, onChange, allTags }: TagsDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useOutsideClick(wrapRef, open, () => setOpen(false));

  const selectedSet = new Set(selected);

  const selectedItems = allTags.filter(([t]) => selectedSet.has(t));
  const unselectedItems = allTags.filter(
    ([t]) =>
      !selectedSet.has(t) &&
      (!search || t.toLowerCase().includes(search.toLowerCase())),
  );

  function toggle(tag: string) {
    if (selectedSet.has(tag)) {
      onChange(selected.filter((t) => t !== tag));
    } else {
      onChange([...selected, tag]);
    }
  }

  let label = "All";
  if (selected.length === 1) label = selected[0]!;
  else if (selected.length > 1)
    label = `${selected[0]} +${selected.length - 1}`;

  return (
    <div ref={wrapRef} className="manage-labels-tags-wrap">
      <button
        type="button"
        className={`filter-chip tag-filter-trigger${open ? " open" : ""}${selected.length > 0 ? " active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        Tags: {label}
        <Icon name="chevron-down" size="sm" />
      </button>

      {open && (
        <div className="tag-filter-panel manage-labels-tags-panel">
          <div className="manage-labels-tags-search">
            <input
              type="text"
              className="manage-labels-tags-search-input"
              placeholder="Search tags…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="tag-filter-panel-list">
            {selectedItems.map(([tag]) => (
              <button
                key={tag}
                type="button"
                className="tag-filter-item active"
                onClick={() => toggle(tag)}
                aria-pressed={true}
              >
                <span className="tag-filter-item-label">#{tag}</span>
                <Icon name="x" size="sm" />
              </button>
            ))}
            {selectedItems.length > 0 && unselectedItems.length > 0 && (
              <div className="manage-labels-tags-divider" />
            )}
            {unselectedItems.map(([tag, count]) => (
              <button
                key={tag}
                type="button"
                className="tag-filter-item"
                onClick={() => toggle(tag)}
                aria-pressed={false}
              >
                <span className="tag-filter-item-label">#{tag}</span>
                <span className="tag-filter-item-count">{count}</span>
              </button>
            ))}
            {unselectedItems.length === 0 && selectedItems.length === 0 && (
              <div className="tag-filter-panel-empty">No tags</div>
            )}
          </div>
          {selected.length > 0 && (
            <div className="tag-filter-panel-header">
              <button
                type="button"
                className="tag-filter-clear"
                onClick={() => onChange([])}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ActionsDropdownProps {
  disabled: boolean;
  onClearLabels: () => void;
}

function ActionsDropdown({ disabled, onClearLabels }: ActionsDropdownProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useOutsideClick(wrapRef, open, () => setOpen(false));

  return (
    <div ref={wrapRef} className="actions-dropdown-wrap">
      <button
        type="button"
        className="btn actions-dropdown-trigger"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        Actions
        <Icon name="chevron-down" size="sm" />
      </button>
      {open && !disabled && (
        <div className="actions-dropdown-panel" role="menu">
          <button
            type="button"
            role="menuitem"
            className="actions-dropdown-item actions-dropdown-item--danger"
            onClick={() => {
              setOpen(false);
              onClearLabels();
            }}
          >
            Clear labels
          </button>
        </div>
      )}
    </div>
  );
}

interface SkillLabelRowProps {
  entry: RegistryEntry;
  override: { category?: string | null; tags?: string[] } | undefined;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onPatchLabel: (patch: {
    category?: string | null;
    tags?: string[];
  }) => Promise<void>;
}

function SkillLabelRow({
  entry,
  override,
  selected,
  onToggle,
  onOpen,
  onPatchLabel,
}: SkillLabelRowProps) {
  const category = override?.category ?? null;
  const tags = override?.tags ?? [];
  const [editingCategory, setEditingCategory] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState("");

  async function handleCategoryChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    setEditingCategory(false);
    await onPatchLabel({ category: val === "__none__" ? null : val });
  }

  async function handleRemoveTag(tag: string) {
    await onPatchLabel({ tags: tags.filter((t) => t !== tag) });
  }

  async function handleConfirmTag() {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, "-");
    if (t && !tags.includes(t)) {
      await onPatchLabel({ tags: [...tags, t] });
    }
    setTagInput("");
    setAddingTag(false);
  }

  return (
    <div
      className={`manage-labels-row${selected ? " manage-labels-row--selected" : ""}`}
    >
      <input
        type="checkbox"
        className="manage-labels-row-check"
        checked={selected}
        onChange={onToggle}
        aria-label={`Select ${entry.name}`}
      />
      <span className="manage-labels-row-name">{entry.name}</span>

      {/* Category — click to edit */}
      <span className="manage-labels-row-category">
        {editingCategory ? (
          <select
            className="manage-labels-select manage-labels-row-cat-select"
            value={category ?? "__none__"}
            onChange={(e) => void handleCategoryChange(e)}
            onBlur={() => setEditingCategory(false)}
            autoFocus
          >
            <option value="__none__">None</option>
            {categoryRules.map((r) => (
              <option key={r.category} value={r.category}>
                {categoryDisplayName(r.category)}
              </option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            className={`manage-labels-cat-edit-btn${category ? " manage-labels-cat-edit-btn--set" : " manage-labels-cat-edit-btn--empty"}`}
            onClick={() => setEditingCategory(true)}
          >
            {category ? (
              <>
                <span className="manage-labels-cat-badge">
                  {categoryDisplayName(category)}
                </span>
                <Icon
                  name="chevron-down"
                  size="sm"
                  className="manage-labels-cat-chevron"
                />
              </>
            ) : (
              <span className="manage-labels-cat-placeholder">
                Set category
              </span>
            )}
          </button>
        )}
      </span>

      {/* Tags — chips with × + inline add */}
      <span className="manage-labels-row-tags">
        {tags.map((t) => (
          <span
            key={t}
            className="label-chip label-chip--added manage-labels-chip"
          >
            {t}
            <button
              type="button"
              className="label-chip-remove"
              aria-label={`Remove tag ${t}`}
              onClick={() => void handleRemoveTag(t)}
            >
              <Icon name="x" size="sm" />
            </button>
          </span>
        ))}
        {addingTag ? (
          <input
            type="text"
            className="manage-labels-tag-input"
            value={tagInput}
            placeholder="tag…"
            autoFocus
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleConfirmTag();
              }
              if (e.key === "Escape") {
                setAddingTag(false);
                setTagInput("");
              }
            }}
            onBlur={() => void handleConfirmTag()}
          />
        ) : (
          <button
            type="button"
            className="manage-labels-add-tag-btn"
            title="Add tag"
            onClick={() => setAddingTag(true)}
          >
            +
          </button>
        )}
        {tags.length === 0 && !addingTag && (
          <span className="manage-labels-row-none">—</span>
        )}
      </span>

      <button
        type="button"
        className="manage-labels-row-open"
        aria-label={`Open ${entry.name}`}
        title="Open skill"
        onClick={onOpen}
      >
        <Icon name="external-link" size="sm" />
      </button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ManageLabelsModal({
  onClose,
  onOpenSkill,
  drawerOpen = false,
}: Props): React.ReactElement {
  const { registry } = useRegistry();
  const { labelsMap, reload } = useLabels();

  // ── Shared state ────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>({ kind: "browse" });

  // ── Browse state ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("__all__");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>("name-asc");
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [confirmClear, setConfirmClear] = useState(false);

  // ── Gen flow state ──────────────────────────────────────────────────────────
  const [genScope, setGenScope] = useState<LabelScope>("both");
  const [genSkillMode, setGenSkillMode] = useState<"all" | "select">("all");
  const [genSkillSearch, setGenSkillSearch] = useState("");
  const [genSkillSelected, setGenSkillSelected] = useState<Set<string>>(
    new Set(),
  );

  // ── Derived: browse ─────────────────────────────────────────────────────────
  const allTags = useMemo<[string, number][]>(() => {
    const counts = new Map<string, number>();
    for (const e of registry) {
      for (const t of labelsMap[e.name]?.tags ?? []) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) =>
      b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0]),
    );
  }, [registry, labelsMap]);

  const filteredSkills = useMemo(() => {
    let entries = [...registry];
    if (search) {
      const q = search.toLowerCase();
      entries = entries.filter((e) => e.name.toLowerCase().includes(q));
    }
    if (categoryFilter !== "__all__") {
      entries = entries.filter((e) => {
        const cat = labelsMap[e.name]?.category ?? null;
        return categoryFilter === "__none__"
          ? cat === null
          : cat === categoryFilter;
      });
    }
    if (tagFilter.length > 0) {
      entries = entries.filter((e) => {
        const tags = labelsMap[e.name]?.tags ?? [];
        return tagFilter.every((t) => tags.includes(t));
      });
    }
    switch (sort) {
      case "name-asc":
        entries.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "name-desc":
        entries.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case "category":
        entries.sort((a, b) => {
          const ac = labelsMap[a.name]?.category ?? "";
          const bc = labelsMap[b.name]?.category ?? "";
          if (!ac && !bc) return a.name.localeCompare(b.name);
          if (!ac) return 1;
          if (!bc) return -1;
          if (ac === bc) return a.name.localeCompare(b.name);
          return ac.localeCompare(bc);
        });
        break;
      case "uncategorized-first":
        entries.sort((a, b) => {
          const au = (labelsMap[a.name]?.category ?? null) === null;
          const bu = (labelsMap[b.name]?.category ?? null) === null;
          if (au === bu) return a.name.localeCompare(b.name);
          return au ? -1 : 1;
        });
        break;
    }
    return entries;
  }, [registry, search, categoryFilter, tagFilter, sort, labelsMap]);

  const allBrowseSelected =
    filteredSkills.length > 0 &&
    filteredSkills.every((e) => selectedNames.has(e.name));

  function toggleSelectAll() {
    if (allBrowseSelected) {
      const next = new Set(selectedNames);
      for (const e of filteredSkills) next.delete(e.name);
      setSelectedNames(next);
    } else {
      const next = new Set(selectedNames);
      for (const e of filteredSkills) next.add(e.name);
      setSelectedNames(next);
    }
  }

  // ── Clear labels ─────────────────────────────────────────────────────────────
  async function doClearLabels() {
    for (const name of selectedNames) {
      await window.skillsBank.resetLabel(name);
    }
    setSelectedNames(new Set());
    await reload();
    setConfirmClear(false);
  }

  // ── Gen flow ─────────────────────────────────────────────────────────────────
  function buildProposals(names: string[]): Proposal[] {
    return names
      .map((name) => {
        const entry = registry.find((e) => e.name === name);
        if (!entry) return null;
        const currentCategory = labelsMap[name]?.category ?? null;
        const currentTags = labelsMap[name]?.tags ?? [];
        const derived = deriveLabels({
          name: entry.name,
          description: entry.description,
        });
        const proposedCategory =
          genScope === "tags" ? currentCategory : derived.category;
        const proposedTags =
          genScope === "categories" ? currentTags : derived.tags;
        const hasChange =
          proposedCategory !== currentCategory ||
          !tagsAreEqual(proposedTags, currentTags);
        return {
          name,
          currentCategory,
          currentTags,
          proposedCategory,
          proposedTags,
          hasChange,
        };
      })
      .filter(Boolean) as Proposal[];
  }

  function goToReview() {
    const names =
      genSkillMode === "all"
        ? registry.map((e) => e.name)
        : Array.from(genSkillSelected);
    const proposals = buildProposals(names);
    const changedNames = new Set(
      proposals.filter((p) => p.hasChange).map((p) => p.name),
    );
    setPhase({
      kind: "gen-review",
      proposals,
      checkedNames: changedNames,
      noChangeExpanded: false,
    });
  }

  function toggleReviewCheck(name: string) {
    if (phase.kind !== "gen-review") return;
    const next = new Set(phase.checkedNames);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setPhase({ ...phase, checkedNames: next });
  }

  function toggleAllReviewChecks() {
    if (phase.kind !== "gen-review") return;
    const changed = phase.proposals.filter((p) => p.hasChange);
    const allChecked = changed.every((p) => phase.checkedNames.has(p.name));
    const next = allChecked
      ? new Set<string>()
      : new Set(changed.map((p) => p.name));
    setPhase({ ...phase, checkedNames: next });
  }

  async function doApply() {
    if (phase.kind !== "gen-review") return;
    const { proposals, checkedNames } = phase;
    setPhase({ kind: "applying" });
    const updates: LabelsMap = {};
    for (const p of proposals) {
      if (!checkedNames.has(p.name)) continue;
      updates[p.name] = {
        ...(labelsMap[p.name] ?? {}),
        category: p.proposedCategory,
        tags: p.proposedTags,
      };
    }
    await window.skillsBank.bulkUpdateLabels(updates);
    await reload();
    setPhase({ kind: "browse" });
  }

  // ── Gen skill select filtered list ──────────────────────────────────────────
  const genSkillList = useMemo(() => {
    const q = genSkillSearch.toLowerCase();
    return [...registry]
      .filter((e) => !q || e.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [registry, genSkillSearch]);

  const genSkillOptions: PickerOption<"all" | "select">[] = [
    {
      value: "all",
      label: `All skills (${registry.length})`,
      description: "Generate suggestions for every skill in your registry.",
    },
    {
      value: "select",
      label: "Select skills",
      description: "Choose specific skills to generate suggestions for.",
    },
  ];

  // ── In-row label patch ───────────────────────────────────────────────────────
  async function patchLabel(
    name: string,
    patch: { category?: string | null; tags?: string[] },
  ): Promise<void> {
    await window.skillsBank.updateLabel(name, patch);
    await reload();
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const isDismissable = phase.kind !== "applying";

  if (phase.kind === "applying") {
    return (
      <Modal label="Applying labels" width={480}>
        <div className="modal-header">
          <h2 className="mt-0 mb-0">Applying labels…</h2>
        </div>
        <div className="manage-labels-applying">
          <span className="spinner" aria-label="Working" />
        </div>
      </Modal>
    );
  }

  return (
    <>
      <Modal
        label="Manage Labels"
        width={720}
        onClose={isDismissable && !drawerOpen ? onClose : undefined}
        trapFocus
      >
        {/* ── Browse phase ───────────────────────────────────────────── */}
        {phase.kind === "browse" && (
          <>
            <div className="modal-header">
              <h2 className="mt-0 mb-0">Manage Labels</h2>
              <ModalCloseButton onClose={onClose} />
            </div>

            {/* Filters row */}
            <div className="manage-labels-filters">
              <div className="manage-labels-search-wrap">
                <SearchBar
                  value={search}
                  onChange={setSearch}
                  placeholder="Filter skills…"
                />
              </div>
              <label
                className="manage-labels-filter-label"
                htmlFor="ml-cat-filter"
              >
                Category
              </label>
              <select
                id="ml-cat-filter"
                className="manage-labels-select"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="__all__">All</option>
                <option value="__none__">Uncategorized</option>
                {categoryRules.map((r) => (
                  <option key={r.category} value={r.category}>
                    {categoryDisplayName(r.category)}
                  </option>
                ))}
              </select>
              <TagsDropdown
                selected={tagFilter}
                onChange={setTagFilter}
                allTags={allTags}
              />
              <label className="manage-labels-filter-label" htmlFor="ml-sort">
                Sort
              </label>
              <select
                id="ml-sort"
                className="manage-labels-select"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                <option value="name-asc">Name A → Z</option>
                <option value="name-desc">Name Z → A</option>
                <option value="category">Category</option>
                <option value="uncategorized-first">Uncategorized first</option>
              </select>
            </div>

            {/* Table header */}
            <div className="manage-labels-table-header">
              <label className="manage-labels-select-all-label">
                <input
                  type="checkbox"
                  checked={allBrowseSelected && filteredSkills.length > 0}
                  onChange={toggleSelectAll}
                  aria-label="Select all visible skills"
                />
                <span>Select all</span>
              </label>
              <ActionsDropdown
                disabled={selectedNames.size === 0}
                onClearLabels={() => setConfirmClear(true)}
              />
              <span className="manage-labels-count text-muted text-13">
                {filteredSkills.length} skill
                {filteredSkills.length === 1 ? "" : "s"}
                {selectedNames.size > 0 && ` · ${selectedNames.size} selected`}
              </span>
            </div>

            {/* Skill list */}
            <div className="manage-labels-list">
              {filteredSkills.map((entry) => (
                <SkillLabelRow
                  key={entry.name}
                  entry={entry}
                  override={labelsMap[entry.name]}
                  selected={selectedNames.has(entry.name)}
                  onToggle={() => {
                    const next = new Set(selectedNames);
                    if (next.has(entry.name)) next.delete(entry.name);
                    else next.add(entry.name);
                    setSelectedNames(next);
                  }}
                  onOpen={() => onOpenSkill(entry)}
                  onPatchLabel={(patch) => patchLabel(entry.name, patch)}
                />
              ))}
              {filteredSkills.length === 0 && (
                <div className="manage-labels-empty text-muted text-13">
                  No skills match the current filters.
                </div>
              )}
            </div>

            {/* Footer */}
            <div className={modalFooter}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setGenScope("both");
                  setGenSkillMode("all");
                  setGenSkillSearch("");
                  setGenSkillSelected(new Set());
                  setPhase({ kind: "gen-scope" });
                }}
              >
                ✦ Auto-Generate Labels…
              </button>
              <button type="button" className="btn primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}

        {/* ── Gen: Step 1 — Scope ────────────────────────────────────── */}
        {phase.kind === "gen-scope" && (
          <>
            <div className="modal-header">
              <div className="gen-modal-header-top">
                <button
                  type="button"
                  className="gen-back-link"
                  onClick={() => setPhase({ kind: "browse" })}
                >
                  ← Back to Manage Labels
                </button>
                <StepIndicator current={1} />
              </div>
              <h2 className="mt-0 mb-0">What do you want to generate?</h2>
              <ModalCloseButton onClose={onClose} />
            </div>

            <div className="manage-labels-gen-body">
              <ConflictActionPicker
                name="gen-scope"
                options={SCOPE_OPTIONS}
                value={genScope}
                onChange={setGenScope}
              />
            </div>

            <div className={modalFooter}>
              <button
                type="button"
                className="btn"
                onClick={() => setPhase({ kind: "browse" })}
              >
                ← Back
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => setPhase({ kind: "gen-skills" })}
              >
                Next →
              </button>
            </div>
          </>
        )}

        {/* ── Gen: Step 2 — Skills ───────────────────────────────────── */}
        {phase.kind === "gen-skills" && (
          <>
            <div className="modal-header">
              <div className="gen-modal-header-top">
                <button
                  type="button"
                  className="gen-back-link"
                  onClick={() => setPhase({ kind: "browse" })}
                >
                  ← Back to Manage Labels
                </button>
                <StepIndicator current={2} />
              </div>
              <h2 className="mt-0 mb-0">Which skills?</h2>
              <ModalCloseButton onClose={onClose} />
            </div>

            <div className="manage-labels-gen-body">
              <ConflictActionPicker
                name="gen-skill-mode"
                options={genSkillOptions}
                value={genSkillMode}
                onChange={setGenSkillMode}
              />

              {genSkillMode === "select" && (
                <div className="gen-skill-checklist">
                  <SearchBar
                    value={genSkillSearch}
                    onChange={setGenSkillSearch}
                    placeholder="Filter skills…"
                  />
                  <div className="gen-skill-checklist-list">
                    {genSkillList.map((e) => {
                      const cat = labelsMap[e.name]?.category ?? null;
                      const tagCount = labelsMap[e.name]?.tags?.length ?? 0;
                      const checked = genSkillSelected.has(e.name);
                      return (
                        <label key={e.name} className="gen-skill-row">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const next = new Set(genSkillSelected);
                              if (next.has(e.name)) next.delete(e.name);
                              else next.add(e.name);
                              setGenSkillSelected(next);
                            }}
                          />
                          <span className="gen-skill-row-name">{e.name}</span>
                          {cat ? (
                            <span className="manage-labels-cat-badge">
                              {categoryDisplayName(cat)}
                            </span>
                          ) : (
                            <span className="manage-labels-row-none">—</span>
                          )}
                          <span className="text-muted text-13">
                            {tagCount} tag{tagCount === 1 ? "" : "s"}
                          </span>
                        </label>
                      );
                    })}
                    {genSkillList.length === 0 && (
                      <div className="manage-labels-empty text-muted text-13">
                        No skills match.
                      </div>
                    )}
                  </div>
                  <div className="text-muted text-13 mt-4">
                    {genSkillSelected.size} selected
                  </div>
                </div>
              )}
            </div>

            <div className={modalFooter}>
              <button
                type="button"
                className="btn"
                onClick={() => setPhase({ kind: "gen-scope" })}
              >
                ← Back
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={
                  genSkillMode === "select" && genSkillSelected.size === 0
                }
                onClick={goToReview}
              >
                Confirm →
              </button>
            </div>
          </>
        )}

        {/* ── Gen: Step 3 — Review ──────────────────────────────────── */}
        {phase.kind === "gen-review" &&
          (() => {
            const { proposals, checkedNames, noChangeExpanded } = phase;
            const changed = proposals.filter((p) => p.hasChange);
            const unchanged = proposals.filter((p) => !p.hasChange);
            const allChecked =
              changed.length > 0 &&
              changed.every((p) => checkedNames.has(p.name));
            const applyCount = changed.filter((p) =>
              checkedNames.has(p.name),
            ).length;

            return (
              <>
                <div className="modal-header">
                  <div className="gen-modal-header-top">
                    <button
                      type="button"
                      className="gen-back-link"
                      onClick={() => setPhase({ kind: "browse" })}
                    >
                      ← Back to Manage Labels
                    </button>
                    <StepIndicator current={3} />
                  </div>
                  <div className="gen-review-stats">
                    <h2 className="mt-0 mb-0">Review suggestions</h2>
                    <span className="text-muted text-13">
                      {proposals.length} skill
                      {proposals.length === 1 ? "" : "s"}
                      {" · "}
                      <strong>{changed.length}</strong> change
                      {changed.length === 1 ? "" : "s"}
                      {unchanged.length > 0 &&
                        ` · ${unchanged.length} unchanged`}
                    </span>
                  </div>
                  <ModalCloseButton onClose={onClose} />
                </div>

                <div className="manage-labels-list">
                  {changed.length > 0 && (
                    <div className="gen-review-select-all-row">
                      <label className="manage-labels-select-all-label">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          onChange={toggleAllReviewChecks}
                        />
                        <span>
                          {allChecked ? "Deselect all" : "Select all"}
                        </span>
                      </label>
                    </div>
                  )}

                  {changed.map((p) => (
                    <div key={p.name} className="gen-review-row">
                      <input
                        type="checkbox"
                        className="gen-review-check"
                        checked={checkedNames.has(p.name)}
                        onChange={() => toggleReviewCheck(p.name)}
                        aria-label={`Include ${p.name} in changes`}
                      />
                      <div className="gen-review-row-body">
                        <span className="gen-review-skill-name">{p.name}</span>
                        {(genScope === "both" || genScope === "categories") &&
                          p.currentCategory !== p.proposedCategory && (
                            <div className="gen-review-diff">
                              <span className="text-muted text-13">
                                Category
                              </span>
                              <span className="gen-review-current">
                                {p.currentCategory
                                  ? categoryDisplayName(p.currentCategory)
                                  : "—"}
                              </span>
                              <span className="gen-review-arrow">→</span>
                              <span className="gen-review-proposed">
                                {p.proposedCategory
                                  ? categoryDisplayName(p.proposedCategory)
                                  : "—"}
                              </span>
                            </div>
                          )}
                        {(genScope === "both" || genScope === "tags") &&
                          !tagsAreEqual(p.currentTags, p.proposedTags) && (
                            <div className="gen-review-diff">
                              <span className="text-muted text-13">Tags</span>
                              <span className="gen-review-current">
                                {p.currentTags.length > 0
                                  ? p.currentTags.map((t) => (
                                      <span
                                        key={t}
                                        className="label-chip label-chip--added manage-labels-chip"
                                      >
                                        {t}
                                      </span>
                                    ))
                                  : "—"}
                              </span>
                              <span className="gen-review-arrow">→</span>
                              <span className="gen-review-proposed">
                                {p.proposedTags.length > 0
                                  ? p.proposedTags.map((t) => (
                                      <span
                                        key={t}
                                        className="label-chip label-chip--added manage-labels-chip"
                                      >
                                        {t}
                                      </span>
                                    ))
                                  : "—"}
                              </span>
                            </div>
                          )}
                      </div>
                    </div>
                  ))}

                  {changed.length === 0 && (
                    <div className="manage-labels-empty text-muted text-13">
                      No changes would be made.
                    </div>
                  )}

                  {unchanged.length > 0 && (
                    <div className="gen-review-no-change">
                      <button
                        type="button"
                        className="gen-review-no-change-toggle"
                        onClick={() =>
                          setPhase({
                            ...phase,
                            noChangeExpanded: !noChangeExpanded,
                          })
                        }
                      >
                        <DisclosureChevronInline open={noChangeExpanded} />
                        {unchanged.length} skill
                        {unchanged.length === 1 ? "" : "s"} with no changes
                      </button>
                      {noChangeExpanded && (
                        <div className="gen-review-no-change-list">
                          {unchanged.map((p) => (
                            <span
                              key={p.name}
                              className="gen-review-no-change-name"
                            >
                              {p.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className={`${modalFooter} gen-review-footer`}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setPhase({ kind: "gen-scope" });
                    }}
                  >
                    ↺ Run again
                  </button>
                  <div className="row-between-8 ml-auto">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setPhase({ kind: "browse" })}
                    >
                      Discard changes
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={applyCount === 0}
                      onClick={() => void doApply()}
                    >
                      {applyCount < changed.length && applyCount > 0
                        ? `Apply ${applyCount} of ${changed.length}`
                        : "Apply changes"}
                    </button>
                  </div>
                </div>
              </>
            );
          })()}
      </Modal>

      <ConfirmDialog
        open={confirmClear}
        title="Clear labels"
        body={`Remove labels from ${selectedNames.size} skill${selectedNames.size === 1 ? "" : "s"}? This cannot be undone.`}
        confirmLabel="Clear labels"
        tone="danger"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => void doClearLabels()}
      />
    </>
  );
}

// Inline disclosure chevron to avoid importing DisclosureChevron and adding
// an extra component dep just for one use.
function DisclosureChevronInline({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      style={{
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 0.15s ease",
        display: "inline-block",
        marginRight: 4,
        verticalAlign: "middle",
      }}
      aria-hidden
    >
      <path
        d="M4 2l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
