import React from "react";
import { Icon } from "./Icon.js";

interface Props {
  text: string;
  /** Optional aria-label. Falls back to `text`. */
  label?: string;
}

/**
 * Small info icon that shows a tooltip on hover or keyboard focus.
 * Used inline next to ambiguous terms to disambiguate without
 * cluttering the primary copy. Width-capped so long explanations wrap.
 */
export function InfoTooltip({ text, label }: Props): React.ReactElement {
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
