import React from "react";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";

interface Props {
  registry: RegistryEntry[];
  installed: InstalledSkill[];
  onChanged: (message: string) => void | Promise<void>;
}

export function BrowseTab({ registry, installed, onChanged }: Props): React.ReactElement {
  const installedSet = new Set(installed.filter((i) => i.kind === "ours").map((i) => i.name));
  const [busy, setBusy] = React.useState(false);

  const rebuild = async () => {
    setBusy(true);
    const r = await window.skillsBank.rebuildIndex();
    setBusy(false);
    await onChanged(r.message);
  };

  if (registry.length === 0) {
    return (
      <div style={{ color: "#aaa", textAlign: "center", padding: "48px 16px" }}>
        <p style={{ marginBottom: 16 }}>
          The registry index is empty. If you've added skills under <code>skills/</code>,
          rebuild the index to surface them here.
        </p>
        <button className="primary" disabled={busy} onClick={() => void rebuild()}>
          {busy ? "Rebuilding…" : "Rebuild index"}
        </button>
      </div>
    );
  }

  return (
    <div>
      {registry.map((e) => {
        const isInstalled = installedSet.has(e.name);
        return (
          <div className="row" key={e.name}>
            <div className="meta">
              <h3>{e.name} <span className="tag">{e.category}</span></h3>
              <p>{e.description}</p>
            </div>
            {isInstalled ? (
              <button
                className="danger"
                onClick={async () => {
                  const r = await window.skillsBank.uninstall(e.name);
                  await onChanged(r.message);
                }}
              >
                Uninstall
              </button>
            ) : (
              <button
                className="primary"
                onClick={async () => {
                  const r = await window.skillsBank.install(e.name, false);
                  await onChanged(r.message);
                }}
              >
                Install
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
