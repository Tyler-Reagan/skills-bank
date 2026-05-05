import React from "react";
import type { InstalledSkill } from "@skills-bank/core";

interface Props {
  installed: InstalledSkill[];
  onChanged: (message: string) => void | Promise<void>;
}

const tagClass: Record<string, string> = {
  ours: "tag ours",
  "foreign-symlink": "tag foreign",
  "real-directory": "tag real",
  "broken-symlink": "tag broken",
};

export function InstalledTab({ installed, onChanged }: Props): React.ReactElement {
  if (installed.length === 0) {
    return <p style={{ color: "#888" }}>Nothing installed under ~/.claude/skills.</p>;
  }
  return (
    <div>
      {installed.map((s) => (
        <div className="row" key={s.name}>
          <div className="meta">
            <h3>
              {s.name} <span className={tagClass[s.kind] ?? "tag"}>{s.kind}</span>
            </h3>
            <p>{s.target ?? s.linkPath}</p>
          </div>
          {s.kind === "ours" && (
            <button
              className="danger"
              onClick={async () => {
                const r = await window.skillsBank.uninstall(s.name);
                await onChanged(r.message);
              }}
            >
              Uninstall
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
