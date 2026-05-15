import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AgentId,
  ConflictEntry,
  InstalledSkill,
  RegistryEntry,
} from "@skills-bank/core";
import { BrowseTab } from "./components/BrowseTab.js";
import { ConflictResolutionModal } from "./components/ConflictResolutionModal.js";
import {
  InstalledTab,
  type InstalledGroup,
} from "./components/InstalledTab.js";
import { RegisterModal } from "./components/RegisterModal.js";
import { Header, type Density, type Theme } from "./components/Header.js";
import { ConflictResolveModal } from "./components/ConflictResolveModal.js";
import {
  InstallConflictModal,
  type InstallConflictError,
} from "./components/InstallConflictModal.js";
import { classifyDrawerState } from "./components/skillState.js";
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
import { SyncBanner } from "./components/SyncBanner.js";
import { Tabs, type TabId } from "./components/Tabs.js";
import { DiscoverTab } from "./components/DiscoverTab.js";
import { SkillDetailDrawer } from "./components/SkillDetailDrawer.js";
import { DeleteUnregisteredConfirm } from "./components/DeleteUnregisteredConfirm.js";
import { UpdateNotesModal } from "./components/UpdateNotesModal.js";
import { ConnectGithubModal } from "./components/ConnectGithubModal.js";
import { ErrorPanel } from "./components/ErrorPanel.js";
import { AccountModal } from "./components/AccountModal.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { DestinationPickerDialog } from "./components/DestinationPickerDialog.js";
import type { AuthStatus, SyncStatus, UpdateStatus } from "../shared/ipc.js";

const LS_KEYS = {
  search: "skills-bank.searchQuery",
  tagFilter: "skills-bank.tagFilter",
  tab: "skills-bank.activeTab",
  theme: "skills-bank.theme",
  density: "skills-bank.density",
  installedOnly: "skills-bank.installedOnly",
  settings: "skills-bank.settings",
  unregisterHintShown: "skills-bank.unregisterHintShown",
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
  // Persistent error surface. Stacks vertically; each entry is
  // individually dismissable; failures land here (toasts stay for
  // success confirmation only).
  const [appErrors, setAppErrors] = useState<
    Array<{ id: number; error: import("@skills-bank/core").AppError }>
  >([]);
  const appErrorIdRef = useRef(0);
  const pushAppError = (e: import("@skills-bank/core").AppError) => {
    const id = ++appErrorIdRef.current;
    setAppErrors((prev) => [...prev, { id, error: e }]);
  };
  const dismissAppError = (id: number) => {
    setAppErrors((prev) => prev.filter((x) => x.id !== id));
  };
  // Typed string-key reader for AppError.copyableDetails. Returns the
  // value when present and a string; null otherwise.
  const detailString = (
    e: import("@skills-bank/core").AppError,
    key: string,
  ): string | null => {
    const v = e.copyableDetails?.[key];
    return typeof v === "string" ? v : null;
  };
  // Destination-collision recovery surfaces (replacing the previous
  // Settings-redirect + native window.confirm).
  const [pickDestinationTarget, setPickDestinationTarget] = useState<{
    errorId: number;
    name: string;
    currentDestination: AgentId;
  } | null>(null);
  const [overwriteTarget, setOverwriteTarget] = useState<{
    errorId: number;
    name: string;
    destDir: string;
  } | null>(null);
  // Mid-sweep state for the bulk Fix-broken-links flow: after we've
  // tried to repair each skill, the unrepairable subset is shown in a
  // styled ConfirmDialog that asks whether to drop the dead symlinks.
  const [bulkRepairPrompt, setBulkRepairPrompt] = useState<{
    repaired: number;
    unrepairable: Array<{
      name: string;
      entries: Array<{ agent: string; linkPath: string }>;
    }>;
  } | null>(null);
  // Dispatch table for AppError suggestedActions. Each kind maps to a
  // handler that knows the surrounding context (current settings,
  // refresh, toast). The handler can dismiss the originating panel.
  const handleSuggestedAction = async (
    error: import("@skills-bank/core").AppError,
    id: number,
    kind: import("@skills-bank/core").SuggestedActionKind,
  ): Promise<void> => {
    if (kind === "open-unregister-destination-settings") {
      const name = detailString(error, "name");
      const dest =
        (detailString(error, "destination") as AgentId | null) ??
        settings.unregisterDestinationAgent;
      if (!name) {
        flash("Couldn't retry — original target name was lost.");
        return;
      }
      setPickDestinationTarget({
        errorId: id,
        name,
        currentDestination: dest,
      });
      return;
    }
    if (kind === "unregister-force-overwrite") {
      const name = detailString(error, "name");
      const destDir = detailString(error, "destDir") ?? "";
      if (!name) {
        flash("Couldn't retry — original target name was lost.");
        return;
      }
      setOverwriteTarget({ errorId: id, name, destDir });
      return;
    }
  };
  const [showRegister, setShowRegister] = useState(false);
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
    /**
     * False when resolving conflicts for an unregistered skill — hides
     * the "Replace with symlink to registry" action (no registry copy
     * to point at) and switches the default per-installation pick to
     * delete. After this resolution the skill lands in Unregistered;
     * the Register step is separate, preserving level-pure flow.
     */
    allowReplaceWithSymlink: boolean;
  } | null>(null);
  // Surfaced when installSkill fails because something already exists at
  // an agent's link path. The user picks Force / Resolve per-agent /
  // Cancel from a dedicated modal rather than a vague toast.
  const [installConflict, setInstallConflict] = useState<{
    name: string;
    errors: InstallConflictError[];
  } | null>(null);
  // M9b: confirmation target for the inline Delete button on
  // Unregistered cards. Holds the skill name + the installations
  // that would be removed so the modal can preview them.
  const [deleteTarget, setDeleteTarget] = useState<{
    name: string;
    installations: InstalledSkill[];
  } | null>(null);
  // M8: pending merge-import conflicts. When non-null, the sync-style
  // ConflictResolutionModal renders against this list. priorReport
  // carries the partial-progress numbers (imported / kept-mine /
  // renamed) so the post-resolve toast aggregates correctly.
  const [mergeConflictTarget, setMergeConflictTarget] = useState<{
    sourcePath: string;
    conflicts: import("@skills-bank/core").ConflictEntry[];
    priorReport: import("@skills-bank/core").MergeImportReport;
  } | null>(null);
  // Bulk "Resolve all" confirmation list. Each entry's conflicts will
  // be replaced with symlinks to the registry copy. Broken-symlink
  // groups are excluded by the caller because they require source
  // decisions that don't fit a bulk sweep.
  const [resolveAllTarget, setResolveAllTarget] = useState<
    InstalledGroup[] | null
  >(null);
  const [resolveAllRunning, setResolveAllRunning] = useState(false);
  // Per-skill error messages from the most recent bulk Resolve-all
  // attempt. When non-null, the bulk confirm modal stays open and
  // shows these inline so the user can see *why* — replacing the
  // previous "close + vague toast" behavior that hid failure reasons.
  const [resolveAllErrors, setResolveAllErrors] = useState<Record<
    string,
    string[]
  > | null>(null);
  const [settings, setSettingsState] = useState<AppSettings>(readSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showConnectGithub, setShowConnectGithub] = useState(false);
  // Auto-update state. `latestUpdateStatus` is a live mirror of the most
  // recent event the main process broadcast; the modal reads it directly
  // when open, so a render during `downloading` shows the live progress
  // bar without us having to snapshot. `isUpdateModalOpen` is a plain
  // boolean — the modal's content is fully derived from
  // `latestUpdateStatus`. `dismissedUpdateVersion` is hydrated once at
  // boot from config.json and gates the badge for that specific version
  // only; the in-app "Check for app updates" entry bypasses it.
  const [latestUpdateStatus, setLatestUpdateStatus] =
    useState<UpdateStatus | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<
    string | null
  >(null);
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

  // One pass to build name→entry / name→set lookups; reused across the
  // overlay-reconciliation effect, the drawer's freshness sync, and any
  // per-render `.some(byName)` site. Cheap to build, cheaper than ~7
  // O(n) scans per render.
  const registryByName = useMemo(
    () => new Map(registry.map((e) => [e.name, e] as const)),
    [registry],
  );
  const installedNames = useMemo(
    () => new Set(installed.map((i) => i.name)),
    [installed],
  );

  // Tab badge counts — dedupe by skill name so a skill linked into two
  // agent dirs counts once. The toast computed by refresh() uses the
  // same expression; keep them in sync via this single derivation.
  const uniqueInstalledCount = installedNames.size;

  // Overlay reconciliation: if a skill referenced by an open drawer or
  // modal disappears from installed/registry after refresh() (e.g. the
  // user deleted it from the Bank in another flow), drop the stale
  // reference so the overlay closes cleanly. Derived-validation, not
  // derived-state.
  useEffect(() => {
    if (selected && !registryByName.has(selected.name)) {
      setSelected(null);
    }
    if (conflictTarget && !installedNames.has(conflictTarget.name)) {
      setConflictTarget(null);
    }
    if (installConflict && !registryByName.has(installConflict.name)) {
      setInstallConflict(null);
    }
    if (manageLinksTarget && !installedNames.has(manageLinksTarget.name)) {
      setManageLinksTarget(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- overlays are inputs to validate, not deps
  }, [registryByName, installedNames]);

  // Apply the active theme to <html data-theme=""> so CSS-variable
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
    const minSpinner = new Promise<void>((resolve) => setTimeout(resolve, 250));
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
        window.skillsBank.listInstalled(settings.customSkillsDirs),
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
  }, [settings.customSkillsDirs]);

  // Common post-action plumbing for unregister retries: dismiss the
  // originating panel on success, flash, refresh. Failures route the
  // new structured error back through the panel.
  const handleUnregisterResult = useCallback(
    async (
      errorId: number,
      r: Awaited<ReturnType<typeof window.skillsBank.unregister>>,
    ) => {
      if (r.ok) {
        dismissAppError(errorId);
        flash(r.message);
        await refresh();
      } else if (r.error) {
        dismissAppError(errorId);
        pushAppError(r.error);
      } else {
        flash(r.message);
      }
    },
    [flash, refresh],
  );

  const addCustomSkillsDir = useCallback(async () => {
    const r = await window.skillsBank.pickCustomSkillsDir();
    if (!r.ok || !r.path) return; // user canceled
    const chosen = r.path;
    if (settings.customSkillsDirs.includes(chosen)) {
      setToast({ message: "That directory is already in the scan list." });
      return;
    }
    saveSettings({
      ...settings,
      customSkillsDirs: [...settings.customSkillsDirs, chosen],
    });
    void refresh();
  }, [settings, saveSettings, refresh]);

  const removeCustomSkillsDir = useCallback(
    (path: string) => {
      saveSettings({
        ...settings,
        customSkillsDirs: settings.customSkillsDirs.filter((p) => p !== path),
      });
      void refresh();
    },
    [settings, saveSettings, refresh],
  );

  const onRefreshClick = useCallback(async () => {
    const { registryCount, installedCount } = await refresh();
    flash(
      `Refreshed — ${registryCount} in registry, ${installedCount} installed`,
    );
  }, [refresh, flash]);

  useEffect(() => {
    void refresh().finally(() => setInitialLoading(false));
  }, [refresh]);

  // Hydrate the user's "Skip this version" choice once at boot. The main
  // process is the source of truth (persisted alongside registryRoot/persona
  // in config.json), so this is fire-and-forget.
  useEffect(() => {
    void window.skillsBank.getConfig().then((cfg) => {
      setDismissedUpdateVersion(cfg.dismissedUpdateVersion);
    });
  }, []);

  // Mirror every auto-updater event into local state. The boot-time check
  // only surfaces the badge; no modal auto-open — the user explicitly
  // opens it from the badge or the in-app Settings dropdown. Errors are
  // logged but not surfaced (transient network blips happen).
  useEffect(() => {
    if (!window.skillsBank.onUpdateStatus) return;
    return window.skillsBank.onUpdateStatus((status) => {
      setLatestUpdateStatus(status);
      if (status.kind === "error") {
        console.warn("[update] error:", status.message);
      }
    });
  }, []);

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

  // Change linked repo is universal — always opens RepoPicker.
  // The folder-picker path (Import a registry from disk) is a separate
  // Operations action; see `importRegistryFromDisk` below.
  const changeRegistry = useCallback(async () => {
    setShowRepoPicker(true);
  }, []);

  // Folder-picker replace path. Bundled-default and custom-repo users
  // alike can swap their registry root for a local folder this way —
  // it's no longer mode-gated.
  const importRegistryFromDisk = useCallback(async () => {
    const r = await window.skillsBank.importRegistry();
    if (r.ok && r.registryRoot) {
      flash(r.message);
      await refresh();
    } else if (r.message !== "cancelled") {
      flash(`Couldn't import registry: ${r.message}`);
    }
  }, [refresh, flash]);

  // Re-fetch from the currently linked GitHub repo, no picker.
  const refreshLinkedRepo = useCallback(async () => {
    const r = await window.skillsBank.reposRefreshCurrent();
    if (r.ok) {
      flash(r.message);
      const next = await window.skillsBank.authStatus();
      setAuthStatus(next);
      await refresh();
    } else {
      flash(r.message);
    }
  }, [refresh, flash]);

  // M8: additive import. Pops a folder picker, runs the merge,
  // surfaces collisions through the sync-conflict modal. Default
  // decision per the taxonomy plan is keep-mine (handled inside the
  // modal).
  const mergeRegistry = useCallback(async () => {
    const r = await window.skillsBank.importRegistryMerge();
    if (!r.ok) {
      if (r.message !== "cancelled") {
        flash(`Couldn't merge: ${r.message}`);
      }
      return;
    }
    if (r.report.conflicts.length === 0) {
      flash(r.message);
      await refresh();
      return;
    }
    setMergeConflictTarget({
      sourcePath: r.sourcePath,
      conflicts: r.report.conflicts,
      priorReport: r.report,
    });
  }, [flash, refresh]);

  const exportRegistry = useCallback(async () => {
    const r = await window.skillsBank.exportRegistry();
    if (!r.ok && r.message !== "export cancelled") {
      flash(`Export failed: ${r.message}`);
    } else if (r.ok) {
      flash(r.message);
    }
  }, [flash]);

  const pickRepo = useCallback(
    async (fullName: string) => {
      const r = await window.skillsBank.reposReplaceRegistry(fullName);
      if (r.ok) {
        flash(r.message);
        setShowRepoPicker(false);
        const next = await window.skillsBank.authStatus();
        setAuthStatus(next);
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

  // Convenience: "Check for updates" routes through the same path
  // regardless of trigger — re-open the existing update modal if a
  // live update is known, otherwise kick off a fresh check.
  const checkForUpdates = useCallback(() => {
    if (
      latestUpdateStatus &&
      (latestUpdateStatus.kind === "available" ||
        latestUpdateStatus.kind === "downloading" ||
        latestUpdateStatus.kind === "downloaded")
    ) {
      setIsUpdateModalOpen(true);
    } else {
      void window.skillsBank.checkForUpdates().then((r) => {
        flash(r.ok ? "Checking for updates" : r.message);
      });
    }
  }, [latestUpdateStatus, flash]);

  // macOS menu-bar dispatch. The native menubar still fires a small
  // set of actions (Settings, Refresh, Sync skills) — the in-app
  // header dropdown is gone, but the menubar stays. Filter to the
  // actions the menubar actually dispatches; ignore the rest.
  useEffect(() => {
    if (!window.skillsBank.onHeaderMenuAction) return;
    return window.skillsBank.onHeaderMenuAction((action) => {
      switch (action) {
        case "openSettings":
          setShowSettings(true);
          break;
        case "openShortcuts":
          setShowShortcuts(true);
          break;
        case "refresh":
          void onRefreshClick();
          break;
        case "sync":
          void sync();
          break;
        case "checkForUpdates":
          checkForUpdates();
          break;
        // Other actions (changeRegistry, mergeRegistry, exportRegistry,
        // signOut, githubLinkComingSoon) are no longer dispatched from
        // any surface — the in-app dropdown that fired them is gone
        // and the menubar doesn't include them. Kept in the union for
        // back-compat with the IPC shape; the cases are unreachable.
      }
    });
  }, [onRefreshClick, sync, checkForUpdates]);

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
      const fresh = registryByName.get(selected.name);
      if (fresh && fresh !== selected) setSelected(fresh);
    }
  }, [registryByName, selected]);

  // Pre-mount splash: render this until the renderer knows which top-
  // level view to show. Without it, the app skeleton flashes for a beat
  // before LoginScreen mounts on first launch.
  if (!authStatus) {
    return <SplashScreen />;
  }

  // Registry source unresolved → LoginScreen. Hoisted above the
  // data-skeleton so we never render the app shell for a not-yet-
  // onboarded user.
  if (authStatus.registrySource === null) {
    return (
      <LoginScreen
        isAuthConfigured={authStatus.isAuthConfigured}
        onStatusChanged={async (s) => {
          setAuthStatus(s);
          // Plan 02 structural fix: authPollDeviceFlow no longer eagerly
          // flips registrySource to "github". If Device Flow just
          // completed (s.user populated, registrySource still null),
          // park the user in local-bundled and pop RepoPicker so they
          // can finish linking. Cancelling RepoPicker lands them in
          // local-bundled with a useful cached token — no orphaned state.
          if (s.registrySource === null && s.user) {
            const local = await window.skillsBank.authSetRegistrySourceLocal();
            setAuthStatus(local);
            setShowRepoPicker(true);
            void refresh();
          } else if (s.registrySource !== null) {
            void refresh();
          }
        }}
      />
    );
  }

  // Surface an app-update badge next to the brand whenever the main
  // process has told us about a release in any of the three active
  // phases (available / downloading / downloaded) that the user hasn't
  // actively skipped. `dismissedUpdateVersion` is per-version so a
  // newer-newer release reappears.
  const isLiveUpdate =
    latestUpdateStatus &&
    (latestUpdateStatus.kind === "available" ||
      latestUpdateStatus.kind === "downloading" ||
      latestUpdateStatus.kind === "downloaded");
  const pendingUpdateVersion: string | null =
    isLiveUpdate && latestUpdateStatus.version !== dismissedUpdateVersion
      ? latestUpdateStatus.version
      : null;

  // Plain functions (not useCallback) — this code lives below early-return
  // gates above (no authStatus, persona unresolved). A hook here would be a
  // Rules-of-Hooks violation. None of the consumers memoize, so referential
  // stability isn't load-bearing.
  const openUpdateModal = () => {
    if (isLiveUpdate) setIsUpdateModalOpen(true);
  };

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
          syncing={false}
          onSync={() => undefined}
          authStatus={null}
          onOpenAccount={() => undefined}
          onOpenSettings={() => undefined}
          pendingUpdateVersion={null}
          onShowUpdate={() => undefined}
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

  return (
    <div className="app">
        <Header
          refreshing={refreshing}
          onRefresh={() => void onRefreshClick()}
          theme={theme}
          onToggleTheme={toggleTheme}
          density={density}
          onToggleDensity={toggleDensity}
          syncing={
            syncStatus.kind === "fetching" || syncStatus.kind === "applying"
          }
          onSync={() => void refreshLinkedRepo()}
          authStatus={authStatus}
          onOpenAccount={() => setShowAccount(true)}
          onOpenSettings={() => setShowSettings(true)}
          pendingUpdateVersion={pendingUpdateVersion}
          onShowUpdate={openUpdateModal}
        />
        {appErrors.length > 0 && (
          <div className="error-panel-stack">
            {appErrors.map(({ id, error }) => (
              <ErrorPanel
                key={id}
                error={error}
                onDismiss={() => dismissAppError(id)}
                onSuggestedAction={(kind) =>
                  handleSuggestedAction(error, id, kind)
                }
              />
            ))}
          </div>
        )}
        <SyncBanner
          status={syncStatus}
          pendingConflicts={pendingConflicts}
          onDismiss={() => setSyncStatus({ kind: "idle" })}
          onResolveConflicts={() => void openConflictModal()}
          onResetPending={() => {
            void (async () => {
              const r = await window.skillsBank.clearPendingConflicts();
              flash(r.message);
              setPendingConflicts(0);
              await refresh();
            })();
          }}
        />
        <Tabs
          active={tab}
          onChange={setTabPersisted}
          registryCount={registry.length}
          installedCount={uniqueInstalledCount}
        />
        {tab === "discover" ? (
          <DiscoverTab
            modalOpen={
              showRegister ||
              !!manageLinksTarget ||
              !!conflictTarget ||
              !!deleteTarget ||
              !!mergeConflictTarget ||
              showSettings ||
              showShortcuts ||
              showAccount ||
              showConnectGithub ||
              !!conflictModalEntries ||
              showRepoPicker ||
              !!pickDestinationTarget ||
              !!overwriteTarget ||
              !!bulkRepairPrompt ||
              !!selected
            }
            terminalApp={settings.terminalApp}
          />
        ) : (
          <div
            className="content"
            role="tabpanel"
            id={`tabpanel-${tab}`}
            aria-labelledby={`tab-${tab}`}
          >
            {tab === "browse" && (
              <BrowseTab
                // M5: filter hidden canon entries from the default
                // Browse view. They remain in `registry` for lookups,
                // installations, and the Settings → Hidden canon
                // skills section.
                registry={registry.filter((e) => !e.hidden)}
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
                customSkillsDirs={settings.customSkillsDirs}
                onAddCustomSkillsDir={addCustomSkillsDir}
                onRemoveCustomSkillsDir={removeCustomSkillsDir}
                onSwitchToBrowse={() => setTabPersisted("browse")}
                onRegisterAll={() => setShowRegister(true)}
                onRegisterOne={(s) => {
                  // Open the unified detail drawer with a synthetic registry
                  // entry so the user gets the same Register / Manage-links /
                  // Remove action surface as a registered skill — the two
                  // operations are now distinct buttons, not a radio group.
                  const synthetic: RegistryEntry = registryByName.get(
                    s.name,
                  ) ?? {
                    name: s.name,
                    description: s.target ?? s.linkPath,
                    path: s.linkPath,
                    source: { source: "yours" },
                  };
                  setSelected(synthetic);
                }}
                onSelectIntegrated={(e) => setSelected(e)}
                onResolveConflicts={(g) => {
                  // Level routing: a registered skill resolves via the
                  // replace/delete/keep flow; an unregistered skill
                  // (multi-install) resolves via delete/keep ONLY so the
                  // act of resolving doesn't also register (level pollution).
                  // Broken installations are excluded for registered (they
                  // have a dedicated Repair flow) but included for
                  // unregistered (the user picks a canonical and removes
                  // dead siblings in the same pass).
                  const isRegistered = registryByName.has(g.name);
                  const conflicts = isRegistered
                    ? g.conflicts.filter(
                        (c) => c.kind !== "ours" && c.kind !== "broken-symlink",
                      )
                    : g.conflicts.filter((c) => c.kind !== "ours");
                  setConflictTarget({
                    name: g.name,
                    conflicts,
                    allowReplaceWithSymlink: isRegistered,
                  });
                }}
                onResolveAllConflicts={(gs) => setResolveAllTarget(gs)}
                onRepairAllBroken={async (gs) => {
                  // Bulk Fix-broken-link(s) sweep. Mirrors the
                  // drawer-level onRepairBroken behavior: try repair
                  // first; for skills whose links can't be repaired
                  // (registry copy is gone), prompt to remove the
                  // dead symlinks across all affected skills in a
                  // single confirm.
                  type Unrepairable = {
                    name: string;
                    entries: Array<{ agent: string; linkPath: string }>;
                  };
                  const unrepairableBySkill: Unrepairable[] = [];
                  let repaired = 0;
                  for (const g of gs) {
                    const report = await window.skillsBank.repairBrokenLinks(
                      g.name,
                    );
                    if (report.unrepairable.length > 0) {
                      unrepairableBySkill.push({
                        name: g.name,
                        entries: report.unrepairable.map((e) => ({
                          agent: e.agent,
                          linkPath: e.linkPath,
                        })),
                      });
                    } else {
                      repaired += 1;
                    }
                  }
                  await refresh();

                  if (unrepairableBySkill.length === 0) {
                    flash(
                      `Repaired ${repaired} skill${repaired === 1 ? "" : "s"}.`,
                    );
                    return;
                  }

                  // Hand off to the styled ConfirmDialog. The dialog's
                  // onConfirm runs the removal sweep; cancel surfaces a
                  // partial-success toast.
                  setBulkRepairPrompt({
                    repaired,
                    unrepairable: unrepairableBySkill,
                  });
                }}
                onInlineDelete={(group) => {
                  // M9b: stash the group on deleteTarget so the
                  // confirmation modal can preview which paths get
                  // touched. Actual deletion fires only after the
                  // user confirms.
                  const mine = installed.filter((i) => i.name === group.name);
                  setDeleteTarget({ name: group.name, installations: mine });
                }}
                onInlineRegister={(group) => {
                  // Unregistered-section shortcut. Registers the only
                  // installation into the registry — same operation the
                  // drawer's onRegister performs. Single-installation is
                  // guaranteed by the partition (multi-install lives in
                  // Needs attention), so there is no "which copy" ambiguity.
                  // adopt-vs-symlink mode follows the global setting.
                  void (async () => {
                    const results = await window.skillsBank.register([
                      {
                        name: group.name,
                        action: {
                          type: "register",
                          name: group.name,
                          adopt: settings.registerAdopts,
                        },
                      },
                    ]);
                    const r = results[0]!;
                    flash(r.message);
                    await refresh();
                  })();
                }}
                onRepairBroken={(g) => {
                  void (async () => {
                    const report = await window.skillsBank.repairBrokenLinks(
                      g.name,
                    );
                    if (report.unrepairable.length === 0) {
                      flash(
                        report.repaired.length > 0
                          ? `Repaired ${report.repaired.length} broken link(s) for ${g.name}`
                          : `No broken links for ${g.name}`,
                      );
                      await refresh();
                      return;
                    }
                    // Route through the same ConfirmDialog the bulk
                    // sweep uses so the per-card and bulk flows look
                    // identical. The dialog's onConfirm calls
                    // removeBrokenLinks for each entry; onCancel
                    // surfaces a "left unresolved" toast.
                    await refresh();
                    setBulkRepairPrompt({
                      repaired: report.repaired.length > 0 ? 1 : 0,
                      unrepairable: [
                        {
                          name: g.name,
                          entries: report.unrepairable.map((e) => ({
                            agent: e.agent,
                            linkPath: e.linkPath,
                          })),
                        },
                      ],
                    });
                  })();
                }}
              />
            )}
          </div>
        )}

        {showRegister && (
          <RegisterModal
            onClose={async () => {
              setShowRegister(false);
              await refresh();
            }}
            onFlash={flash}
            registerAdopts={settings.registerAdopts}
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
            allowReplaceWithSymlink={conflictTarget.allowReplaceWithSymlink}
            onClose={async () => {
              setConflictTarget(null);
              await refresh();
            }}
            onFlash={flash}
          />
        )}

        {resolveAllTarget && (
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: "fixed",
              inset: 0,
              background: "var(--scrim)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1100,
            }}
          >
            <div
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border-hi)",
                borderRadius: 8,
                padding: 24,
                width: 520,
                maxWidth: "90vw",
              }}
            >
              <h3 style={{ marginTop: 0 }}>
                Resolve all conflicts ({resolveAllTarget.length})?
              </h3>
              <p style={{ color: "var(--text-2)", fontSize: 13 }}>
                For each skill below, every duplicate or stale agent-dir entry
                will be replaced with a symlink to the Skills Bank copy. This is
                the same as picking "Replace with symlink" for each conflict.
              </p>
              <ul
                style={{
                  margin: "8px 0 12px",
                  padding: "8px 12px",
                  background: "var(--surface-hi)",
                  borderRadius: 4,
                  fontSize: 12,
                  color: "var(--text-2)",
                  listStyle: "none",
                  maxHeight: 200,
                  overflowY: "auto",
                }}
              >
                {resolveAllTarget.map((g) => {
                  const skillErrors = resolveAllErrors?.[g.name];
                  return (
                    <li key={g.name} style={{ padding: "3px 0" }}>
                      <code
                        style={{
                          fontFamily: "var(--font-mono)",
                          color: skillErrors
                            ? "var(--danger, #d04444)"
                            : "var(--text-1)",
                        }}
                      >
                        {g.name}
                      </code>{" "}
                      <span style={{ color: "var(--text-3)" }}>
                        — {g.conflicts.length} conflict
                        {g.conflicts.length === 1 ? "" : "s"}
                      </span>
                      {skillErrors && (
                        <ul
                          style={{
                            margin: "4px 0 0 12px",
                            padding: 0,
                            listStyle: "none",
                            color: "var(--danger, #d04444)",
                            fontSize: 11,
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {skillErrors.map((m, i) => (
                            <li key={i} style={{ padding: "1px 0" }}>
                              · {m}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 8,
                }}
              >
                <button
                  className="btn"
                  onClick={() => {
                    setResolveAllTarget(null);
                    setResolveAllErrors(null);
                  }}
                  disabled={resolveAllRunning}
                >
                  Cancel
                </button>
                <button
                  className="btn warn"
                  disabled={resolveAllRunning}
                  onClick={() => {
                    void (async () => {
                      setResolveAllRunning(true);
                      setResolveAllErrors(null);
                      let okCount = 0;
                      let failCount = 0;
                      const errs: Record<string, string[]> = {};
                      for (const g of resolveAllTarget) {
                        const decisions = g.conflicts.map((c) => ({
                          agent: c.agent,
                          action: "replace-with-symlink" as const,
                        }));
                        try {
                          const r =
                            await window.skillsBank.resolveSkillConflicts(
                              g.name,
                              decisions,
                            );
                          okCount += r.applied.length;
                          failCount += r.errors.length;
                          if (r.errors.length > 0) {
                            errs[g.name] = r.errors.map(
                              (e) => `${e.agent}: ${e.message}`,
                            );
                          }
                        } catch (err) {
                          failCount += 1;
                          errs[g.name] = [(err as Error).message];
                        }
                      }
                      setResolveAllRunning(false);
                      if (failCount === 0) {
                        // Total success — close, toast, and refresh.
                        setResolveAllTarget(null);
                        flash(
                          `Resolved ${okCount} conflict${okCount === 1 ? "" : "s"} across ${resolveAllTarget.length} skill${resolveAllTarget.length === 1 ? "" : "s"}.`,
                        );
                        await refresh();
                      } else {
                        // Keep the modal open so per-skill errors stay
                        // visible. The user can dismiss explicitly via
                        // Cancel or hit Retry after addressing the
                        // underlying issue (e.g. registry copy missing).
                        setResolveAllErrors(errs);
                        flash(
                          okCount === 0
                            ? `Couldn't resolve ${failCount} conflict${failCount === 1 ? "" : "s"} (see details)`
                            : `Resolved ${okCount}; ${failCount} failed (see details)`,
                        );
                        await refresh();
                      }
                    })();
                  }}
                >
                  {resolveAllRunning ? (
                    <>
                      <span className="spinner inline" /> Resolving
                    </>
                  ) : resolveAllErrors ? (
                    "Retry"
                  ) : (
                    `Resolve ${resolveAllTarget.length} skill${resolveAllTarget.length === 1 ? "" : "s"}`
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {installConflict && (
          <InstallConflictModal
            name={installConflict.name}
            errors={installConflict.errors}
            onClose={() => setInstallConflict(null)}
            onForce={async () => {
              const r = await window.skillsBank.install(
                installConflict.name,
                true,
              );
              flash(r.message);
              setInstallConflict(null);
              await refresh();
            }}
            onResolve={() => {
              // Hand off to ConflictResolveModal using the current
              // installed snapshot for the same name. The user picks
              // per-agent actions there.
              const conflicts = installed.filter(
                (i) =>
                  i.name === installConflict.name &&
                  i.kind !== "ours" &&
                  i.kind !== "broken-symlink",
              );
              // Force-install conflicts only occur for registered skills
              // (force-install is a registered-level action), so the
              // resolution always allows the symlink-to-registry path.
              setConflictTarget({
                name: installConflict.name,
                conflicts,
                allowReplaceWithSymlink: true,
              });
              setInstallConflict(null);
            }}
          />
        )}

        {mergeConflictTarget && (
          <ConflictResolutionModal
            conflicts={mergeConflictTarget.conflicts}
            onClose={() => {
              const prior = mergeConflictTarget.priorReport;
              setMergeConflictTarget(null);
              const parts: string[] = [];
              if (prior.imported.length > 0)
                parts.push(`${prior.imported.length} imported`);
              if (prior.renamed.length > 0)
                parts.push(`${prior.renamed.length} renamed`);
              if (prior.keptMine.length > 0)
                parts.push(`${prior.keptMine.length} kept yours`);
              flash(
                `Merge cancelled${parts.length > 0 ? ` (${parts.join(", ")})` : ""}.`,
              );
              void refresh();
            }}
            onResolve={async (decisions) => {
              const target = mergeConflictTarget;
              setMergeConflictTarget(null);
              const r = await window.skillsBank.importRegistryMergeApply(
                target.sourcePath,
                decisions,
              );
              flash(r.message);
              await refresh();
            }}
          />
        )}

        {deleteTarget && (
          <DeleteUnregisteredConfirm
            name={deleteTarget.name}
            installations={deleteTarget.installations}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={async () => {
              const target = deleteTarget;
              setDeleteTarget(null);
              const r = await window.skillsBank.deleteUnregistered(target.name);
              flash(r.message);
              await refresh();
            }}
          />
        )}

        {showSettings && (
          <SettingsModal
            settings={settings}
            onSave={saveSettings}
            onClose={() => setShowSettings(false)}
            hiddenCanon={registry.filter((e) => e.hidden).map((e) => e.name)}
            onUnhide={async (name) => {
              const r = await window.skillsBank.unhide(name);
              flash(r.message);
              await refresh();
            }}
          />
        )}

        {showShortcuts && (
          <KeyboardShortcutsOverlay onClose={() => setShowShortcuts(false)} />
        )}

        {showAccount && (
          <AccountModal
            authStatus={authStatus}
            appVersion={"dev"}
            onClose={() => setShowAccount(false)}
            onChangeRegistry={async () => {
              setShowAccount(false);
              await changeRegistry();
            }}
            onRefreshRegistry={async () => {
              setShowAccount(false);
              await refreshLinkedRepo();
            }}
            onImportRegistry={async () => {
              setShowAccount(false);
              await importRegistryFromDisk();
            }}
            onMergeRegistry={async () => {
              setShowAccount(false);
              await mergeRegistry();
            }}
            onExportRegistry={async () => {
              setShowAccount(false);
              await exportRegistry();
            }}
            onSignOut={async () => {
              setShowAccount(false);
              await signOut();
            }}
            onCheckForUpdates={checkForUpdates}
            onConnectGithub={() => {
              setShowAccount(false);
              setShowConnectGithub(true);
            }}
          />
        )}

        {showConnectGithub && authStatus && (
          <ConnectGithubModal
            isAuthConfigured={authStatus.isAuthConfigured}
            onClose={() => setShowConnectGithub(false)}
            onConnected={(status) => {
              setShowConnectGithub(false);
              setAuthStatus(status);
              // Identity update only — `linkedRepo` is preserved. Users
              // already past onboarding don't need to re-pick a repo
              // just because they signed back in; the explicit "Change
              // linked repo" action covers that intent. The first-launch
              // path (where RepoPicker should pop) goes through
              // LoginScreen's onStatusChanged, not this handler.
              void refresh();
            }}
          />
        )}

        <DestinationPickerDialog
          open={pickDestinationTarget !== null}
          skillName={pickDestinationTarget?.name ?? ""}
          currentDestination={
            pickDestinationTarget?.currentDestination ??
            settings.unregisterDestinationAgent
          }
          onCancel={() => setPickDestinationTarget(null)}
          onPick={async (next, persistAsDefault) => {
            if (!pickDestinationTarget) return;
            const target = pickDestinationTarget;
            setPickDestinationTarget(null);
            if (persistAsDefault) {
              saveSettings({
                ...settings,
                unregisterDestinationAgent: next,
              });
            }
            const r = await window.skillsBank.unregister(target.name, next);
            await handleUnregisterResult(target.errorId, r);
          }}
        />

        <ConfirmDialog
          open={overwriteTarget !== null}
          title={`Overwrite existing folder?`}
          body={
            <>
              <p style={{ margin: 0 }}>
                A folder already exists at{" "}
                <code>{overwriteTarget?.destDir}</code>. Continuing will
                permanently delete it and move{" "}
                <code>{overwriteTarget?.name}</code> in its place.
              </p>
              <p
                style={{
                  marginTop: 10,
                  marginBottom: 0,
                  fontSize: 12,
                  color: "var(--text-3)",
                }}
              >
                This cannot be undone.
              </p>
            </>
          }
          confirmLabel="Overwrite and unregister"
          tone="danger"
          onCancel={() => setOverwriteTarget(null)}
          onConfirm={async () => {
            if (!overwriteTarget) return;
            const target = overwriteTarget;
            setOverwriteTarget(null);
            const r = await window.skillsBank.unregister(
              target.name,
              settings.unregisterDestinationAgent,
              true,
            );
            await handleUnregisterResult(target.errorId, r);
          }}
        />

        <ConfirmDialog
          open={bulkRepairPrompt !== null}
          title="Remove dead symlinks?"
          body={(() => {
            if (!bulkRepairPrompt) return null;
            const { repaired, unrepairable } = bulkRepairPrompt;
            const totalLinks = unrepairable.reduce(
              (acc, u) => acc + u.entries.length,
              0,
            );
            return (
              <>
                <p style={{ margin: 0 }}>
                  Repaired {repaired} skill{repaired === 1 ? "" : "s"}.{" "}
                  {unrepairable.length} skill
                  {unrepairable.length === 1 ? "" : "s"} couldn't be repaired
                  because the registry copy is gone.
                </p>
                <p
                  style={{
                    margin: "10px 0 6px 0",
                    fontSize: 12,
                    color: "var(--text-3)",
                  }}
                >
                  Remove the {totalLinks} dead symlink
                  {totalLinks === 1 ? "" : "s"}? The agent dirs lose the
                  symlink. Because the registry copy is already gone, these
                  skills will also disappear from the registry — there are no
                  source files left to back them.
                </p>
                <ul
                  style={{
                    margin: "8px 0 0 0",
                    paddingLeft: 18,
                    fontSize: 12,
                    color: "var(--text-2)",
                    maxHeight: 160,
                    overflowY: "auto",
                  }}
                >
                  {unrepairable.map((u) => (
                    <li key={u.name}>
                      <strong>{u.name}</strong> ({u.entries.length} link
                      {u.entries.length === 1 ? "" : "s"})
                    </li>
                  ))}
                </ul>
              </>
            );
          })()}
          confirmLabel="Remove dead links"
          tone="danger"
          onCancel={() => {
            if (!bulkRepairPrompt) return;
            const { repaired, unrepairable } = bulkRepairPrompt;
            setBulkRepairPrompt(null);
            flash(
              `Repaired ${repaired}; ${unrepairable.length} left unresolved.`,
            );
          }}
          onConfirm={async () => {
            if (!bulkRepairPrompt) return;
            const { repaired, unrepairable } = bulkRepairPrompt;
            setBulkRepairPrompt(null);
            const results = await Promise.allSettled(
              unrepairable.map((u) =>
                window.skillsBank
                  .removeBrokenLinks(
                    u.name,
                    u.entries.map((e) => e.agent) as AgentId[],
                  )
                  .then(() => u.name),
              ),
            );
            let removed = 0;
            results.forEach((r, i) => {
              if (r.status === "fulfilled") {
                removed += 1;
              } else {
                const name = unrepairable[i]!.name;
                pushAppError({
                  code: "remove-broken.threw",
                  message: `${name}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
                  copyableDetails: { name },
                });
              }
            });
            await refresh();
            flash(
              `Repaired ${repaired}; removed dead links and dropped ${removed} unbacked registry entr${
                removed === 1 ? "y" : "ies"
              }.`,
            );
          }}
        />

        {isUpdateModalOpen &&
          latestUpdateStatus &&
          (latestUpdateStatus.kind === "available" ||
            latestUpdateStatus.kind === "downloading" ||
            latestUpdateStatus.kind === "downloaded") && (
            <UpdateNotesModal
              status={latestUpdateStatus}
              onClose={() => setIsUpdateModalOpen(false)}
              onSkip={(version) => {
                setDismissedUpdateVersion(version);
                void window.skillsBank.setDismissedUpdateVersion(version);
                setIsUpdateModalOpen(false);
              }}
              onDownload={() => {
                void window.skillsBank.downloadUpdate().then((r) => {
                  if (!r.ok) flash(r.message);
                });
              }}
              onRestart={() => {
                setIsUpdateModalOpen(false);
                void window.skillsBank.quitAndInstallUpdate();
              }}
            />
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
            const isRegistered = registryByName.has(selected.name);
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
                onInstallConflict={(payload) => setInstallConflict(payload)}
                onManageLinks={() => {
                  setManageLinksTarget({
                    name: selected.name,
                    installations,
                  });
                  setSelected(null);
                }}
                onResolveConflicts={() => {
                  // Same level-pure routing as the InstalledTab path:
                  // unregistered skills get delete/keep only, including
                  // broken stragglers; registered skills get the full
                  // three-action picker excluding broken (Repair handles those).
                  const isRegistered = registryByName.has(selected.name);
                  const conflicts = isRegistered
                    ? installations.filter(
                        (i) => i.kind !== "ours" && i.kind !== "broken-symlink",
                      )
                    : installations.filter((i) => i.kind !== "ours");
                  if (conflicts.length === 0) return;
                  setConflictTarget({
                    name: selected.name,
                    conflicts,
                    allowReplaceWithSymlink: isRegistered,
                  });
                  setSelected(null);
                }}
                onRegister={
                  // Only wire the callback when the classifier says the
                  // state is actually registerable — covers the
                  // unregistered-broken edge case where there's no
                  // usable source on disk and Register would fail with
                  // a confusing error. Whether files move into the
                  // bank or stay at origin follows the global
                  // `registerAdopts` setting (M3 unified the two
                  // paths into a single op).
                  classifyDrawerState(selected, installed, isRegistered)
                    .capabilities.canRegister
                    ? async () => {
                        const results = await window.skillsBank.register([
                          {
                            name: selected.name,
                            action: {
                              type: "register",
                              name: selected.name,
                              adopt: settings.registerAdopts,
                            },
                          },
                        ]);
                        const r = results[0]!;
                        flash(r.message);
                        if (r.ok) {
                          setSelected(null);
                        }
                        await refresh();
                      }
                    : undefined
                }
                onAcceptDrift={
                  classifyDrawerState(selected, installed, isRegistered)
                    .capabilities.canAcceptDrift
                    ? async () => {
                        const r = await window.skillsBank.acceptDrift(
                          selected.name,
                        );
                        flash(r.message);
                        if (r.ok) {
                          setSelected(null);
                        }
                        await refresh();
                      }
                    : undefined
                }
                onTakeCanonical={
                  classifyDrawerState(selected, installed, isRegistered)
                    .capabilities.canTakeCanonical
                    ? async () => {
                        const r = await window.skillsBank.takeCanonical(
                          selected.name,
                        );
                        flash(r.message);
                        if (r.ok) {
                          setSelected(null);
                        }
                        await refresh();
                      }
                    : undefined
                }
                onForgetMissing={
                  classifyDrawerState(selected, installed, isRegistered)
                    .capabilities.canForgetMissing
                    ? async () => {
                        const r = await window.skillsBank.forgetMissing(
                          selected.name,
                        );
                        flash(r.message);
                        if (r.ok) {
                          setSelected(null);
                        }
                        await refresh();
                      }
                    : undefined
                }
                onRepoint={
                  classifyDrawerState(selected, installed, isRegistered)
                    .capabilities.canRepoint
                    ? async () => {
                        const r = await window.skillsBank.repointExternal(
                          selected.name,
                        );
                        if (r.message !== "cancelled") {
                          flash(r.message);
                        }
                        if (r.ok) {
                          await refresh();
                        }
                      }
                    : undefined
                }
                onHide={
                  classifyDrawerState(selected, installed, isRegistered)
                    .capabilities.canHide
                    ? async () => {
                        const r = await window.skillsBank.hide(selected.name);
                        flash(r.message);
                        if (r.ok) {
                          setSelected(null);
                        }
                        await refresh();
                      }
                    : undefined
                }
                onUnhide={
                  classifyDrawerState(selected, installed, isRegistered)
                    .capabilities.canUnhide
                    ? async () => {
                        const r = await window.skillsBank.unhide(selected.name);
                        flash(r.message);
                        if (r.ok) {
                          setSelected(null);
                        }
                        await refresh();
                      }
                    : undefined
                }
                onUnregister={
                  classifyDrawerState(selected, installed, isRegistered)
                    .capabilities.canUnregister
                    ? async () => {
                        // Remove-from-registry is a terminating action
                        // for this surface — close the drawer up-front
                        // so the result (toast or ErrorPanel) is the
                        // only thing the user has to read.
                        const name = selected.name;
                        setSelected(null);
                        const r = await window.skillsBank.unregister(
                          name,
                          settings.unregisterDestinationAgent,
                        );
                        if (r.ok && r.wasAdopted) {
                          // First-run hint about the destination setting.
                          // Surface once per machine — subsequent
                          // unregistrations just toast the move.
                          const hinted =
                            localStorage.getItem(
                              LS_KEYS.unregisterHintShown,
                            ) === "1";
                          if (!hinted) {
                            flash(
                              `${r.message} — change the destination in Settings → Unregister destination.`,
                            );
                            try {
                              localStorage.setItem(
                                LS_KEYS.unregisterHintShown,
                                "1",
                              );
                            } catch {
                              // ignore
                            }
                          } else {
                            flash(r.message);
                          }
                        } else if (r.error) {
                          // Structured failure — route to the
                          // persistent ErrorPanel so the user can
                          // see details, copy, and (Bundle C) act on
                          // a suggestedAction.
                          pushAppError(r.error);
                        } else {
                          flash(r.message);
                        }
                        if (r.ok) {
                        }
                        await refresh();
                      }
                    : undefined
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
