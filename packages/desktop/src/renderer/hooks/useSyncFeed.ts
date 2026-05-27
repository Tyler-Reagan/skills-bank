import { useEffect, useState } from "react";
import type { ConflictEntry } from "@skills-bank/core";
import type { SyncStatus } from "../../shared/ipc.js";

export interface SyncFeed {
  syncStatus: SyncStatus;
  setSyncStatus: (status: SyncStatus) => void;
  pendingConflicts: number;
  setPendingConflicts: (count: number) => void;
  /** Non-null while the sync-conflict resolver modal should be shown. */
  conflictModalEntries: ConflictEntry[] | null;
  setConflictModalEntries: (entries: ConflictEntry[] | null) => void;
}

/**
 * Owns all sync-derived state and its main-process wiring: the live
 * `onSyncStatus` feed (which drives the banner + auto-opens the resolver
 * when a sync finishes with conflicts), plus the boot-time hydration of
 * `pendingConflicts` from the persisted last-sync report so a banner from
 * a prior run shows immediately.
 *
 * Setters are returned for the imperative call sites (banner dismiss,
 * reset-pending, the resolve flow).
 */
export function useSyncFeed(): SyncFeed {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ kind: "idle" });
  const [pendingConflicts, setPendingConflicts] = useState(0);
  const [conflictModalEntries, setConflictModalEntries] = useState<
    ConflictEntry[] | null
  >(null);

  // Live feed: drives the SyncBanner and the Header sync button. When a
  // sync completes with conflicts, auto-open the resolver so the user
  // doesn't have to chase the banner.
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

  // Hydrate pendingConflicts from the persisted last-sync report on launch.
  useEffect(() => {
    void (async () => {
      const report = await window.skillsBank.getSyncReport();
      if (report) setPendingConflicts(report.conflicts.length);
    })();
  }, []);

  return {
    syncStatus,
    setSyncStatus,
    pendingConflicts,
    setPendingConflicts,
    conflictModalEntries,
    setConflictModalEntries,
  };
}
