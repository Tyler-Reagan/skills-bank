import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { ManifestSkill } from "@skills-bank/core";

/**
 * Tier-2 per-skill progress for the currently-in-flight manifest import.
 * Drives the ImportIndicator chip (`N/total`) and BrowseTab's ghost cards.
 */
interface ManifestImportProgress {
  completed: number;
  total: number;
  currentName: string;
  manifestNames: string[];
  manifestSkills: ManifestSkill[];
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
}

interface ManifestImportProgressFeed {
  manifestImportProgress: ManifestImportProgress | null;
  setManifestImportProgress: Dispatch<
    SetStateAction<ManifestImportProgress | null>
  >;
}

/**
 * Owns the manifest-import progress state and folds each
 * `onManifestImportProgress` event into it (error extraction +
 * settled-skill tracking). The setter is returned so the import action
 * handlers in App can seed and clear it around a run.
 */
export function useManifestImportProgress(): ManifestImportProgressFeed {
  const [manifestImportProgress, setManifestImportProgress] =
    useState<ManifestImportProgress | null>(null);

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
        // but the fact that the loop advanced means its iteration closed.
        // The last terminal event (completed === total) settles the final
        // skill.
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

  return { manifestImportProgress, setManifestImportProgress };
}
