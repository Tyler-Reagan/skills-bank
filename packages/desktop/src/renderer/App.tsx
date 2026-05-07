import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConflictEntry,
  InstalledSkill,
  RegistryEntry,
} from "@skills-bank/core";
import { BrowseTab } from "./components/BrowseTab.js";
import { ConflictResolutionModal } from "./components/ConflictResolutionModal.js";
import { InstalledTab } from "./components/InstalledTab.js";
import { MigrateModal } from "./components/MigrateModal.js";
import { Header, type Density, type Theme } from "./components/Header.js";
import { ConflictResolveModal } from "./components/ConflictResolveModal.js";
import { LoginScreen } from "./components/LoginScreen.js";
import { SplashScreen } from "./components/SplashScreen.js";
import { ManageLinksModal } from "./components/ManageLinksModal.js";
import {
  DEFAULT_SETTINGS,
  SettingsModal,
  type AppSettings,
} from "./components/SettingsModal.js";
import { KeyboardShortcutsOverlay } from "./components/KeyboardShortcutsOverlay.js";
import { RepoPickerModal } from "./components/RepoPickerModal.js";
import { SetupScreen } from "./components/SetupScreen.js";
import { SyncBanner } from "./components/SyncBanner.js";
import { Tabs, type TabId } from "./components/Tabs.js";
import { SkillDetailDrawer } from "./components/SkillDetailDrawer.js";
import type { AuthStatus, SyncStatus } from "../shared/ipc.js";

const LS_KEYS = {
  search: "skills-bank.searchQuery",
  tagFilter: "skills-bank.tagFilter",
  tab: "skills-bank.activeTab",
  theme: "skills-bank.theme",
  density: "skills-bank.density",
  installedOnly: "skills-bank.installedOnly",
  settings: "skills-bank.settings",
};

function readSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(LS_KEYS.settings);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

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

function readInitialDensity(): Density {
  try {
    const stored = localStorage.getItem(LS_KEYS.density);
    if (stored === "compact" || stored === "comfortable") return stored;
  } catch {
    // fall through
  }
  return "comfortable";
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
  const [configChecked, setConfigChecked] = useState(false);
  type ToastShape = {
    message: string;
    action?: { label: string; onClick: () => void };
  };
  const [toast, setToast] = useState<ToastShape | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showMigrate, setShowMigrate] = useState(false);
  // Manage-agent-links is a standalone modal targeting a single skill name.
  // Its target may originate from the registry tab, the installed-registered
  // section, or the installed-not-registered section — uniformly handled.
  const [manageLinksTarget, setManageLinksTarget] = useState<{
    name: string;
    installations: InstalledSkill[];
  } | null>(null);
  const [conflictTarget, setConflictTarget] = useState<{
    name: string;
    conflicts: InstalledSkill[];
  } | null>(null);
  const [settings, setSettingsState] = useState<AppSettings>(readSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const saveSettings = useCallback((next: AppSettings) => {
    setSettingsState(next);
    try {
      localStorage.setItem(LS_KEYS.settings, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const [search, setSearchState] = useState<string>(readLS(LS_KEYS.search, ""));
  const [installedOnly, setInstalledOnlyState] = useState<boolean>(
    () => readLS(LS_KEYS.installedOnly, "false") === "true",
  );
  const [selectedTags, setSelectedTagsState] =
    useState<string[]>(readTagFilterLS);
  const [selected, setSelected] = useState<RegistryEntry | null>(null);
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const [density, setDensity] = useState<Density>(readInitialDensity);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ kind: "idle" });
  const [pendingConflicts, setPendingConflicts] = useState(0);
  const [conflictModalEntries, setConflictModalEntries] = useState<
    ConflictEntry[] | null
  >(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [showRepoPicker, setShowRepoPicker] = useState(false);

  // Tab badge counts — dedupe by skill name so a skill linked into two
  // agent dirs counts once. The toast computed by refresh() uses the
  // same expression; keep them in sync via this single derivation.
  const uniqueInstalledCount = new Set(installed.map((i) => i.name)).size;

  // Apply the active theme to <html data-theme="…"> so CSS-variable
  // overrides flow through every component.
  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
    writeLS(LS_KEYS.theme, theme);
  }, [theme]);

  // Density flows through the same pattern via data-density.
  useEffect(() => {
    document.documentElement.dataset["density"] = density;
    writeLS(LS_KEYS.density, density);
  }, [density]);

  // Grid columns from settings → data-grid-cols on <html>; CSS reads
  // this attribute to override the auto-fit grid layout.
  useEffect(() => {
    document.documentElement.dataset["gridCols"] = settings.gridColumns;
  }, [settings.gridColumns]);

  // Global keyboard shortcuts: Cmd/Ctrl+K and "/" focus the search bar.
  // Skip when the user is already typing in another input/textarea so
  // we don't hijack their typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inEditable =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      const slash = e.key === "/" && !inEditable;
      if (cmdK || slash) {
        e.preventDefault();
        if (tab !== "browse") setTabPersisted("browse");
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab]);

  const toggleTheme = () =>
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  const toggleDensity = () =>
    setDensity((prev) => (prev === "comfortable" ? "compact" : "comfortable"));

  const setSearch = (v: string) => {
    setSearchState(v);
    writeLS(LS_KEYS.search, v);
  };
  const setSelectedTags = (next: string[]) => {
    setSelectedTagsState(next);
    writeLS(LS_KEYS.tagFilter, JSON.stringify(next));
  };
  const setInstalledOnly = (v: boolean) => {
    setInstalledOnlyState(v);
    writeLS(LS_KEYS.installedOnly, String(v));
  };
  const setTabPersisted = (t: TabId) => {
    setTab(t);
    writeLS(LS_KEYS.tab, t);
  };

  const flash = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message: msg });
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  }, []);

  const flashWithAction = useCallback(
    (msg: string, label: string, onClick: () => void) => {
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
    },
    [],
  );

  // Minimum spinner duration so the user actually sees the load state.
  // Without it, a sub-100ms refresh just flickers and reads as "nothing
  // happened." Returns counts so the Refresh-button click handler can
  // surface a meaningful toast.
  const refresh = useCallback(async (): Promise<{
    registryCount: number;
    installedCount: number;
  }> => {
    setRefreshing(true);
    const minSpinner = new Promise<void>((resolve) =>
      setTimeout(resolve, 250),
    );
    try {
      const cfg = await window.skillsBank.getConfig();
      setRegistryRoot(cfg.registryRoot);
      setConfigChecked(true);
      if (!cfg.registryRoot) {
        setRegistry([]);
        setInstalled([]);
        await minSpinner;
        return { registryCount: 0, installedCount: 0 };
      }
      const [r, i] = await Promise.all([
        window.skillsBank.listRegistry(),
        window.skillsBank.listInstalled(),
      ]);
      setRegistry(r);
      setInstalled(i);
      await minSpinner;
      return {
        registryCount: r.length,
        installedCount: new Set(i.map((x) => x.name)).size,
      };
    } finally {
      setRefreshing(false);
    }
  }, []);

  const onRefreshClick = useCallback(async () => {
    const { registryCount, installedCount } = await refresh();
    flash(
      `Refreshed — ${registryCount} in registry, ${installedCount} installed`,
    );
  }, [refresh, flash]);

  useEffect(() => {
    void refresh().finally(() => setInitialLoading(false));
  }, [refresh]);

  // Surface auto-updater state. The main process broadcasts via IPC when it
  // detects/downloads a release. We only act on `downloaded`: nothing else
  // requires user attention (checking/downloading happen silently in the
  // background, "not-available" is the boring common case).
  useEffect(() => {
    if (!window.skillsBank.onUpdateStatus) return;
    return window.skillsBank.onUpdateStatus((status) => {
      if (status.kind === "downloaded") {
        flashWithAction(
          `Update ${status.version} ready — restart to install`,
          "Restart",
          () => void window.skillsBank.quitAndInstallUpdate(),
        );
      } else if (status.kind === "error") {
        // Don't spam users for every transient network blip; log only.
        console.warn("[update] error:", status.message);
      }
    });
  }, [flashWithAction]);

  // Sync status feed: drives the SyncBanner and the Header sync button.
  // When a sync completes with conflicts, auto-open the resolver modal so
  // the user doesn't have to chase the banner.
  useEffect(() => {
    if (!window.skillsBank.onSyncStatus) return;
    return window.skillsBank.onSyncStatus((status) => {
      setSyncStatus(status);
      if (status.kind === "done") {
        setPendingConflicts(status.conflicts);
        if (status.conflicts > 0) {
          void window.skillsBank.getPendingConflicts().then((pending) => {
            if (pending && pending.conflicts.length > 0) {
              setConflictModalEntries(pending.conflicts);
            }
          });
        }
      }
    });
  }, []);

  // Hydrate pendingConflicts from the persisted last-sync report on launch
  // so a banner from a prior run shows immediately, before any new sync.
  useEffect(() => {
    void (async () => {
      const report = await window.skillsBank.getSyncReport();
      if (report) setPendingConflicts(report.conflicts.length);
    })();
  }, []);

  // Initial auth/persona snapshot. The LoginScreen is shown until persona
  // resolves to convenience or power.
  useEffect(() => {
    void (async () => {
      const s = await window.skillsBank.authStatus();
      setAuthStatus(s);
    })();
  }, []);

  // Quick tag editing from card affordances (X to remove, "+ tag" to
  // add). Drawer's full edit flow stays available; this skips it for
  // single-edit speed.
  //
  // Optimistic: paint the new tags into local state before the IPC
  // round-trip + registry rebuild resolves. Background refresh picks
  // up any source/publishState changes (e.g. auto-protect after
  // editing a canonical skill) without blocking the user's next click.
  const saveCardTags = useCallback(
    async (name: string, next: string[]) => {
      setRegistry((prev) =>
        prev.map((e) => (e.name === name ? { ...e, tags: next } : e)),
      );
      const r = await window.skillsBank.editTags(name, next);
      flash(r.message);
      // Refresh in the background either way — on success to pick up
      // source/publishState changes, on failure to roll back the
      // optimistic paint.
      void refresh();
    },
    [flash, refresh],
  );

  const sync = useCallback(async () => {
    const r = await window.skillsBank.syncCanonical();
    flash(r.message);
    await refresh();
  }, [refresh, flash]);

  const openConflictModal = useCallback(async () => {
    const pending = await window.skillsBank.getPendingConflicts();
    if (!pending || pending.conflicts.length === 0) return;
    setConflictModalEntries(pending.conflicts);
  }, []);

  const resolveConflicts = useCallback(
    async (decisions: import("@skills-bank/core").SyncDecisions) => {
      const r = await window.skillsBank.resolveConflicts(decisions);
      flash(r.message);
      setConflictModalEntries(null);
      // The handler re-runs sync; refresh to reflect the new registry state.
      await refresh();
    },
    [flash, refresh],
  );

  const changeRegistry = useCallback(async () => {
    // For power-persona users, the gear opens the GitHub repo picker;
    // they can't pick local folders since their registry is GitHub-sourced.
    // Convenience users get the legacy folder picker — useful for
    // pointing at a custom local clone or the dev-mode override.
    if (authStatus?.persona === "power") {
      setShowRepoPicker(true);
      return;
    }
    const r = await window.skillsBank.setRegistryRoot();
    if (r.ok && r.registryRoot) {
      flash(`Registry set to ${r.registryRoot}`);
      await refresh();
    } else if (r.message !== "cancelled") {
      flash(`Couldn't set registry: ${r.message}`);
    }
  }, [refresh, flash, authStatus]);

  const pickRepo = useCallback(
    async (fullName: string) => {
      const r = await window.skillsBank.reposReplaceRegistry(fullName);
      if (r.ok) {
        flash(r.message);
        setShowRepoPicker(false);
        await refresh();
      } else {
        // Surface as a thrown error so the modal can show it inline.
        throw new Error(r.message);
      }
    },
    [refresh, flash],
  );

  const signOut = useCallback(async () => {
    const s = await window.skillsBank.authLogout();
    setAuthStatus(s);
    setShowRepoPicker(false);
    flash("Signed out");
  }, [flash]);

  const undoUninstall = useCallback(
    (name: string) => {
      void (async () => {
        const r = await window.skillsBank.install(name, false);
        flash(r.message);
        await refresh();
      })();
    },
    [refresh, flash],
  );

  const rebuild = useCallback(async () => {
    setRebuilding(true);
    try {
      const r = await window.skillsBank.rebuildIndex();
      flash(r.message);
      await refresh();
    } finally {
      setRebuilding(false);
    }
  }, [refresh, flash]);

  // Keep the drawer's entry up-to-date if the registry refreshes. Don't
  // close the drawer when no registry entry is found — the selection may
  // be a synthetic entry for a not-yet-registered skill (opened from the
  // Installed tab "Not registered" section), in which case the registry
  // legitimately doesn't have it and we want the drawer to stay open so
  // the user can hit Register or Manage agent links.
  useEffect(() => {
    if (selected) {
      const fresh = registry.find((e) => e.name === selected.name);
      if (fresh && fresh !== selected) setSelected(fresh);
    }
  }, [registry, selected]);

  // Pre-mount splash: render this until the renderer knows which top-
  // level view to show. Without it, the app skeleton flashes for a beat
  // before LoginScreen mounts on first launch.
  if (!authStatus) {
    return <SplashScreen />;
  }

  // Persona unresolved → LoginScreen. Hoisted above the data-skeleton
  // so we never render the app shell for a not-yet-onboarded user.
  if (authStatus.persona === null) {
    return (
      <LoginScreen
        isAuthConfigured={authStatus.isAuthConfigured}
        onStatusChanged={(s) => {
          setAuthStatus(s);
          if (s.persona !== null) void refresh();
        }}
      />
    );
  }

  // Initial loading — skeleton over real chrome.
  if (initialLoading) {
    return (
      <div className="app" aria-busy="true">
        <Header
          refreshing={true}
          onRefresh={() => undefined}
          theme={theme}
          onToggleTheme={toggleTheme}
          density={density}
          onToggleDensity={toggleDensity}
          onChangeRegistry={() => undefined}
          syncing={false}
          onSync={() => undefined}
          showSync={false}
          authStatus={null}
          onSignOut={() => undefined}
          onOpenSettings={() => undefined}
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

  // Config checked, no registry root resolved → show setup.
  if (configChecked && !registryRoot) {
    return (
      <SetupScreen
        onConfigured={async () => {
          await refresh();
        }}
      />
    );
  }

  return (
    <div className="app">
      <Header
        refreshing={refreshing}
        onRefresh={() => void onRefreshClick()}
        theme={theme}
        onToggleTheme={toggleTheme}
        density={density}
        onToggleDensity={toggleDensity}
        onChangeRegistry={() => void changeRegistry()}
        syncing={
          syncStatus.kind === "fetching" || syncStatus.kind === "applying"
        }
        onSync={() => void sync()}
        showSync={authStatus?.persona !== "power"}
        authStatus={authStatus}
        onSignOut={signOut}
        onOpenSettings={() => setShowSettings(true)}
        onOpenKeyboardShortcuts={() => setShowShortcuts(true)}
      />
      <SyncBanner
        status={syncStatus}
        pendingConflicts={pendingConflicts}
        onDismiss={() => setSyncStatus({ kind: "idle" })}
        onResolveConflicts={() => void openConflictModal()}
      />
      <Tabs
        active={tab}
        onChange={setTabPersisted}
        registryCount={registry.length}
        installedCount={uniqueInstalledCount}
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
            installedOnly={installedOnly}
            setInstalledOnly={setInstalledOnly}
            onSelect={(e) => setSelected(e)}
            onSaveTags={saveCardTags}
            onRebuild={rebuild}
            rebuilding={rebuilding}
            searchInputRef={searchInputRef}
          />
        )}
        {tab === "installed" && (
          <InstalledTab
            installed={installed}
            registry={registry}
            onSwitchToBrowse={() => setTabPersisted("browse")}
            onMigrateAll={() => setShowMigrate(true)}
            onMigrateOne={(s) => {
              // Open the unified detail drawer with a synthetic registry
              // entry so the user gets the same Register / Manage-links /
              // Remove action surface as a registered skill — the two
              // operations are now distinct buttons, not a radio group.
              const synthetic: RegistryEntry = registry.find(
                (r) => r.name === s.name,
              ) ?? {
                name: s.name,
                description: s.target ?? s.linkPath,
                path: s.linkPath,
                source: { source: "user" },
              };
              setSelected(synthetic);
            }}
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

      {manageLinksTarget && (
        <ManageLinksModal
          name={manageLinksTarget.name}
          installations={manageLinksTarget.installations}
          onClose={async () => {
            setManageLinksTarget(null);
            await refresh();
          }}
          onFlash={flash}
        />
      )}

      {conflictTarget && (
        <ConflictResolveModal
          name={conflictTarget.name}
          conflicts={conflictTarget.conflicts}
          onClose={async () => {
            setConflictTarget(null);
            await refresh();
          }}
          onFlash={flash}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={saveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showShortcuts && (
        <KeyboardShortcutsOverlay onClose={() => setShowShortcuts(false)} />
      )}

      {conflictModalEntries && (
        <ConflictResolutionModal
          conflicts={conflictModalEntries}
          onClose={() => setConflictModalEntries(null)}
          onResolve={resolveConflicts}
        />
      )}

      {showRepoPicker && (
        <RepoPickerModal
          onClose={() => setShowRepoPicker(false)}
          onPicked={pickRepo}
          onSignOut={signOut}
        />
      )}

      {selected &&
        (() => {
          const isRegistered = registry.some((r) => r.name === selected.name);
          const installations = installed.filter(
            (i) => i.name === selected.name,
          );
          return (
            <SkillDetailDrawer
              entry={selected}
              installed={installed}
              registryRoot={registryRoot}
              isRegistered={isRegistered}
              defaultInstallAgents={
                settings.defaultInstallAgents.length > 0
                  ? settings.defaultInstallAgents
                  : undefined
              }
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
              onManageLinks={() => {
                setManageLinksTarget({
                  name: selected.name,
                  installations,
                });
                setSelected(null);
              }}
              onResolveConflicts={() => {
                const conflicts = installations.filter(
                  (i) => i.kind !== "ours" && i.kind !== "broken-symlink",
                );
                if (conflicts.length === 0) return;
                setConflictTarget({ name: selected.name, conflicts });
                setSelected(null);
              }}
              onRegister={
                isRegistered
                  ? undefined
                  : async () => {
                      const results = await window.skillsBank.migrate([
                        {
                          name: selected.name,
                          action: { type: "adopt", name: selected.name },
                        },
                      ]);
                      const r = results[0]!;
                      flash(r.message);
                      if (r.ok) {
                        void window.skillsBank.rebuildIndex();
                        setSelected(null);
                      }
                      await refresh();
                    }
              }
            />
          );
        })()}

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast.message}</span>
          {toast.action && (
            <button className="toast-action" onClick={toast.action.onClick}>
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
