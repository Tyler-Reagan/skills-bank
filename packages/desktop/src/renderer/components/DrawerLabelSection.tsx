import React, { useEffect, useRef, useState } from "react";
import type { RegistryEntry } from "@skills-bank/core";
import type { SkillLabelOverride } from "@skills-bank/core/labels";
import {
  categoryRules,
  deriveLabels,
  effectiveLabels,
  tagRules,
} from "@skills-bank/core/labels";
import { Icon } from "./Icon.js";

interface Props {
  entry: RegistryEntry;
  onLabelsChanged: () => void;
}

export function DrawerLabelSection({
  entry,
  onLabelsChanged,
}: Props): React.ReactElement {
  const [override, setOverride] = useState<SkillLabelOverride>({});
  const [addingTag, setAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const tagInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void window.skillsBank
      .readLabels()
      .then((map) => setOverride(map[entry.name] ?? {}));
  }, [entry.name]);

  const derived = deriveLabels({
    name: entry.name,
    description: entry.description,
  });
  const effective = effectiveLabels(derived, override);

  async function patch(next: SkillLabelOverride): Promise<void> {
    const merged = { ...override, ...next };
    setOverride(merged);
    await window.skillsBank.updateLabel(entry.name, next);
    onLabelsChanged();
  }

  async function handleCategoryChange(value: string): Promise<void> {
    await patch({
      category: value === "__none__" ? null : value,
      categorySource: "user",
    });
  }

  async function rejectTag(tag: string): Promise<void> {
    await patch({ rejectedTags: [...(override.rejectedTags ?? []), tag] });
  }

  async function removeAddedTag(tag: string): Promise<void> {
    await patch({
      addedTags: (override.addedTags ?? []).filter((t) => t !== tag),
    });
  }

  async function restoreTag(tag: string): Promise<void> {
    await patch({
      rejectedTags: (override.rejectedTags ?? []).filter((t) => t !== tag),
    });
  }

  async function confirmAddTag(): Promise<void> {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, "-");
    if (t && !effective.tags.includes(t)) {
      await patch({ addedTags: [...(override.addedTags ?? []), t] });
    }
    setTagInput("");
    setAddingTag(false);
  }

  const addedTagSet = new Set(override.addedTags ?? []);
  const rejectedTags = override.rejectedTags ?? [];
  const currentCategory = effective.category ?? "__none__";

  return (
    <div className="drawer-section drawer-label-section">
      <h3>Labels</h3>

      <div className="label-field">
        <label className="label-field-label">Category</label>
        <div className="label-category-row">
          <select
            className="label-category-select"
            value={currentCategory}
            onChange={(e) => void handleCategoryChange(e.target.value)}
          >
            <option value="__none__">None</option>
            {categoryRules.map((r) => (
              <option key={r.category} value={r.category}>
                {r.category.charAt(0).toUpperCase() +
                  r.category.slice(1).replace(/-/g, " ")}
              </option>
            ))}
          </select>
          {override.categorySource === "auto" && (
            <span className="label-source-badge">auto</span>
          )}
        </div>
      </div>

      <div className="label-field">
        <label className="label-field-label">Tags</label>
        <div className="label-chips">
          {effective.tags.map((tag) => {
            const isAdded = addedTagSet.has(tag);
            return (
              <span
                key={tag}
                className={`label-chip ${isAdded ? "label-chip--added" : "label-chip--auto"}`}
              >
                {tag}
                <button
                  type="button"
                  className="label-chip-remove"
                  aria-label={`Remove tag ${tag}`}
                  onClick={() =>
                    void (isAdded ? removeAddedTag(tag) : rejectTag(tag))
                  }
                >
                  <Icon name="x" size="sm" />
                </button>
              </span>
            );
          })}
          {effective.tags.length === 0 && !addingTag && (
            <span className="label-no-tags">No tags</span>
          )}
          {addingTag ? (
            <>
              <input
                ref={tagInputRef}
                list="label-tag-suggestions"
                type="text"
                className="label-tag-input"
                value={tagInput}
                placeholder="tag name"
                autoFocus
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void confirmAddTag();
                  }
                  if (e.key === "Escape") {
                    setAddingTag(false);
                    setTagInput("");
                  }
                }}
                onBlur={() => void confirmAddTag()}
              />
              <datalist id="label-tag-suggestions">
                {tagRules
                  .filter((r) => !effective.tags.includes(r.tag))
                  .map((r) => (
                    <option key={r.tag} value={r.tag} />
                  ))}
              </datalist>
            </>
          ) : (
            <button
              type="button"
              className="label-chip label-chip--add"
              onClick={() => setAddingTag(true)}
            >
              + Add tag
            </button>
          )}
        </div>
      </div>

      {rejectedTags.length > 0 && (
        <div className="label-field">
          <label className="label-field-label label-field-label--muted">
            Rejected tags
          </label>
          <div className="label-chips">
            {rejectedTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="label-chip label-chip--rejected"
                title="Click to restore"
                onClick={() => void restoreTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
