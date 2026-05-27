import React from "react";

interface Props {
  names: string[];
  style?: React.CSSProperties;
}

/**
 * Renders skill names as the shared monospace `.skill-tag` chips,
 * wrapped in a flex-wrap row. Used wherever a category of skills is
 * disclosed (sync banner details, manifest diff breakdown).
 */
export function SkillTagList({ names, style }: Props): React.ReactElement {
  return (
    <div className="skill-tag-list" style={style}>
      {names.map((name) => (
        <span key={name} className="skill-tag">
          {name}
        </span>
      ))}
    </div>
  );
}
