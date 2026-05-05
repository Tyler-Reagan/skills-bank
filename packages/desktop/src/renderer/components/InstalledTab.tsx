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

const kindBlurb: Record<string, string> = {
  "foreign-symlink":
    "Symlink targets a folder outside this registry. Migrate to adopt it into skills/, or register it as external.",
  "real-directory":
    "Plain directory not yet managed by skills-bank. Migrate to move it into skills/ and replace it with a symlink.",
  "broken-symlink":
    "Symlink target is missing. Migrate to remove it.",
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

  const integrated = installed.filter((s) => s.kind === "ours");
  const unintegrated = installed.filter((s) => s.kind !== "ours");

  return (
    <div>
      {unintegrated.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <header style={sectionHeader}>
            <div>
              <h2 style={{ margin: 0, fontSize: 14 }}>
                Not yet integrated{" "}
                <span style={{ color: "#888", fontWeight: "normal" }}>
                  ({unintegrated.length})
                </span>
              </h2>
              <p style={{ margin: "4px 0 0", color: "#aaa", fontSize: 12 }}>
                These skills exist under <code>~/.claude/skills</code> but aren't
                managed by skills-bank.
              </p>
            </div>
            <button className="primary" onClick={onScanForExisting}>
              Migrate all…
            </button>
          </header>
          {unintegrated.map((s) => (
            <div className="row" key={s.name}>
              <div className="meta">
                <h3>
                  {s.name}{" "}
                  <span className={tagClass[s.kind] ?? "tag"}>{s.kind}</span>
                </h3>
                <p>{s.target ?? s.linkPath}</p>
                {kindBlurb[s.kind] && (
                  <p style={{ color: "#888", marginTop: 4 }}>
                    {kindBlurb[s.kind]}
                  </p>
                )}
              </div>
              <button onClick={onScanForExisting}>Migrate…</button>
            </div>
          ))}
        </section>
      )}

      {integrated.length > 0 && (
        <section>
          <header style={sectionHeader}>
            <h2 style={{ margin: 0, fontSize: 14 }}>
              Integrated{" "}
              <span style={{ color: "#888", fontWeight: "normal" }}>
                ({integrated.length})
              </span>
            </h2>
          </header>
          {integrated.map((s) => (
            <div className="row" key={s.name}>
              <div className="meta">
                <h3>
                  {s.name}{" "}
                  <span className={tagClass[s.kind] ?? "tag"}>{s.kind}</span>
                </h3>
                <p>{s.target ?? s.linkPath}</p>
              </div>
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
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

const sectionHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 12px 8px",
  borderBottom: "1px solid #333",
  marginBottom: 4,
};
