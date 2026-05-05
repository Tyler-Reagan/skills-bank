import React, { useCallback, useEffect, useState } from "react";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";
import { BrowseTab } from "./components/BrowseTab.js";
import { InstalledTab } from "./components/InstalledTab.js";
import { MigrateModal } from "./components/MigrateModal.js";

type TabId = "browse" | "installed";

export function App(): React.ReactElement {
  const [tab, setTab] = useState<TabId>("browse");
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [installed, setInstalled] = useState<InstalledSkill[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [showMigrate, setShowMigrate] = useState(false);

  const refresh = useCallback(async () => {
    const [r, i] = await Promise.all([
      window.skillsBank.listRegistry(),
      window.skillsBank.listInstalled(),
    ]);
    setRegistry(r);
    setInstalled(i);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const needsMigration = installed.some(
    (i) => i.kind === "real-directory" || i.kind === "foreign-symlink" || i.kind === "broken-symlink",
  );

  return (
    <div className="app">
      <div className="tabs">
        <div className={`tab ${tab === "browse" ? "active" : ""}`} onClick={() => setTab("browse")}>
          Browse ({registry.length})
        </div>
        <div className={`tab ${tab === "installed" ? "active" : ""}`} onClick={() => setTab("installed")}>
          Installed ({installed.length})
        </div>
      </div>
      <div className="content">
        {tab === "installed" && needsMigration && (
          <div className="banner">
            <span>Some installed skills aren't integrated with skills-bank yet.</span>
            <button className="primary" onClick={() => setShowMigrate(true)}>
              Migrate…
            </button>
          </div>
        )}
        {tab === "browse" && (
          <BrowseTab
            registry={registry}
            installed={installed}
            onChanged={async (msg) => {
              flash(msg);
              await refresh();
            }}
          />
        )}
        {tab === "installed" && (
          <InstalledTab
            installed={installed}
            onChanged={async (msg) => {
              flash(msg);
              await refresh();
            }}
          />
        )}
      </div>
      {showMigrate && (
        <MigrateModal
          onClose={async () => {
            setShowMigrate(false);
            await refresh();
          }}
          onFlash={flash}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
