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
  const [rowBusy, setRowBusy] = React.useState<{ name: string; verb: string } | null>(null);

  const rebuild = async () => {
    setBusy(true);
    const r = await window.skillsBank.rebuildIndex();
    setBusy(false);
    await onChanged(r.message);
  };

  const runRow = async (
    name: string,
    verb: "Installing" | "Uninstalling" | "Exporting",
    fn: () => Promise<{ ok: boolean; message: string }>,
  ) => {
    setRowBusy({ name, verb });
    try {
      const r = await fn();
      await onChanged(r.message);
    } finally {
      setRowBusy(null);
    }
  };

  if (registry.length === 0) {
    return (
      <div style={{ color: "#aaa", textAlign: "center", padding: "48px 16px" }}>
        <p style={{ marginBottom: 16 }}>
          The registry index is empty. If you've added skills under <code>skills/</code>,
          rebuild the index to surface them here.
        </p>
        <button className="primary" disabled={busy} onClick={() => void rebuild()}>
          {busy ? (
            <>
              <span className="spinner inline" /> Rebuilding…
            </>
          ) : (
            "Rebuild index"
          )}
        </button>
      </div>
    );
  }

  return (
    <div>
      {registry.map((e) => {
        const isInstalled = installedSet.has(e.name);
        const thisBusy = rowBusy?.name === e.name;
        const anyBusy = rowBusy !== null;
        return (
          <div className="row" key={e.name}>
            <div className="meta">
              <h3>{e.name} <span className="tag">{e.category}</span></h3>
              <p>{e.description}</p>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                disabled={anyBusy}
                title="Export this skill (.md if standalone, .zip if bundled)"
                onClick={() =>
                  void runRow(e.name, "Exporting", () =>
                    window.skillsBank.exportSkill(e.name),
                  )
                }
              >
                {thisBusy && rowBusy?.verb === "Exporting" ? (
                  <>
                    <span className="spinner inline" /> Exporting…
                  </>
                ) : (
                  "Export"
                )}
              </button>
              {isInstalled ? (
                <button
                  className="danger"
                  disabled={anyBusy}
                  onClick={() =>
                    void runRow(e.name, "Uninstalling", () =>
                      window.skillsBank.uninstall(e.name),
                    )
                  }
                >
                  {thisBusy && rowBusy?.verb === "Uninstalling" ? (
                    <>
                      <span className="spinner inline" /> Uninstalling…
                    </>
                  ) : (
                    "Uninstall"
                  )}
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={anyBusy}
                  onClick={() =>
                    void runRow(e.name, "Installing", () =>
                      window.skillsBank.install(e.name, false),
                    )
                  }
                >
                  {thisBusy && rowBusy?.verb === "Installing" ? (
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
