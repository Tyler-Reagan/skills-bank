import React from "react";
import { Icon } from "./Icon.js";

interface Props {
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
}: Props): React.ReactElement {
  return (
    <span className={`disclosure-chevron${open ? " open" : ""}`} style={style}>
      <Icon name="chevron-down" size={size} />
    </span>
  );
}
