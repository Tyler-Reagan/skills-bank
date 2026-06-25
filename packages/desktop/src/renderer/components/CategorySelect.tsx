import React, { useEffect, useRef } from "react";
import { categories } from "@skills-bank/core/labels";

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

export interface CategorySelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
  /** Prepends "All" + "Uncategorized" options (filter mode).
   *  Without this prop, prepends "None" only (edit mode). */
  filterMode?: boolean;
  /** Open the native picker immediately on mount (edit mode, replaces a button click). */
  autoOpen?: boolean;
  onBlur?: () => void;
}

export function CategorySelect({
  value,
  onChange,
  className,
  id,
  filterMode,
  autoOpen,
  onBlur,
}: CategorySelectProps): React.ReactElement {
  const ref = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    if (!autoOpen || !ref.current) return;
    ref.current.focus();
    try {
      (ref.current as HTMLSelectElement & { showPicker?: () => void }).showPicker?.();
    } catch {
      // showPicker unavailable or no transient activation — focus is enough
    }
  }, [autoOpen]);

  return (
    <select
      ref={ref}
      id={id}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    >
      {filterMode ? (
        <>
          <option value="__all__">All</option>
          <option value="__none__">Uncategorized</option>
        </>
      ) : (
        <option value="__none__">None</option>
      )}
      {META_ORDER.map((meta) => {
        const items = categories.filter((c) => c.slug.startsWith(`${meta}:`));
        if (items.length === 0) return null;
        return (
          <optgroup key={meta} label={META_LABELS[meta]!}>
            {items.map((c) => (
              <option key={c.slug} value={c.slug}>
                {functionDisplay(c.display)}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
