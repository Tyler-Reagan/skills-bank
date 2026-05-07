import React, { forwardRef } from "react";
import { Icon } from "./Icon.js";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export const SearchBar = forwardRef<HTMLInputElement, Props>(function SearchBar(
  { value, onChange, placeholder },
  ref,
): React.ReactElement {
  return (
    <div className="search-bar">
      <span className="search-bar-icon" aria-hidden="true">
        <Icon name="search" size="md" />
      </span>
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Search by name, description, or tag"}
        spellCheck={false}
        aria-label="Search skills"
      />
      {value && (
        <button
          className="search-clear"
          onClick={() => onChange("")}
          aria-label="Clear search"
        >
          <Icon name="x" size="md" />
        </button>
      )}
    </div>
  );
});
