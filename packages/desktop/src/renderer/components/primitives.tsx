import React, { forwardRef } from "react";
import { Icon } from "./Icon.js";

// Stateless UI micro-primitives, gathered into one file the way
// modalStyles.tsx gathers modal chrome. A component belongs here when
// it has no state machine of its own and exists purely to render a
// shared affordance; anything that grows real logic moves back out to
// its own file.

interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(
  function SearchBar(
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
  },
);

interface InfoTooltipProps {
  text: string;
  /** Optional aria-label. Falls back to `text`. */
  label?: string;
}

/**
 * Small info icon that shows a tooltip on hover or keyboard focus.
 * Used inline next to ambiguous terms to disambiguate without
 * cluttering the primary copy. Width-capped so long explanations wrap.
 */
export function InfoTooltip({
  text,
  label,
}: InfoTooltipProps): React.ReactElement {
  return (
    <span
      className="info-tooltip"
      tabIndex={0}
      role="img"
      aria-label={label ?? text}
    >
      <Icon name="info" size="sm" />
      <span className="info-tooltip-bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}

interface DisclosureChevronProps {
  open: boolean;
  size?: number | "sm" | "md" | "lg" | "xl";
  style?: React.CSSProperties;
}

/**
 * Down-chevron that rotates 180° when open — the shared affordance for
 * expand/collapse disclosures. Rotation is CSS-driven so the global
 * reduced-motion reset disables it.
 */
export function DisclosureChevron({
  open,
  size = "sm",
  style,
}: DisclosureChevronProps): React.ReactElement {
  return (
    <span className={`disclosure-chevron${open ? " open" : ""}`} style={style}>
      <Icon name="chevron-down" size={size} />
    </span>
  );
}

interface SkillTagListProps {
  names: string[];
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Renders skill names as the shared monospace `.skill-tag` chips,
 * wrapped in a flex-wrap row. Used wherever a category of skills is
 * disclosed (sync banner details, manifest diff breakdown).
 */
export function SkillTagList({
  names,
  style,
  className,
}: SkillTagListProps): React.ReactElement {
  return (
    <div
      className={`skill-tag-list${className ? ` ${className}` : ""}`}
      style={style}
    >
      {names.map((name) => (
        <span key={name} className="skill-tag">
          {name}
        </span>
      ))}
    </div>
  );
}

/**
 * Pre-mount placeholder rendered while the renderer is still resolving
 * which top-level view to show (LoginScreen vs main app shell).
 *
 * Without this, the app renders its loading skeleton chrome before the
 * auth status is known — so on first launch the user briefly sees the
 * full app outline, which then snaps to LoginScreen. The splash keeps
 * the visual feedback consistent: one calm loading state that
 * transitions to the real first frame the user should see.
 */
export function SplashScreen(): React.ReactElement {
  return (
    <div className="splash" role="status" aria-live="polite">
      <div className="splash-stack">
        <div className="splash-mark" aria-hidden="true">
          <span className="spinner" />
        </div>
        <div className="splash-title">Skills Bank</div>
        <div className="splash-subtitle">Loading</div>
      </div>
    </div>
  );
}
