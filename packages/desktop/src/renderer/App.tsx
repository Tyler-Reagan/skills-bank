import React, { useCallback, useEffect, useState } from "react";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";
import { BrowseTab } from "./components/BrowseTab.js";
import { InstalledTab } from "./components/InstalledTab.js";
import { MigrateModal } from "./components/MigrateModal.js";
import { SingleMigrateModal } from "./components/SingleMigrateModal.js";
import { Header } from "./components/Header.js";
import { Tabs, type TabId } from "./components/Tabs.js";
import { SkillDetailDrawer } from "./components/SkillDetailDrawer.js";

const LS_KEYS = {
  search: "skills-bank.searchQuery",
  tagFilter: "skills-bank.tagFilter",
  tab: "skills-bank.activeTab",
};

function readLS(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function readTagFilterLS(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEYS.tagFilter);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function App(): React.ReactElement {
  const [tab, setTab] = useState<TabId>(
    (readLS(LS_KEYS.tab, "browse") as TabId) ?? "browse",
  );
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [installed, setInstalled] = useState<InstalledSkill[]>([]);
  const [registryRoot, setRegistryRoot] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showMigrate, setShowMigrate] = useState(false);
  const [singleMigrateTarget, setSingleMigrateTarget] =
    useState<InstalledSkill | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const [search, setSearchState] = useState<string>(readLS(LS_KEYS.search, ""));
  const [selectedTags, setSelectedTagsState] = useState<string[]>(readTagFilterLS);
  const [selected, setSelected] = useState<RegistryEntry | null>(null);

  const setSearch = (v: string) => {
    setSearchState(v);
    writeLS(LS_KEYS.search, v);
  };
  const setSelectedTags = (next: string[]) => {
    setSelectedTagsState(next);
    writeLS(LS_KEYS.tagFilter, JSON.stringify(next));
  };
  const setTabPersisted = (t: TabId) => {
    setTab(t);
    writeLS(LS_KEYS.tab, t);
  };

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [r, i, root] = await Promise.all([
        window.skillsBank.listRegistry(),
        window.skillsBank.listInstalled(),
        window.skillsBank.getRoot(),
      ]);
      setRegistry(r);
      setInstalled(i);
      setRegistryRoot(root);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh().finally(() => setInitialLoading(false));
  }, [refresh]);

  // Keep the drawer's entry up-to-date if the registry refreshes.
  useEffect(() => {
    if (selected) {
      const fresh = registry.find((e) => e.name === selected.name);
      if (fresh && fresh !== selected) setSelected(fresh);
      else if (!fresh) setSelected(null);
    }
  }, [registry, selected]);

  if (initialLoading) {
    return (
      <div className="app">
        <div className="loading-screen">
          <div className="spinner" />
          <p>Loading registry and installed skills…</p>
        </div>
      </div>
    );
  }

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const rebuild = async () => {
    setRebuilding(true);
    try {
      const r = await window.skillsBank.rebuildIndex();
      flash(r.message);
      await refresh();
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <div className="app">
      <Header
        registry={registry}
        installed={installed}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
      />
      <Tabs
        active={tab}
        onChange={setTabPersisted}
        registryCount={registry.length}
        installedCount={installed.length}
      />
      <div className="content">
        {tab === "browse" && (
          <BrowseTab
            registry={registry}
            installed={installed}
            search={search}
            setSearch={setSearch}
            selectedTags={selectedTags}
            setSelectedTags={setSelectedTags}
            onSelect={(e) => setSelected(e)}
            onRebuild={rebuild}
            rebuilding={rebuilding}
          />
        )}
        {tab === "installed" && (
          <InstalledTab
            installed={installed}
            registry={registry}
            onSwitchToBrowse={() => setTabPersisted("browse")}
            onMigrateAll={() => setShowMigrate(true)}
            onMigrateOne={(s) => setSingleMigrateTarget(s)}
            onSelectIntegrated={(e) => setSelected(e)}
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

      {singleMigrateTarget && (
        <SingleMigrateModal
          entry={singleMigrateTarget}
          onClose={async () => {
            setSingleMigrateTarget(null);
            await refresh();
          }}
          onFlash={flash}
        />
      )}

      {selected && (
        <SkillDetailDrawer
          entry={selected}
          installed={installed}
          registryRoot={registryRoot}
          onClose={() => setSelected(null)}
          onChanged={async (msg) => {
            flash(msg);
            await refresh();
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
