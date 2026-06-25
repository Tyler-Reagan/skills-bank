import React, { useEffect, useRef, useState } from "react";
import { categories, categoryDisplayName } from "@skills-bank/core/labels";

const META_LABELS: Record<string, string> = {
  engineering: "Engineering",
  research: "Research",
  business: "Business",
  creative: "Creative",
  productivity: "Productivity",
};
const META_ORDER = [
  "engineering",
  "research",
  "business",
  "creative",
  "productivity",
] as const;

function functionDisplay(display: string): string {
  return display.replace(/^[^:]+:\s*/, "");
}

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
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, ref, onClose]);
}

export interface CategorySelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
  /** Prepends "All" + "Uncategorized" options (filter mode).
   *  Without this prop, prepends "None" only (edit mode). */
  filterMode?: boolean;
  /** Open the panel immediately on mount (edit mode, replaces a button click). */
  autoOpen?: boolean;
  onBlur?: () => void;
}

type GroupItem = { kind: "group"; label: string };
type SelectItem = { kind: "item"; value: string; label: string };
type PanelItem = GroupItem | SelectItem;

export function CategorySelect({
  value,
  onChange,
  className,
  id,
  filterMode,
  autoOpen,
  onBlur,
}: CategorySelectProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function close() {
    setOpen(false);
    setInputValue(null);
    setActiveIndex(-1);
    onBlur?.();
  }

  useOutsideClick(wrapRef, open, close);

  useEffect(() => {
    if (!autoOpen) return;
    setOpen(true);
    setInputValue("");
    inputRef.current?.focus();
  }, [autoOpen]);

  function getDisplayValue(): string {
    if (value === "__all__") return "All";
    if (value === "__none__") return filterMode ? "Uncategorized" : "None";
    const found = categories.find((c) => c.slug === value);
    if (found) return functionDisplay(found.display);
    return categoryDisplayName(value);
  }

  const filter = (inputValue ?? "").toLowerCase();

  const specialItems: SelectItem[] = filterMode
    ? [
        { kind: "item", value: "__all__", label: "All" },
        { kind: "item", value: "__none__", label: "Uncategorized" },
      ]
    : [{ kind: "item", value: "__none__", label: "None" }];

  const filteredSpecial = specialItems.filter(
    (item) => !filter || item.label.toLowerCase().includes(filter),
  );

  const panelItems: PanelItem[] = [...filteredSpecial];

  for (const meta of META_ORDER) {
    const items = categories
      .filter((c) => c.slug.startsWith(`${meta}:`))
      .filter(
        (c) =>
          !filter ||
          functionDisplay(c.display).toLowerCase().includes(filter),
      );
    if (items.length === 0) continue;
    panelItems.push({ kind: "group", label: META_LABELS[meta]! });
    for (const c of items) {
      panelItems.push({
        kind: "item",
        value: c.slug,
        label: functionDisplay(c.display),
      });
    }
  }

  const selectableItems = panelItems.filter(
    (item): item is SelectItem => item.kind === "item",
  );

  function confirmSelection(selected: string) {
    onChange(selected);
    setOpen(false);
    setInputValue(null);
    setActiveIndex(-1);
    onBlur?.();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setOpen(true);
        setInputValue("");
        e.preventDefault();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      close();
    } else if (e.key === "ArrowDown") {
      setActiveIndex((i) => Math.min(i + 1, selectableItems.length - 1));
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      setActiveIndex((i) => Math.max(i - 1, 0));
      e.preventDefault();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const active = activeIndex >= 0 ? selectableItems[activeIndex] : null;
      if (active) {
        confirmSelection(active.value);
      } else if (inputValue !== null && inputValue.trim()) {
        confirmSelection(inputValue.trim());
      } else {
        close();
      }
    }
  }

  return (
    <div
      ref={wrapRef}
      className={`cat-combobox${className ? ` ${className}` : ""}`}
    >
      <input
        ref={inputRef}
        id={id}
        type="text"
        className="cat-combobox-input"
        value={inputValue !== null ? inputValue : getDisplayValue()}
        placeholder={filterMode ? "All" : "None"}
        onChange={(e) => {
          setInputValue(e.target.value);
          setActiveIndex(-1);
        }}
        onFocus={() => {
          if (!open) {
            setOpen(true);
            setInputValue("");
          }
        }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        spellCheck={false}
      />
      {open && (
        <div className="cat-combobox-panel" role="listbox">
          {panelItems.map((item) => {
            if (item.kind === "group") {
              return (
                <div
                  key={`group-${item.label}`}
                  className="cat-combobox-group-header"
                >
                  {item.label}
                </div>
              );
            }
            const selIdx = selectableItems.indexOf(item);
            return (
              <button
                key={item.value}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={item.value === value}
                className={[
                  "cat-combobox-item",
                  item.value === value ? "selected" : "",
                  selIdx === activeIndex ? "active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseDown={(e) => {
                  e.preventDefault();
                  confirmSelection(item.value);
                }}
              >
                {item.label}
              </button>
            );
          })}
          {panelItems.length === 0 && inputValue !== null && inputValue.trim() && (
            <button
              type="button"
              className="cat-combobox-item"
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
                confirmSelection(inputValue.trim());
              }}
            >
              Use &ldquo;{inputValue.trim()}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  );
}
