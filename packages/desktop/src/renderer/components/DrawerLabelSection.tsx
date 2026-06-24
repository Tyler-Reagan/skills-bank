import React, { useEffect, useRef, useState } from "react";
import type { RegistryEntry } from "@skills-bank/core";
import type { SkillLabelOverride } from "@skills-bank/core/labels";
import {
  categories,
  categoryDisplayName,
  effectiveLabels,
} from "@skills-bank/core/labels";
import { Icon } from "./Icon.js";
import { useLabels } from "../LabelsContext.js";

interface Props {
  entry: RegistryEntry;
}

export function DrawerLabelSection({ entry }: Props): React.ReactElement {
  const { labelsMap, reload } = useLabels();
  const [override, setOverride] = useState<SkillLabelOverride>(
    () => labelsMap[entry.name] ?? {},
  );
  const [addingTag, setAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const tagInputRef = useRef<HTMLInputElement | null>(null);

  // Sync with context when entry changes or when an external write reloads the map.
  useEffect(() => {
    setOverride(labelsMap[entry.name] ?? {});
  }, [entry.name, labelsMap]);

  const effective = effectiveLabels({ category: null, tags: [] }, override);

  async function patch(next: SkillLabelOverride): Promise<void> {
    const merged = { ...override, ...next };
    setOverride(merged); // optimistic
    await window.skillsBank.updateLabel(entry.name, next);
    await reload();
  }

  async function handleCategoryChange(value: string): Promise<void> {
    await patch({ category: value === "__none__" ? null : value });
  }

  async function removeAddedTag(tag: string): Promise<void> {
    await patch({ tags: (override.tags ?? []).filter((t) => t !== tag) });
  }

  async function confirmAddTag(): Promise<void> {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, "-");
    if (t && !effective.tags.includes(t)) {
      await patch({ tags: [...(override.tags ?? []), t] });
    }
    setTagInput("");
    setAddingTag(false);
  }

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
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.display}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="label-field">
        <label className="label-field-label">Tags</label>
        <div className="label-chips">
          {effective.tags.map((tag) => (
            <span key={tag} className="label-chip label-chip--added">
              {tag}
              <button
                type="button"
                className="label-chip-remove"
                aria-label={`Remove tag ${tag}`}
                onClick={() => void removeAddedTag(tag)}
              >
                <Icon name="x" size="sm" />
              </button>
            </span>
          ))}
          {effective.tags.length === 0 && !addingTag && (
            <span className="label-no-tags">No tags</span>
          )}
          {addingTag ? (
            <>
              <input
                ref={tagInputRef}
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
    </div>
  );
}
