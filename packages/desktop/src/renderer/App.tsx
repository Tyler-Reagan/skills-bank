import React, { useCallback, useEffect, useRef, useState } from "react";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";
import { BrowseTab } from "./components/BrowseTab.js";
import { InstalledTab } from "./components/InstalledTab.js";
import { MigrateModal } from "./components/MigrateModal.js";
import { SingleMigrateModal } from "./components/SingleMigrateModal.js";
import { Header, type Theme } from "./components/Header.js";
import { Tabs, type TabId } from "./components/Tabs.js";
import { SkillDetailDrawer } from "./components/SkillDetailDrawer.js";

const LS_KEYS = {
  search: "skills-bank.searchQuery",
  tagFilter: "skills-bank.tagFilter",
  tab: "skills-bank.activeTab",
  theme: "skills-bank.theme",
};

function readInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(LS_KEYS.theme);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // fall through
  }
  // Honor OS preference for first run when nothing is stored.
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }
  return "dark";
}

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
  type ToastShape = {
    message: string;
    action?: { label: string; onClick: () => void };
  };
  const [toast, setToast] = useState<ToastShape | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showMigrate, setShowMigrate] = useState(false);
  const [singleMigrateTarget, setSingleMigrateTarget] =
    useState<InstalledSkill | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const [search, setSearchState] = useState<string>(readLS(LS_KEYS.search, ""));
  const [selectedTags, setSelectedTagsState] = useState<string[]>(readTagFilterLS);
  const [selected, setSelected] = useState<RegistryEntry | null>(null);
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  // Apply the active theme to <html data-theme="…"> so CSS-variable
  // overrides flow through every component.
  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
    writeLS(LS_KEYS.theme, theme);
  }, [theme]);

  const toggleTheme = () =>
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));

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
      <div className="app" aria-busy="true">
        <Header
          refreshing={true}
          onRefresh={() => undefined}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <Tabs
          active="browse"
          onChange={() => undefined}
          registryCount={0}
          installedCount={0}
        />
        <div className="content">
          <div
            className="skills-grid"
            aria-label="Loading registry and installed skills"
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="skeleton skeleton-card"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const flash = (msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message: msg });
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  };

  const flashWithAction = (
    msg: string,
    label: string,
    onClick: () => void,
  ) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({
      message: msg,
      action: {
        label,
        onClick: () => {
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          setToast(null);
          onClick();
        },
      },
    });
    toastTimerRef.current = setTimeout(() => setToast(null), 6000);
  };

  const undoUninstall = (name: string) => {
    void (async () => {
      const r = await window.skillsBank.install(name, false);
      flash(r.message);
      await refresh();
    })();
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
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <Tabs
        active={tab}
        onChange={setTabPersisted}
        registryCount={registry.length}
        installedCount={installed.length}
      />
      <div
        className="content"
        role="tabpanel"
        id={`tabpanel-${tab}`}
        aria-labelledby={`tab-${tab}`}
      >
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
          onUninstalled={(name) => {
            flashWithAction(`Uninstalled ${name}`, "Undo", () =>
              undoUninstall(name),
            );
            void refresh();
          }}
        />
      )}

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast.message}</span>
          {toast.action && (
            <button
              className="toast-action"
              onClick={toast.action.onClick}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
