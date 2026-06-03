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
import {
  InstalledTab,
  type InstalledGroup,
} from "./components/InstalledTab.js";
import {
  Header,
  type Density,
  type LocalScanState,
  type Theme,
} from "./components/Header.js";
// Phase 2 persona collapse: LoginScreen retired. Fresh installs land
// directly on bundled-default; GitHub linking is reached via Settings
// → Account → "Sign in with GitHub" (ConnectGithubModal, which owns
// device-flow + resume).
import { SplashScreen } from "./components/SplashScreen.js";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
} from "./components/SettingsModal.js";
import { SyncBanner } from "./components/SyncBanner.js";
import { Tabs, type TabId } from "./components/Tabs.js";
import { DiscoverTab } from "./components/DiscoverTab.js";
import { ErrorPanel } from "./components/ErrorPanel.js";
import { ModalHost, type ActiveModal } from "./components/ModalHost.js";
import { useManifestImportProgress } from "./hooks/useManifestImportProgress.js";
import { useModalRouter } from "./hooks/useModalRouter.js";
import { useRescanController } from "./hooks/useRescanController.js";
import { useSyncFeed } from "./hooks/useSyncFeed.js";
import { useUpdateFeed } from "./hooks/useUpdateFeed.js";
import {
  RegistryHostProvider,
  useRegistryHost,
} from "./RegistryHostContext.js";
import {
  ModalRegistryProvider,
  useAnyModalOpen,
} from "./ModalRegistryContext.js";
import { SettingsProvider, useSettings } from "./SettingsContext.js";
import { RegistryProvider, useRegistry } from "./RegistryContext.js";
import type { AuthStatus, SyncStatus, UpdateStatus } from "../shared/ipc.js";

// Persistence keys still managed directly by App.tsx (tab + unregister hint).
// Search/filter/sort state moved into useBrowseFilters.
const LS_KEYS = {
  tab: "skills-bank.activeTab",
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
  // decisions that don't fit a bulk sweep. The running/errors state
  // lives inside ModalHost; only the target list stays here so
  // InstalledTab's onResolveAllConflicts can set it from App.
  const [resolveAllTarget, setResolveAllTarget] = useState<
    InstalledGroup[] | null
  >(null);
  const [labelsRefreshKey, setLabelsRefreshKey] = useState(0);
  const handleLabelsChanged = useCallback(
    () => setLabelsRefreshKey((k) => k + 1),
    [],
  );
  const [reviewSession, setReviewSession] = useState<{
    entries: RegistryEntry[];
    index: number;
  } | null>(null);
  const handleStartReview = useCallback((entries: RegistryEntry[]) => {
    if (entries.length === 0) return;
    setReviewSession({ entries, index: 0 });
    setSelected(entries[0]!);
  }, []);
  const reviewContext = reviewSession
    ? {
        index: reviewSession.index,
        total: reviewSession.entries.length,
        onPrev: () => {
          const newIndex = Math.max(0, reviewSession.index - 1);
          setReviewSession({ ...reviewSession, index: newIndex });
          setSelected(reviewSession.entries[newIndex]!);
        },
        onNext: () => {
          const newIndex = Math.min(
            reviewSession.entries.length - 1,
            reviewSession.index + 1,
          );
          setReviewSession({ ...reviewSession, index: newIndex });
          setSelected(reviewSession.entries[newIndex]!);
        },
        onExit: () => {
          setReviewSession(null);
          setSelected(null);
        },
      }
    : null;
  // Auto-update state + wiring (live feed, boot dismissal gate, derived
  // badge). The "updateNotes" modal reads latestUpdateStatus directly so
  // a render during `downloading` shows the live progress bar.
  const {
    latestUpdateStatus,
    setDismissedUpdateVersion,
    isLiveUpdate,
    pendingUpdateVersion,
  } = useUpdateFeed();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // registryFilters stays here (not in useBrowseFilters) because the
  // Rescan controller flips it remotely via setRegistryFilters when the
  // user clicks "View updates" in the done-state banner.
  const [registryFilters, setRegistryFilters] = useState<
    Set<import("./components/RegistryFilters.js").RegistryFilterTag>
  >(() => new Set());
  const [selected, setSelected] = useState<RegistryEntry | null>(null);
  const [bulkInstall, setBulkInstall] = useState<BulkInstallState | null>(null);
  const {
    syncStatus,
    setSyncStatus,
    pendingConflicts,
    setPendingConflicts,
    conflictModalEntries,
    setConflictModalEntries,
  } = useSyncFeed();
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

  const setTabPersisted = (t: TabId) => {
    setTab(t);
    writeLS(LS_KEYS.tab, t);
  };

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

  // Boot read for the ADR-0004 weak-storage notice: surfaced when the
  // safeStorage backend resolved to `basic_text` (Linux without a
  // keyring) and the user hasn't already dismissed it. (The "Skip this
  // version" choice is hydrated separately by useUpdateFeed.)
  useEffect(() => {
    void window.skillsBank.getConfig().then((cfg) => {
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

  // Tier 1 v2: tracks whether the manifest-import IPC is in flight,
  // gating the AccountModal button matrix (busy state for Import
  // manifest, disable for corruption-risking siblings). Cleared in the
  // `finally` so an aborted or failed import returns the UI to idle.
  const [importingManifest, setImportingManifest] = useState(false);

  // Tier 2 per-skill progress. Tracks the currently-in-flight manifest
  // import's progress so the ImportIndicator chip can render `N/total`
  // and (Tier 3) BrowseTab can place ghost cards. Cleared in the
  // `finally` after import resolves so a fresh import starts clean.
  const { manifestImportProgress, setManifestImportProgress } =
    useManifestImportProgress();

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

  const cancelManifestImport = useCallback(() => {
    void window.skillsBank.importManifestCancel();
  }, []);

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
            className="skills-grid app-skeleton"
            aria-label="Loading registry and installed skills"
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton skeleton-card" />
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
          onInstalled={() => void refresh()}
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
              onSelect={(e) => setSelected(e)}
              onSaveTags={saveCardTags}
              onRebuild={rebuild}
              rebuilding={rebuilding}
              searchInputRef={searchInputRef}
              registryFilters={registryFilters}
              setRegistryFilters={setRegistryFilters}
              onBulkInstall={runBulkInstall}
              bulkInstall={bulkInstall}
              manifestImportProgress={manifestImportProgress}
              onRetryGhost={(skill) => void retryGhost(skill)}
              onDismissGhost={dismissGhost}
              labelsRefreshKey={labelsRefreshKey}
              onStartReview={handleStartReview}
              onManageLabels={() => openModal({ kind: "manageLabels" })}
            />
          )}
          {tab === "installed" && (
            <InstalledTab
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

      <ModalHost
        modal={modal}
        openModal={openModal}
        closeModal={closeModal}
        authStatus={authStatus}
        setAuthStatus={setAuthStatus}
        conflictModalEntries={conflictModalEntries}
        setConflictModalEntries={setConflictModalEntries}
        selected={selected}
        setSelected={setSelected}
        importingManifest={importingManifest}
        cancelManifestImport={cancelManifestImport}
        refreshLinkedRepo={refreshLinkedRepo}
        latestUpdateStatus={latestUpdateStatus}
        setDismissedUpdateVersion={setDismissedUpdateVersion}
        resolveAllTarget={resolveAllTarget}
        setResolveAllTarget={setResolveAllTarget}
        checkForUpdates={checkForUpdates}
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
        onLabelsChanged={handleLabelsChanged}
        reviewContext={reviewContext}
      />
    </div>
  );
}
