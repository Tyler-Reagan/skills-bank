import React from "react";

/**
 * Inline SVG icon set, paths borrowed from Lucide
 * (https://lucide.dev — ISC). currentColor stroke means a parent
 * `color: …` controls the visible color, so the same component
 * works in any context (status chip, button label, drawer, etc).
 *
 * Sizes are CSS tokens (--icon-sm/-md/-lg/-xl) by default; pass a
 * pixel number to override. stroke-width matches Lucide defaults.
 */
export type IconName =
  | "check"
  | "x"
  | "refresh"
  | "alert-triangle"
  | "alert-circle"
  | "arrow-right"
  | "external-link"
  | "search"
  | "info"
  | "broken-link"
  | "folder"
  | "sun"
  | "moon"
  | "density-compact"
  | "density-comfortable";

interface Props {
  name: IconName;
  size?: number | "sm" | "md" | "lg" | "xl";
  strokeWidth?: number;
  className?: string;
  "aria-hidden"?: boolean;
  "aria-label"?: string;
  title?: string;
}

// SVG width/height attributes don't accept CSS variables, so the named
// sizes resolve to numeric pixel values matching the tokens declared in
// theme.css (--icon-sm/md/lg/xl). Keep these in sync with that file.
const SIZE_PX: Record<string, number> = {
  sm: 12,
  md: 14,
  lg: 16,
  xl: 20,
};

export function Icon({
  name,
  size = "md",
  strokeWidth = 2,
  className,
  "aria-hidden": ariaHidden = true,
  "aria-label": ariaLabel,
  title,
}: Props): React.ReactElement {
  const dimension =
    typeof size === "number" ? size : (SIZE_PX[size] ?? SIZE_PX["md"]!);
  const a11yProps = ariaLabel
    ? { role: "img" as const, "aria-label": ariaLabel }
    : { "aria-hidden": ariaHidden };
  return (
    <svg
      width={dimension}
      height={dimension}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, display: "inline-block", verticalAlign: "-2px" }}
      {...a11yProps}
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}

// Path data for each supported icon. Source: Lucide.
const PATHS: Record<IconName, React.ReactElement> = {
  check: <polyline points="20 6 9 17 4 12" />,
  x: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  refresh: (
    <>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
      <path d="M20.49 15A9 9 0 0 1 5.64 18.36L1 14" />
    </>
  ),
  "alert-triangle": (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  "alert-circle": (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </>
  ),
  "arrow-right": (
    <>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </>
  ),
  "external-link": (
    <>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </>
  ),
  "broken-link": (
    <>
      <path d="M9 17H7a5 5 0 0 1 0-10h2" />
      <path d="M15 7h2a5 5 0 0 1 4.62 6.86" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </>
  ),
  folder: (
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </>
  ),
  moon: (
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  ),
  // Lucide "align-justify" — four horizontal lines, evokes compact rows.
  "density-compact": (
    <>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </>
  ),
  // Lucide "layout-grid" — 2x2 boxes, evokes a roomy grid.
  "density-comfortable": (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </>
  ),
};
