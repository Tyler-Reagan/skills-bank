import React from "react";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";

interface Props {
  registry: RegistryEntry[];
  installed: InstalledSkill[];
  onChanged: (message: string) => void | Promise<void>;
  onSwitchToInstalled: () => void;
}

export function BrowseTab({
  registry,
  installed,
  onChanged,
  onSwitchToInstalled,
}: Props): React.ReactElement {
  const installedSet = new Set(
    installed.filter((i) => i.kind === "ours").map((i) => i.name),
  );
  const [busy, setBusy] = React.useState(false);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);

  const rebuild = async () => {
    setBusy(true);
    const r = await window.skillsBank.rebuildIndex();
    setBusy(false);
    await onChanged(r.message);
  };

  const install = async (name: string) => {
    setRowBusy(name);
    try {
      const r = await window.skillsBank.install(name, false);
      await onChanged(r.message);
    } finally {
      setRowBusy(null);
    }
  };

  if (registry.length === 0) {
    return (
      <div style={{ color: "#aaa", textAlign: "center", padding: "48px 16px" }}>
        <p style={{ marginBottom: 16 }}>
          The registry is empty. Add a skill folder under <code>skills/&lt;category&gt;/&lt;name&gt;/</code>
          {" "}with a <code>meta.json</code> or a <code>SKILL.md</code> with YAML frontmatter.
        </p>
        <button className="primary" disabled={busy} onClick={() => void rebuild()}>
          {busy ? (
            <>
              <span className="spinner inline" /> Refreshing…
            </>
          ) : (
            "Refresh"
          )}
        </button>
      </div>
    );
  }

  return (
    <div>
      {registry.map((e) => {
        const isInstalled = installedSet.has(e.name);
        const thisBusy = rowBusy === e.name;
        const anyBusy = rowBusy !== null;
        return (
          <div className="row" key={e.path}>
            <div className="meta" style={{ flex: 1 }}>
              <h3 style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>{e.name}</span>
                <span className="tag">{e.category}</span>
                {e.version && (
                  <span className="tag" style={{ background: "#1e3a4a", color: "#7fc7dc" }}>
                    v{e.version}
                  </span>
                )}
                {e.warnings && e.warnings.length > 0 && (
                  <span className="tag" style={{ background: "#4a3a1e", color: "#dcc77f" }}>
                    ⚠ {e.warnings.length} warning{e.warnings.length === 1 ? "" : "s"}
                  </span>
                )}
              </h3>
              <p>{e.description || <em style={{ color: "#666" }}>(no description)</em>}</p>
              <p style={{ color: "#777", fontSize: 11, marginTop: 4 }}>
                <code>{e.path}</code>
                {e.author && (
                  <>
                    {" · "}by {e.author}
                  </>
                )}
                {e.lastCommit && (
                  <>
                    {" · last commit "}
                    {new Date(e.lastCommit.date).toLocaleDateString()}
                    {" "}<span style={{ color: "#555" }}>({e.lastCommit.sha.slice(0, 7)})</span>
                  </>
                )}
              </p>
              {e.tags && e.tags.length > 0 && (
                <p style={{ marginTop: 4 }}>
                  {e.tags.map((t) => (
                    <span
                      key={t}
                      className="tag"
                      style={{ marginRight: 4, fontSize: 10 }}
                    >
                      #{t}
                    </span>
                  ))}
                </p>
              )}
              {e.warnings && e.warnings.length > 0 && (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "#dcc77f", fontSize: 11 }}>
                  {e.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, minWidth: 130 }}>
              {isInstalled ? (
                <>
                  <span style={{ color: "#7fdc9a", fontSize: 12 }}>✓ Installed</span>
                  <button
                    onClick={onSwitchToInstalled}
                    style={{ fontSize: 11, padding: "4px 8px" }}
                    title="Manage on the Installed tab"
                  >
                    Manage →
                  </button>
                </>
              ) : (
                <button
                  className="primary"
                  disabled={anyBusy}
                  onClick={() => void install(e.name)}
                >
                  {thisBusy ? (
                    <>
                      <span className="spinner inline" /> Installing…
                    </>
                  ) : (
                    "Install"
                  )}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
