import React from "react";

interface Props {
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
}: Props): React.ReactElement {
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
