import React from "react";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";

interface Props {
  registry: RegistryEntry[];
  installed: InstalledSkill[];
  onChanged: (message: string) => void | Promise<void>;
}

export function BrowseTab({ registry, installed, onChanged }: Props): React.ReactElement {
  const installedSet = new Set(installed.filter((i) => i.kind === "ours").map((i) => i.name));

  if (registry.length === 0) {
    return <p style={{ color: "#888" }}>No skills in registry. Run <code>npm run build:index</code>.</p>;
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
