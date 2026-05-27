import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentId,
  ConflictEntry,
  DiagnosticItem,
  DiagnosticReport,
  InstalledSkill,
  RegistryEntry,
} from "@skills-bank/core";
import { BrowseTab, type BulkInstallState } from "./components/BrowseTab.js";
import { ConflictResolutionModal } from "./components/ConflictResolutionModal.js";
import {
  InstalledTab,
  type InstalledGroup,
} from "./components/InstalledTab.js";
import { RegisterModal } from "./components/RegisterModal.js";
import {
  Header,
  type Density,
  type LocalScanState,
  type Theme,
} from "./components/Header.js";
import { ConflictResolveModal } from "./components/ConflictResolveModal.js";
import {
  InstallConflictModal,
  type InstallConflictError,
} from "./components/InstallConflictModal.js";
// Phase 2 persona collapse: LoginScreen retired. Fresh installs land
// directly on bundled-default; GitHub linking is reached via Settings
// → Account → "Sign in with GitHub" (ConnectGithubModal, which owns
// device-flow + resume).
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
import { DrawerHost } from "./components/DrawerHost.js";
import { DeleteUnregisteredConfirm } from "./components/DeleteUnregisteredConfirm.js";
import { UpdateNotesModal } from "./components/UpdateNotesModal.js";
import { ConnectGithubModal } from "./components/ConnectGithubModal.js";
import { InstallFromGithubModal } from "./components/InstallFromGithubModal.js";
import { ErrorPanel } from "./components/ErrorPanel.js";
import { AccountModal } from "./components/AccountModal.js";
import { ManifestImportConfirmModal } from "./components/ManifestImportConfirmModal.js";
import { ManifestModal } from "./components/ManifestModal.js";
import { UpdatesModal } from "./components/UpdatesModal.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { DestinationPickerDialog } from "./components/DestinationPickerDialog.js";
import { useModalRouter } from "./hooks/useModalRouter.js";
import { useRescanController } from "./hooks/useRescanController.js";
import {
  RegistryHostProvider,
  useRegistryHost,
  type ToastAction,
} from "./RegistryHostContext.js";
import {
  ModalRegistryProvider,
  useAnyModalOpen,
} from "./ModalRegistryContext.js";
import { SettingsProvider, useSettings } from "./SettingsContext.js";
import { RegistryProvider, useRegistry } from "./RegistryContext.js";
import type {
  AuthStatus,
  SyncStatus,
  UpdateStatus,
  OriginUpdateResult,
} from "../shared/ipc.js";

// Settings, theme, and density persistence keys moved into
// SettingsContext along with the read/write helpers. The keys below
// are the ones still managed by App.tsx (search/tab/etc. — UI filter
// + tab state that hasn't been lifted yet).
const LS_KEYS = {
  search: "skills-bank.searchQuery",
  tagFilter: "skills-bank.tagFilter",
  tab: "skills-bank.activeTab",
  installedOnly: "skills-bank.installedOnly",
  unregisterHintShown: "skills-bank.unregisterHintShown",
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
  // Provider nesting matters: SettingsProvider wraps RegistryProvider
  // because refresh() reads settings.customSkillsDirs. The host +
  // modal-registry providers stay outermost — both contexts above
  // call useRegistryHost (flash on rebuild) and need to mount before
  // any consumer can register.
  return (
    <ModalRegistryProvider>
      <RegistryHostProvider>
        <SettingsProvider>
          <RegistryProvider>
            <AppContent />
          </RegistryProvider>
        </SettingsProvider>
      </RegistryHostProvider>
    </ModalRegistryProvider>
  );
}

/**
 * Every mutually-exclusive modal AppContent can show. One at a time —
 * see useModalRouter. The drawer (`selected`), the sync-triggered
 * conflict resolver (`conflictModalEntries`), and the bulk resolve-all
 * flow keep their own state because they can overlay a modal or carry
 * multi-step state.
 */
type ActiveModal =
  | { kind: "register" }
  | { kind: "settings" }
  | { kind: "installFromGithub" }
  | { kind: "shortcuts" }
  | { kind: "account" }
  | { kind: "connectGithub" }
  | { kind: "updates" }
  | { kind: "repoPicker" }
  | { kind: "updateNotes" }
  | { kind: "manifest"; mode: "import" | "export" }
  | {
      kind: "manageLinks";
      target: { name: string; installations: InstalledSkill[] };
    }
  | {
      kind: "conflict";
      target: {
        name: string;
        conflicts: InstalledSkill[];
        /**
         * False when resolving conflicts for an unregistered skill —
         * hides "Replace with symlink to registry" (no registry copy to
         * point at) and defaults each per-installation pick to delete.
         */
        allowReplaceWithSymlink: boolean;
      };
    }
  | {
      kind: "installConflict";
      target: { name: string; errors: InstallConflictError[] };
    }
  | {
      kind: "delete";
      target: { name: string; installations: InstalledSkill[] };
    }
  | {
      kind: "mergeConflict";
      target: {
        sourcePath: string;
        conflicts: import("@skills-bank/core").ConflictEntry[];
        priorReport: import("@skills-bank/core").MergeImportReport;
      };
    }
  | {
      kind: "pickDestination";
      target: { errorId: number; name: string; currentDestination: AgentId };
    }
  | {
      kind: "overwrite";
      target: { errorId: number; name: string; destDir: string };
    }
  | {
      kind: "bulkRepair";
      target: {
        repaired: number;
        unrepairable: Array<{
          name: string;
          entries: Array<{ agent: string; linkPath: string }>;
        }>;
      };
    };

function AppContent(): React.ReactElement {
  const {
    flash,
    flashWithAction,
    flashError,
    dismissToast,
    pushAppError,
    dismissAppError,
    appErrors,
  } = useRegistryHost();
  // Driven by ModalRegistry — every <Modal> increments on mount and
  // SkillDetailDrawer calls useRegisterModal() directly. Replaces the
  // hand-curated OR-chain that drifted between this and the actual
  // set of mountable modals (v1.11.1 fix).
  const anyModalOpen = useAnyModalOpen();
  // Settings + persisted preference scalars come from SettingsContext.
  // Theme/density dataset writes are owned by the provider; this
  // component just reads + setters when it needs them.
  const { settings, saveSettings, theme, setTheme, density, setDensity } =
    useSettings();
  // Registry data + lifecycle. refresh()/rebuild() are the only
  // mutation entry points; everything else reads.
  const {
    registry,
    installed,
    registryRoot,
    configChecked,
    initialLoading,
    rebuilding,
    registryByName,
    installedNames,
    pendingSkillUpdates,
    visibleRegistry,
    uniqueInstalledCount,
    refresh,
    rebuild,
    mutateRegistry,
  } = useRegistry();

  const [tab, setTab] = useState<TabId>(
    (readLS(LS_KEYS.tab, "browse") as TabId) ?? "browse",
  );
  // Typed string-key reader for AppError.copyableDetails. Returns the
  // value when present and a string; null otherwise.
  const detailString = (
    e: import("@skills-bank/core").AppError,
    key: string,
  ): string | null => {
    const v = e.copyableDetails?.[key];
    return typeof v === "string" ? v : null;
  };
  // At most one modal open at a time; see ActiveModal + useModalRouter.
  const { modal, openModal, closeModal } = useModalRouter<ActiveModal>();
  // The always-mounted ConfirmDialogs below read their payload via these
  // narrowed views (they toggle on `open` rather than mount/unmount).
  const pickDestinationTarget =
    modal?.kind === "pickDestination" ? modal.target : null;
  const overwriteTarget = modal?.kind === "overwrite" ? modal.target : null;
  const bulkRepairPrompt = modal?.kind === "bulkRepair" ? modal.target : null;
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
      openModal({
        kind: "pickDestination",
        target: { errorId: id, name, currentDestination: dest },
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
      openModal({ kind: "overwrite", target: { errorId: id, name, destDir } });
      return;
    }
  };
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
  // Auto-update state. `latestUpdateStatus` is a live mirror of the most
  // recent event the main process broadcast; the "updateNotes" modal
  // reads it directly when open, so a render during `downloading` shows
  // the live progress bar without us having to snapshot.
  // `dismissedUpdateVersion` is hydrated once at boot from config.json
  // and gates the badge for that specific version only; the in-app
  // "Check for app updates" entry bypasses it.
  const [latestUpdateStatus, setLatestUpdateStatus] =
    useState<UpdateStatus | null>(null);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<
    string | null
  >(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearchState] = useState<string>(readLS(LS_KEYS.search, ""));
  const [installedOnly, setInstalledOnlyState] = useState<boolean>(
    () => readLS(LS_KEYS.installedOnly, "false") === "true",
  );
  const [selectedTags, setSelectedTagsState] =
    useState<string[]>(readTagFilterLS);
  // BrowseTab filter chip + sort state. Defaults to "All" (empty set)
  // on launch — pending updates from prior sessions may have been
  // resolved while the app was closed; don't presume staleness. State
  // lives here (not BrowseTab) so the Rescan done-state's View action
  // can flip the Updates chip on remotely.
  const [registryFilters, setRegistryFilters] = useState<
    Set<import("./components/RegistryFilters.js").RegistryFilterTag>
  >(() => new Set());
  const [registrySort, setRegistrySort] = useState<
    import("./components/RegistryFilters.js").RegistrySortState
  >({ by: "name", direction: "asc" });
  const [selected, setSelected] = useState<RegistryEntry | null>(null);
  const [bulkInstall, setBulkInstall] = useState<BulkInstallState | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ kind: "idle" });
  const [pendingConflicts, setPendingConflicts] = useState(0);
  const [conflictModalEntries, setConflictModalEntries] = useState<
    ConflictEntry[] | null
  >(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);

  // Overlay reconciliation: if a skill referenced by an open drawer or
  // modal disappears from installed/registry after refresh() (e.g. the
  // user deleted it from the Bank in another flow), drop the stale
  // reference so the overlay closes cleanly. Derived-validation, not
  // derived-state.
  useEffect(() => {
    if (selected && !registryByName.has(selected.name)) {
      setSelected(null);
    }
    if (modal?.kind === "conflict" && !installedNames.has(modal.target.name)) {
      closeModal();
    }
    if (
      modal?.kind === "installConflict" &&
      !registryByName.has(modal.target.name)
    ) {
      closeModal();
    }
    if (
      modal?.kind === "manageLinks" &&
      !installedNames.has(modal.target.name)
    ) {
      closeModal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- overlays are inputs to validate, not deps
  }, [registryByName, installedNames]);

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

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");
  const toggleDensity = () =>
    setDensity(density === "comfortable" ? "compact" : "comfortable");

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

  /**
   * Handle an OriginUpdateResult uniformly across the three Update
   * call sites (drawer Update, drawer Take-upstream, UpdatesModal).
   * Success → transient flash; rate-limit → sticky error with a
   * "Sign in" affordance for unauth hits; other errors → sticky
   * error with a Copy-details diagnostic payload.
   */
  const handleUpdateResult = useCallback(
    (r: OriginUpdateResult) => {
      if (r.ok) {
        flash(r.message);
        return;
      }
      if (r.rateLimit) {
        const resetAt = new Date(r.rateLimit.resetAt);
        const resetText = resetAt.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        });
        const msg = `${r.message}. Resets at ${resetText}.`;
        const action: ToastAction | undefined = r.rateLimit.unauthenticated
          ? {
              label: "Sign in",
              onClick: () => {
                dismissToast();
                openModal({ kind: "account" });
              },
            }
          : undefined;
        flashError(msg, {
          ...(action ? { action } : {}),
          diagnostic:
            `${r.message}\n` +
            `limit=${r.rateLimit.limit}/hr\n` +
            `remaining=${r.rateLimit.remaining}\n` +
            `resetsAt=${r.rateLimit.resetAt}\n` +
            `authenticated=${!r.rateLimit.unauthenticated}`,
        });
        return;
      }
      flashError(r.message, {
        diagnostic: r.diagnostic ?? r.message,
      });
    },
    [flash, flashError],
  );

  // Bulk-install runner. Iterates the queue sequentially and surfaces
  // per-skill progress through `bulkInstall`. Skip-and-continue: a
  // failure on one skill records the reason and moves to the next,
  // matching the contract laid out in issue #60 ("probably skip-and-
  // continue with a final report"). Conflicts that would normally open
  // InstallConflictModal are recorded as failures here — the modal is
  // single-skill UX and not worth re-entering 20 times in a row; the
  // user can re-open those skills from the drawer afterwards. Re-uses
  // settings.defaultInstallAgents so bulk mode lands skills in the
  // same agent set as the per-card Install button.
  const runBulkInstall = useCallback(
    async (names: string[]): Promise<void> => {
      if (names.length === 0) return;
      const agents =
        settings.defaultInstallAgents.length > 0
          ? settings.defaultInstallAgents
          : undefined;
      let succeeded = new Set<string>();
      let failed = new Map<string, string>();
      let queue: ReadonlySet<string> = new Set(names);
      setBulkInstall({
        queue,
        current: null,
        succeeded,
        failed,
      });
      for (const name of names) {
        // Pop the current name out of the queue before kicking the
        // install so the action bar's "X of N" math counts the active
        // skill as the in-flight one, not as still-pending.
        const nextQueue = new Set(queue);
        nextQueue.delete(name);
        queue = nextQueue;
        setBulkInstall({
          queue,
          current: name,
          succeeded,
          failed,
        });
        try {
          const r = await window.skillsBank.install(name, false, agents);
          if (r.ok) {
            succeeded = new Set(succeeded);
            succeeded.add(name);
          } else {
            failed = new Map(failed);
            failed.set(
              name,
              r.errors?.[0]?.message ?? r.message ?? "install failed",
            );
          }
        } catch (err) {
          failed = new Map(failed);
          failed.set(name, err instanceof Error ? err.message : String(err));
        }
        setBulkInstall({
          queue,
          current: null,
          succeeded,
          failed,
        });
      }
      // Final state: leave bulkInstall populated so the action bar's
      // summary text stays visible until the user exits select mode.
      // The next bulk run resets it.
      await refresh();
      const okCount = succeeded.size;
      const failCount = failed.size;
      if (failCount === 0) {
        flash(`Installed ${okCount} skill${okCount === 1 ? "" : "s"}`);
      } else if (okCount === 0) {
        flash(`Bulk install failed for all ${failCount} skill(s)`);
      } else {
        flash(`Installed ${okCount}, ${failCount} failed — see card badges`);
      }
    },
    [settings.defaultInstallAgents, refresh, flash],
  );

  // Header Rescan button — the whole user-triggered rebuild + upstream-
  // probe state machine, plus the probe-complete listener that drives
  // the rate-limit toast and the "View" deep-link. Owns rescanState,
  // userTriggeredProbeRef, and doneTimerRef internally.
  const rescan = useRescanController({
    refresh,
    flashError,
    setRegistryFilters,
    setTabPersisted,
    onRequestSignIn: useCallback(() => {
      dismissToast();
      openModal({ kind: "account" });
    }, [dismissToast]),
  });

  // Local-disk diagnostics state. Mirrors the rescan controller's
  // three-phase shape but stays inline since the scan is single-shot
  // (no async probe-complete event to coordinate).
  const [localScanState, setLocalScanState] = useState<LocalScanState>({
    phase: "idle",
  });
  const [diagnostics, setDiagnostics] = useState<DiagnosticReport | null>(null);
  const localScanDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  useEffect(
    () => () => {
      if (localScanDoneTimerRef.current)
        clearTimeout(localScanDoneTimerRef.current);
    },
    [],
  );

  const runLocalScan = useCallback(async () => {
    if (localScanDoneTimerRef.current)
      clearTimeout(localScanDoneTimerRef.current);
    setLocalScanState({ phase: "working" });
    try {
      // The diagnostics scan + an installed-list refresh in parallel:
      // the disk is already being hit, so we piggyback the installed
      // rehydration onto the same wait. Goes through the registry
      // context's refresh() now that it owns the installed snapshot.
      const [report] = await Promise.all([
        window.skillsBank.localDiagnosticsScan(settings.customSkillsDirs),
        refresh(),
      ]);
      setDiagnostics(report);
      setLocalScanState({ phase: "done", count: report.items.length });
      // Done-zero auto-fades after 1.5s; done-N>0 stays persistent so
      // the user can click Review at their own pace.
      if (report.items.length === 0) {
        localScanDoneTimerRef.current = setTimeout(
          () => setLocalScanState({ phase: "idle" }),
          1500,
        );
      }
    } catch {
      setLocalScanState({ phase: "idle" });
    }
  }, [settings.customSkillsDirs, refresh]);

  const refreshDiagnostics = useCallback(async () => {
    try {
      const report = await window.skillsBank.localDiagnosticsScan(
        settings.customSkillsDirs,
      );
      setDiagnostics(report);
    } catch {
      // Failure leaves the prior report visible; user can rescan
      // manually via Button C.
    }
  }, [settings.customSkillsDirs]);

  const onViewLocalScan = useCallback(() => {
    if (localScanDoneTimerRef.current)
      clearTimeout(localScanDoneTimerRef.current);
    setTabPersisted("installed");
    setLocalScanState({ phase: "idle" });
    // Scroll content to top after React commits the tab change — the
    // Needs-attention section lives at the top of InstalledTab.
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(".content");
      if (el) el.scrollTo({ top: 0, behavior: "smooth" });
    }, 0);
  }, [setTabPersisted]);

  const onFixDiagnosticItem = useCallback(
    async (item: DiagnosticItem) => {
      if (item.category === "unregistered-installs") {
        // Open the unified detail drawer with a synthetic entry so
        // the user picks the registration action (adopt vs external).
        // Matches the InstalledTab card's onRegisterOne path.
        const synthetic: RegistryEntry = registryByName.get(item.name) ?? {
          name: item.name,
          description: item.detail,
          path: item.name,
          source: { source: "user" },
        };
        setSelected(synthetic);
        return;
      }
      if (item.category === "broken-symlinks") {
        const agent = (item.agent ?? "claude") as AgentId;
        const r = await window.skillsBank.removeBrokenLinks(item.name, [agent]);
        if (r.errors.length > 0) {
          flashError(r.errors.map((e) => e.message).join("; "));
        } else {
          flash(`Removed broken link for ${item.name}`);
        }
        await refresh();
        await refreshDiagnostics();
        return;
      }
      // external-target-missing OR registry-folder-missing: same path.
      const r = await window.skillsBank.forgetMissing(item.name);
      if (r.ok) {
        flash(r.message);
      } else {
        flashError(r.message);
      }
      await refresh();
      await refreshDiagnostics();
    },
    [registryByName, flash, flashError, refresh, refreshDiagnostics],
  );

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
      flash("That directory is already in the scan list.");
      return;
    }
    saveSettings({
      ...settings,
      customSkillsDirs: [...settings.customSkillsDirs, chosen],
    });
    // v0.11.8 M5: surface the soft-validator warning if the path
    // shape is suspicious. The dir is added regardless — the
    // warning is a hint, not a rejection.
    if (r.warning) flashError(r.warning);
    void refresh();
  }, [settings, saveSettings, refresh, flash, flashError]);

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

  // Hydrate the user's "Skip this version" choice once at boot. The main
  // process is the source of truth (persisted alongside registryRoot/persona
  // in config.json), so this is fire-and-forget.
  //
  // Same boot read also surfaces the ADR-0004 weak-storage notice when
  // the safeStorage backend resolved to `basic_text` (Linux without a
  // keyring) and the user hasn't already dismissed it for this backend.
  useEffect(() => {
    void window.skillsBank.getConfig().then((cfg) => {
      setDismissedUpdateVersion(cfg.dismissedUpdateVersion);
      if (cfg.showWeakStorageNotice) {
        flashError(
          "Your system has no usable keyring — the GitHub token is stored with weak encryption (basic_text). Sign out when you're done.",
          {
            action: {
              label: "Don't show again",
              onClick: () => {
                void window.skillsBank.dismissWeakStorageNotice();
                dismissToast();
              },
            },
            diagnostic:
              `safeStorage backend: ${cfg.storageBackend ?? "unavailable"}\n` +
              `On Linux this means no libsecret-providing keyring (gnome-keyring, kwallet, etc.) was found.\n` +
              `Install one and restart for proper OS-managed token encryption.`,
          },
        );
      }
    });
  }, [flashError, dismissToast]);

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
      mutateRegistry((prev) =>
        prev.map((e) => (e.name === name ? { ...e, tags: next } : e)),
      );
      const r = await window.skillsBank.editTags(name, next);
      flash(r.message);
      // Refresh in the background either way — on success to pick up
      // source/publishState changes, on failure to roll back the
      // optimistic paint.
      void refresh();
    },
    [flash, refresh, mutateRegistry],
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
    openModal({ kind: "repoPicker" });
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
    openModal({
      kind: "mergeConflict",
      target: {
        sourcePath: r.sourcePath,
        conflicts: r.report.conflicts,
        priorReport: r.report,
      },
    });
  }, [flash, refresh, openModal]);

  const exportRegistry = useCallback(async () => {
    const r = await window.skillsBank.exportRegistry();
    if (!r.ok && r.message !== "export cancelled") {
      flash(`Export failed: ${r.message}`);
    } else if (r.ok) {
      flash(r.message);
    }
  }, [flash]);

  // Manifest ops. Moved out of SettingsModal so the success path
  // can call `refresh()` — the SettingsModal-resident version
  // skipped the refresh and the user had to hit Rescan manually to
  // see imported skills. Pairs the content ops above (importRegistry
  // / mergeRegistry / exportRegistry) with their pointer-only
  // equivalents and converges the seam on Account.
  const [manifestImportHints, setManifestImportHints] = useState<
    import("@skills-bank/core").ImportRegistryManifestResult | null
  >(null);
  // Tier 1 v2: tracks whether the manifest-import IPC is in flight,
  // gating the AccountModal button matrix (busy state for Import
  // manifest, disable for corruption-risking siblings). Cleared in the
  // `finally` so an aborted or failed import returns the UI to idle.
  const [importingManifest, setImportingManifest] = useState(false);

  // Tier 2 per-skill progress. Tracks the currently-in-flight manifest
  // import's progress so the ImportIndicator chip can render `N/total`
  // and (Tier 3) BrowseTab can place ghost cards. Cleared in the
  // `finally` after import resolves so a fresh import starts clean.
  const [manifestImportProgress, setManifestImportProgress] = useState<{
    completed: number;
    total: number;
    currentName: string;
    manifestNames: string[];
    manifestSkills: import("@skills-bank/core").ManifestSkill[];
    errors: Map<string, string>;
    /** Names the user has explicitly dismissed via the ghost-card × button. */
    dismissed: Set<string>;
    /**
     * Per-skill completion status driven by the progress events. A skill
     * moves to "settled" the moment the iteration AFTER it fires (so the
     * previous skill's outcome is observed). Used to drive ghost → real
     * card transitions and the band's "all settled" dissolution.
     */
    settled: Set<string>;
  } | null>(null);

  useEffect(() => {
    if (!window.skillsBank.onManifestImportProgress) return;
    return window.skillsBank.onManifestImportProgress((event) => {
      setManifestImportProgress((prev) => {
        const errors = new Map(prev?.errors ?? []);
        if (event.lastError) {
          // lastError is "name: reason" — extract name for the map key
          const idx = event.lastError.indexOf(": ");
          const failedName =
            idx > 0 ? event.lastError.slice(0, idx) : event.lastError;
          const reason =
            idx > 0 ? event.lastError.slice(idx + 2) : event.lastError;
          errors.set(failedName, reason);
        }
        // Mark the previous in-flight skill as settled when this event
        // fires — we can't observe its outcome directly from progress,
        // but the fact that the loop advanced means its iteration
        // closed. The last terminal event (completed === total) settles
        // the final skill.
        const settled = new Set(prev?.settled ?? []);
        if (prev?.currentName && prev.currentName !== event.currentName) {
          settled.add(prev.currentName);
        }
        if (event.completed === event.total && event.currentName) {
          settled.add(event.currentName);
        }
        return {
          completed: event.completed,
          total: event.total,
          currentName: event.currentName,
          manifestNames: event.manifestNames ?? prev?.manifestNames ?? [],
          manifestSkills: event.manifestSkills ?? prev?.manifestSkills ?? [],
          errors,
          dismissed: prev?.dismissed ?? new Set(),
          settled,
        };
      });
    });
  }, []);

  const dismissGhost = useCallback((name: string) => {
    setManifestImportProgress((prev) => {
      if (!prev) return prev;
      const dismissed = new Set(prev.dismissed);
      dismissed.add(name);
      return { ...prev, dismissed };
    });
  }, []);

  const retryGhost = useCallback(
    async (skill: import("@skills-bank/core").ManifestSkill) => {
      const r = await window.skillsBank.manifestImportRetrySkill(skill);
      if (r.ok && r.outcome) {
        // Clear the error for this skill regardless of new outcome —
        // the renderer's terminal state is now whatever the outcome
        // says (registered / collision / origin-unreachable).
        setManifestImportProgress((prev) => {
          if (!prev) return prev;
          const errors = new Map(prev.errors);
          if (r.outcome!.result === "registered") {
            errors.delete(skill.name);
            // Mark as settled so the band transitions it from
            // ghost-error → real card on the next refresh.
            const settled = new Set(prev.settled);
            settled.add(skill.name);
            return { ...prev, errors, settled };
          }
          // Retry produced another failure (or a collision). Keep the
          // error visible so the user can retry again or dismiss.
          if (r.outcome!.result === "origin-unreachable") {
            errors.set(skill.name, r.outcome!.reason ?? "origin unreachable");
          }
          return { ...prev, errors };
        });
        if (r.outcome.result === "registered") {
          await refresh();
          flash(`Retried ${skill.name}`);
        } else if (r.outcome.result === "collision") {
          flashError(
            `${skill.name}: skill already exists with a different origin`,
          );
        } else if (r.outcome.result === "origin-unreachable") {
          flashError(`${skill.name}: ${r.outcome.reason ?? "unreachable"}`);
        }
      } else if (r.message) {
        flashError(r.message);
      }
    },
    [flash, flashError, refresh],
  );

  const importManifest = useCallback(async () => {
    setImportingManifest(true);
    setManifestImportProgress(null);
    try {
      const r = await window.skillsBank.importManifest();
      if (!r.ok) {
        if (r.message && r.message !== "cancelled") {
          flashError(r.message);
        }
        return;
      }
      const registered = r.result.outcomes.filter(
        (o) => o.result === "registered",
      ).length;
      if (r.result.cancelled) {
        flash(
          `Import cancelled. Restored ${registered} skill${registered === 1 ? "" : "s"}.`,
        );
      } else {
        flash(
          `Restored ${registered} skill${registered === 1 ? "" : "s"} from manifest`,
        );
      }
      await refresh();
      if (r.result.installHints.length > 0) {
        setManifestImportHints(r.result);
      }
    } finally {
      setImportingManifest(false);
      setManifestImportProgress(null);
    }
  }, [flash, flashError, refresh]);

  const cancelManifestImport = useCallback(() => {
    void window.skillsBank.importManifestCancel();
  }, []);

  const exportManifest = useCallback(async () => {
    const r = await window.skillsBank.exportManifest();
    if (r.ok) {
      const where = r.destPath
        ? ` (${r.destPath.split("/").pop() ?? r.destPath})`
        : "";
      flash(
        `Exported ${r.skillCount ?? 0} skill${r.skillCount === 1 ? "" : "s"}${where}`,
      );
    } else if (r.message && r.message !== "export cancelled") {
      flashError(r.message);
    }
  }, [flash, flashError]);

  const pickRepo = useCallback(
    async (fullName: string) => {
      const r = await window.skillsBank.reposReplaceRegistry(fullName);
      if (r.ok) {
        flash(r.message);
        closeModal();
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
    closeModal();
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
      openModal({ kind: "updateNotes" });
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
          openModal({ kind: "settings" });
          break;
        case "openShortcuts":
          openModal({ kind: "shortcuts" });
          break;
        case "refresh":
          void rescan.onRefreshClick();
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
  }, [rescan, sync, checkForUpdates]);

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

  // Phase 2 persona collapse: the `registrySource === null` case is
  // unreachable. Main-process boot normalizes it to "local" before the
  // renderer ever sees AuthStatus, so this gate would have stayed dead
  // code if not removed. The legacy v1.2 path that routed here on
  // first launch is documented in `docs/plans/vocabulary-rename.md`.

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
    if (isLiveUpdate) openModal({ kind: "updateNotes" });
  };

  // Initial loading — skeleton over real chrome.
  if (initialLoading) {
    return (
      <div className="app" aria-busy="true">
        <Header
          rescanState={{ phase: "working" }}
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
          pendingSkillUpdates={0}
          onShowUpdates={() => undefined}
          onViewRescanUpdates={() => undefined}
          importingManifest={false}
          onCancelImport={() => undefined}
          localScanState={{ phase: "idle" }}
          onLocalScan={() => undefined}
          onViewLocalScan={() => undefined}
          manifestImportProgress={null}
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
        rescanState={rescan.state}
        onRefresh={() => void rescan.onRefreshClick()}
        theme={theme}
        onToggleTheme={toggleTheme}
        density={density}
        onToggleDensity={toggleDensity}
        syncing={
          syncStatus.kind === "fetching" || syncStatus.kind === "applying"
        }
        onSync={() => void refreshLinkedRepo()}
        authStatus={authStatus}
        onOpenAccount={() => openModal({ kind: "account" })}
        onOpenSettings={() => openModal({ kind: "settings" })}
        pendingUpdateVersion={pendingUpdateVersion}
        onShowUpdate={openUpdateModal}
        pendingSkillUpdates={pendingSkillUpdates.length}
        onShowUpdates={() => openModal({ kind: "updates" })}
        onViewRescanUpdates={rescan.onViewUpdates}
        importingManifest={importingManifest}
        onCancelImport={cancelManifestImport}
        localScanState={localScanState}
        onLocalScan={() => void runLocalScan()}
        onViewLocalScan={onViewLocalScan}
        manifestImportProgress={
          manifestImportProgress
            ? {
                completed: manifestImportProgress.completed,
                total: manifestImportProgress.total,
              }
            : null
        }
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
          modalOpen={anyModalOpen}
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
              // skills section. Memoized above as `visibleRegistry`.
              registry={visibleRegistry}
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
              registryFilters={registryFilters}
              setRegistryFilters={setRegistryFilters}
              registrySort={registrySort}
              setRegistrySort={setRegistrySort}
              onBulkInstall={runBulkInstall}
              bulkInstall={bulkInstall}
              manifestImportProgress={manifestImportProgress}
              onRetryGhost={(skill) => void retryGhost(skill)}
              onDismissGhost={dismissGhost}
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
              onRegisterAll={() => openModal({ kind: "register" })}
              onRegisterOne={(s) => {
                // Open the unified detail drawer with a synthetic registry
                // entry so the user gets the same Register / Manage-links /
                // Remove action surface as a registered skill — the two
                // operations are now distinct buttons, not a radio group.
                const synthetic: RegistryEntry = registryByName.get(s.name) ?? {
                  name: s.name,
                  description: s.target ?? s.linkPath,
                  path: s.linkPath,
                  source: { source: "user" },
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
                openModal({
                  kind: "conflict",
                  target: {
                    name: g.name,
                    conflicts,
                    allowReplaceWithSymlink: isRegistered,
                  },
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
                openModal({
                  kind: "bulkRepair",
                  target: { repaired, unrepairable: unrepairableBySkill },
                });
              }}
              onInlineDelete={(group) => {
                // M9b: open the delete-confirm modal with the group so it
                // can preview which paths get touched. Actual deletion
                // fires only after the user confirms.
                const mine = installed.filter((i) => i.name === group.name);
                openModal({
                  kind: "delete",
                  target: { name: group.name, installations: mine },
                });
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
                  openModal({
                    kind: "bulkRepair",
                    target: {
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
                    },
                  });
                })();
              }}
              diagnostics={diagnostics}
              onFixDiagnosticItem={(item) => void onFixDiagnosticItem(item)}
            />
          )}
        </div>
      )}

      {modal?.kind === "register" && (
        <RegisterModal
          onClose={async () => {
            closeModal();
            await refresh();
          }}
          onFlash={flash}
          registerAdopts={settings.registerAdopts}
          defaultInstallAgents={
            settings.defaultInstallAgents.length > 0
              ? settings.defaultInstallAgents
              : undefined
          }
        />
      )}

      {modal?.kind === "manageLinks" && (
        <ManageLinksModal
          name={modal.target.name}
          installations={modal.target.installations}
          onClose={async () => {
            closeModal();
            await refresh();
          }}
          onFlash={flash}
        />
      )}

      {modal?.kind === "conflict" && (
        <ConflictResolveModal
          name={modal.target.name}
          conflicts={modal.target.conflicts}
          allowReplaceWithSymlink={modal.target.allowReplaceWithSymlink}
          onClose={async () => {
            closeModal();
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
                        const r = await window.skillsBank.resolveSkillConflicts(
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

      {modal?.kind === "installConflict" && (
        <InstallConflictModal
          name={modal.target.name}
          errors={modal.target.errors}
          onClose={() => closeModal()}
          onForce={async () => {
            const r = await window.skillsBank.install(
              modal.target.name,
              true,
              settings.defaultInstallAgents.length > 0
                ? settings.defaultInstallAgents
                : undefined,
            );
            flash(r.message);
            closeModal();
            await refresh();
          }}
          onResolve={() => {
            // Hand off to ConflictResolveModal using the current
            // installed snapshot for the same name. The user picks
            // per-agent actions there. openModal replaces this modal.
            const conflicts = installed.filter(
              (i) =>
                i.name === modal.target.name &&
                i.kind !== "ours" &&
                i.kind !== "broken-symlink",
            );
            // Force-install conflicts only occur for registered skills
            // (force-install is a registered-level action), so the
            // resolution always allows the symlink-to-registry path.
            openModal({
              kind: "conflict",
              target: {
                name: modal.target.name,
                conflicts,
                allowReplaceWithSymlink: true,
              },
            });
          }}
        />
      )}

      {modal?.kind === "mergeConflict" && (
        <ConflictResolutionModal
          conflicts={modal.target.conflicts}
          onClose={() => {
            const prior = modal.target.priorReport;
            closeModal();
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
            const target = modal.target;
            closeModal();
            const r = await window.skillsBank.importRegistryMergeApply(
              target.sourcePath,
              decisions,
            );
            flash(r.message);
            await refresh();
          }}
        />
      )}

      {modal?.kind === "delete" && (
        <DeleteUnregisteredConfirm
          name={modal.target.name}
          installations={modal.target.installations}
          onCancel={() => closeModal()}
          onConfirm={async () => {
            const target = modal.target;
            closeModal();
            const r = await window.skillsBank.deleteUnregistered(target.name);
            flash(r.message);
            await refresh();
          }}
        />
      )}

      {modal?.kind === "settings" && (
        <SettingsModal
          settings={settings}
          onSave={saveSettings}
          onClose={() => closeModal()}
          onOpenInstallFromGithub={() =>
            openModal({ kind: "installFromGithub" })
          }
          hiddenCanon={registry.filter((e) => e.hidden).map((e) => e.name)}
          onUnhide={async (name) => {
            const r = await window.skillsBank.unhide(name);
            flash(r.message);
            await refresh();
          }}
          isAuthed={Boolean(authStatus?.user)}
        />
      )}
      {modal?.kind === "installFromGithub" && (
        <InstallFromGithubModal
          onClose={() => closeModal()}
          onInstalled={() => {
            closeModal();
            void refresh();
          }}
        />
      )}

      {modal?.kind === "shortcuts" && (
        <KeyboardShortcutsOverlay onClose={() => closeModal()} />
      )}

      {modal?.kind === "account" && (
        <AccountModal
          authStatus={authStatus}
          appVersion={"dev"}
          onClose={() => closeModal()}
          onChangeRegistry={async () => {
            closeModal();
            await changeRegistry();
          }}
          onRefreshRegistry={async () => {
            closeModal();
            await refreshLinkedRepo();
          }}
          onImportRegistry={async () => {
            closeModal();
            await importRegistryFromDisk();
          }}
          onMergeRegistry={async () => {
            closeModal();
            await mergeRegistry();
          }}
          onExportRegistry={async () => {
            closeModal();
            await exportRegistry();
          }}
          onOpenImportManifest={() =>
            openModal({ kind: "manifest", mode: "import" })
          }
          importingManifest={importingManifest}
          onOpenExportManifest={() =>
            openModal({ kind: "manifest", mode: "export" })
          }
          onSignOut={async () => {
            closeModal();
            await signOut();
          }}
          onCheckForUpdates={checkForUpdates}
          onConnectGithub={() => openModal({ kind: "connectGithub" })}
        />
      )}

      {manifestImportHints !== null && (
        <ManifestImportConfirmModal
          result={manifestImportHints}
          onClose={() => setManifestImportHints(null)}
          onDone={(msg) => {
            setManifestImportHints(null);
            if (msg) flash(msg);
          }}
        />
      )}

      {modal?.kind === "manifest" && (
        <ManifestModal
          mode={modal.mode}
          linkedRepo={authStatus?.linkedRepo ?? null}
          appVersion="dev"
          importingManifest={importingManifest}
          onCancelImport={cancelManifestImport}
          onClose={() => closeModal()}
          onImportComplete={(result) => {
            closeModal();
            const registered = result.outcomes.filter(
              (o) => o.result === "registered",
            ).length;
            if (result.cancelled) {
              flash(
                `Import cancelled. Restored ${registered} skill${registered === 1 ? "" : "s"}.`,
              );
            } else {
              flash(
                `Restored ${registered} skill${registered === 1 ? "" : "s"} from manifest`,
              );
            }
            void refresh();
            if (result.installHints.length > 0) {
              setManifestImportHints(result);
            }
          }}
          onExportComplete={(msg) => {
            closeModal();
            flash(msg);
          }}
        />
      )}

      {modal?.kind === "connectGithub" && authStatus && (
        <ConnectGithubModal
          isAuthConfigured={authStatus.isAuthConfigured}
          onClose={() => closeModal()}
          onConnected={(status) => {
            closeModal();
            setAuthStatus(status);
            // First-link case: user just authed and has no linked
            // repo yet → auto-prompt RepoPicker as the obvious
            // next step. Sign-in's payoff is linking a repo;
            // making the user hunt for "Link a GitHub repository"
            // after Device Flow is bad UX.
            //
            // Re-auth case: user already has a linkedRepo → leave
            // it untouched. They just refreshed credentials; the
            // explicit "Change linked repo" action in Account
            // covers the rare "actually swap the repo" intent.
            if (!status.linkedRepo) {
              openModal({ kind: "repoPicker" });
            }
            void refresh();
          }}
        />
      )}

      {modal?.kind === "updates" && (
        <UpdatesModal
          entries={pendingSkillUpdates}
          onClose={() => closeModal()}
          onUpdate={async (name) => {
            const r = await window.skillsBank.originUpdate(name);
            handleUpdateResult(r);
            await refresh();
            return r;
          }}
          onView={(entry) => {
            closeModal();
            setSelected(entry);
          }}
          onRefresh={async () => {
            await window.skillsBank.originProbe();
            await refresh();
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
        onCancel={() => closeModal()}
        onPick={async (next, persistAsDefault) => {
          if (!pickDestinationTarget) return;
          const target = pickDestinationTarget;
          closeModal();
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
              A folder already exists at <code>{overwriteTarget?.destDir}</code>
              . Continuing will permanently delete it and move{" "}
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
        onCancel={() => closeModal()}
        onConfirm={async () => {
          if (!overwriteTarget) return;
          const target = overwriteTarget;
          closeModal();
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
                {totalLinks === 1 ? "" : "s"}? The agent dirs lose the symlink.
                Because the registry copy is already gone, these skills will
                also disappear from the registry — there are no source files
                left to back them.
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
          closeModal();
          flash(
            `Repaired ${repaired}; ${unrepairable.length} left unresolved.`,
          );
        }}
        onConfirm={async () => {
          if (!bulkRepairPrompt) return;
          const { repaired, unrepairable } = bulkRepairPrompt;
          closeModal();
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

      {modal?.kind === "updateNotes" &&
        latestUpdateStatus &&
        (latestUpdateStatus.kind === "available" ||
          latestUpdateStatus.kind === "downloading" ||
          latestUpdateStatus.kind === "downloaded") && (
          <UpdateNotesModal
            status={latestUpdateStatus}
            onClose={() => closeModal()}
            onSkip={(version) => {
              setDismissedUpdateVersion(version);
              void window.skillsBank.setDismissedUpdateVersion(version);
              closeModal();
            }}
            onDownload={() => {
              void window.skillsBank.downloadUpdate().then((r) => {
                if (!r.ok) flash(r.message);
              });
            }}
            onRestart={() => {
              closeModal();
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

      {modal?.kind === "repoPicker" && (
        <RepoPickerModal
          onClose={() => closeModal()}
          onPicked={pickRepo}
          onSignOut={signOut}
        />
      )}

      <DrawerHost
        selected={selected}
        onClose={() => setSelected(null)}
        registryByName={registryByName}
        installed={installed}
        registryRoot={registryRoot}
        settings={settings}
        authStatus={authStatus}
        refresh={refresh}
        onUpdateResult={handleUpdateResult}
        onOpenManageLinks={(t) => openModal({ kind: "manageLinks", target: t })}
        onOpenConflicts={(t) => openModal({ kind: "conflict", target: t })}
        onInstallConflict={(p) =>
          openModal({ kind: "installConflict", target: p })
        }
        unregisterHintShown={() =>
          localStorage.getItem(LS_KEYS.unregisterHintShown) === "1"
        }
        markUnregisterHintShown={() => {
          try {
            localStorage.setItem(LS_KEYS.unregisterHintShown, "1");
          } catch {
            // ignore
          }
        }}
      />
    </div>
  );
}
