import React from "react";
import type { InstalledSkill } from "@skills-bank/core";

interface Props {
  installed: InstalledSkill[];
  onChanged: (message: string) => void | Promise<void>;
  onBrowse: () => void;
  onScanForExisting: () => void;
}

const tagClass: Record<string, string> = {
  ours: "tag ours",
  "foreign-symlink": "tag foreign",
  "real-directory": "tag real",
  "broken-symlink": "tag broken",
};

export function InstalledTab({
  installed,
  onChanged,
  onBrowse,
  onScanForExisting,
}: Props): React.ReactElement {
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);

  const uninstall = async (name: string) => {
    setRowBusy(name);
    try {
      const r = await window.skillsBank.uninstall(name);
      await onChanged(r.message);
    } finally {
      setRowBusy(null);
    }
  };

  if (installed.length === 0) {
    return (
      <div style={{ color: "#aaa", textAlign: "center", padding: "48px 16px" }}>
        <p style={{ marginBottom: 16 }}>
          Nothing installed under <code>~/.claude/skills</code>.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button className="primary" onClick={onBrowse}>
            Browse registry
          </button>
          <button onClick={onScanForExisting}>Scan for existing skills</button>
        </div>
      </div>
    );
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
              disabled={rowBusy !== null}
              onClick={() => void uninstall(s.name)}
            >
              {rowBusy === s.name ? (
                <>
                  <span className="spinner inline" /> Uninstalling…
                </>
              ) : (
                "Uninstall"
              )}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
