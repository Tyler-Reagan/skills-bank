import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";
import { useRegistryHost } from "./RegistryHostContext.js";

interface RefreshResult {
  registryCount: number;
  installedCount: number;
}

interface RegistryContextValue {
  registry: RegistryEntry[];
  installed: InstalledSkill[];
  registryRoot: string | null;
  /** True once the initial getConfig() has resolved (success or empty). */
  configChecked: boolean;
  /** True from mount until the first refresh() resolves. */
  initialLoading: boolean;
  /** True while rebuildIndex() is in flight. */
  rebuilding: boolean;
  /** name → entry lookup. */
  registryByName: Map<string, RegistryEntry>;
  /** Set of skill names currently installed somewhere. */
  installedNames: Set<string>;
  /** Skills with an available upstream update (origin probe). */
  pendingSkillUpdates: RegistryEntry[];
  /** Registry with hidden canon skills filtered out. */
  visibleRegistry: RegistryEntry[];
  /** Dedup-by-name count of installed entries (tab badge). */
  uniqueInstalledCount: number;
  /** Re-fetch registry + installed from main. Returns the new counts. */
  refresh: () => Promise<RefreshResult>;
  /** Trigger a registry-index rebuild then refresh; flashes the result. */
  rebuild: () => Promise<void>;
  /**
   * Optimistic-update primitive: applies `update` to the current
   * registry snapshot synchronously. Use for paint-before-IPC-resolves
   * UX (e.g. tag edits) followed by `void refresh()` to reconcile with
   * the source of truth.
   */
  mutateRegistry: (update: (prev: RegistryEntry[]) => RegistryEntry[]) => void;
}

const RegistryContext = createContext<RegistryContextValue | null>(null);

export function useRegistry(): RegistryContextValue {
  const ctx = useContext(RegistryContext);
  if (!ctx) {
    throw new Error("useRegistry must be used inside <RegistryProvider>");
  }
  return ctx;
}

interface ProviderProps {
  children: React.ReactNode;
}

/**
 * Owns the registry/installed snapshots plus the refresh + rebuild
 * lifecycle. Pulled out of App.tsx in the v1.12 housekeeping branch.
 *
 * The provider also wires the initial mount-time load (formerly an
 * inline useEffect in App.tsx) and flips `initialLoading` to false
 * once the first refresh resolves — gating the SplashScreen render in
 * App.tsx so the skeleton doesn't briefly flash empty.
 */
export function RegistryProvider({
  children,
}: ProviderProps): React.ReactElement {
  const { flash } = useRegistryHost();
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [installed, setInstalled] = useState<InstalledSkill[]>([]);
  const [registryRoot, setRegistryRoot] = useState<string | null>(null);
  const [configChecked, setConfigChecked] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);

  const refresh = useCallback(async (): Promise<RefreshResult> => {
    const cfg = await window.skillsBank.getConfig();
    setRegistryRoot(cfg.registryRoot);
    setConfigChecked(true);
    if (!cfg.registryRoot) {
      setRegistry([]);
      setInstalled([]);
      return { registryCount: 0, installedCount: 0 };
    }
    const [r, i] = await Promise.all([
      window.skillsBank.listRegistry(),
      window.skillsBank.listInstalled(),
    ]);
    setRegistry(r);
    setInstalled(i);
    return {
      registryCount: r.length,
      installedCount: new Set(i.map((x) => x.name)).size,
    };
  }, []);

  // Initial-load gate. Flips initialLoading to false once the first
  // refresh resolves (success or empty).
  useEffect(() => {
    void refresh().finally(() => setInitialLoading(false));
  }, [refresh]);

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

  const mutateRegistry = useCallback(
    (update: (prev: RegistryEntry[]) => RegistryEntry[]) => {
      setRegistry(update);
    },
    [],
  );

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

  // Skills with an available upstream update — set by the main-process
  // probe runner via the augmented listRegistry. Drives the header
  // aggregate badge and the UpdatesModal's content.
  const pendingSkillUpdates = useMemo(
    () => registry.filter((e) => e.skillUpdateAvailable === true),
    [registry],
  );

  // v6: the canon/hidden concept is gone — every registry entry is
  // visible in the default Browse view. Kept as a distinct value (not
  // an alias of `registry`) so call sites don't need to change if a
  // future visibility filter reappears.
  const visibleRegistry = registry;

  const uniqueInstalledCount = installedNames.size;

  const value = useMemo<RegistryContextValue>(
    () => ({
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
    }),
    [
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
    ],
  );

  return (
    <RegistryContext.Provider value={value}>
      {children}
    </RegistryContext.Provider>
  );
}
