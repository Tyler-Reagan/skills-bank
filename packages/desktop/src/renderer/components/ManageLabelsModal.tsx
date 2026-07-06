import React, { useEffect, useRef, useMemo, useState } from "react";
import { SearchBar } from "./primitives.js";
import type { LabelsMap, RegistryEntry } from "@skills-bank/core";
import { categoryDisplayName } from "@skills-bank/core/labels";
import { CategorySelect } from "./CategorySelect.js";
import { useLabels } from "../LabelsContext.js";
import { Modal, ModalCloseButton, modalFooter } from "./modalStyles.js";
import { Icon } from "./Icon.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { useRegistry } from "../RegistryContext.js";

// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey = "name-asc" | "name-desc" | "category" | "uncategorized-first";

interface Props {
  onClose: () => void;
  onOpenSkill: (entry: RegistryEntry) => void;
  drawerOpen?: boolean;
}

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

// ── Sub-components ────────────────────────────────────────────────────────────

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

  async function handleCategoryChange(val: string) {
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
          <CategorySelect
            className="manage-labels-select manage-labels-row-cat-select"
            value={category ?? "__none__"}
            onChange={(val) => void handleCategoryChange(val)}
            onBlur={() => setEditingCategory(false)}
            autoOpen
          />
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

  // ── Browse state ────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("__all__");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>("name-asc");
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [confirmClear, setConfirmClear] = useState(false);

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

  // ── In-row label patch ───────────────────────────────────────────────────────
  async function patchLabel(
    name: string,
    patch: { category?: string | null; tags?: string[] },
  ): Promise<void> {
    await window.skillsBank.updateLabel(name, patch);
    await reload();
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <Modal
        label="Manage Labels"
        width={720}
        onClose={!drawerOpen ? onClose : undefined}
        trapFocus
      >
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
          <label className="manage-labels-filter-label" htmlFor="ml-cat-filter">
            Category
          </label>
          <CategorySelect
            id="ml-cat-filter"
            className="manage-labels-select"
            value={categoryFilter}
            onChange={setCategoryFilter}
            filterMode
          />
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
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
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
