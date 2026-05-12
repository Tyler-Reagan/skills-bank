// Pure classifier — no node imports. The renderer pulls this in via
// the `@skills-bank/core/skill-state` subpath; importing from the main
// barrel would transitively load `node:child_process` (build.ts) and
// blow up the browser-target vite build.
import type { InstalledSkill, RegistryEntry } from "./types.js";

/**
 * Discrete states a skill can be in. Derived from the four taxonomy
 * axes (Canon, Registered, Adopted, Installed) plus the on-disk
 * installation kinds. Drives which actions are valid, which are
 * no-ops, and which would make the state worse — for both renderer
 * UI gating and IPC-level enforcement.
 *
 * M1 ships the same 9 states the renderer-only classifier had; the
 * `canon` axis is added to the input so future milestones (M5/M6)
 * can introduce `canon-hidden`, `canon-drift`, and related states
 * without another signature change.
 */
export type DrawerState =
  | "registered-healthy"
  | "registered-available"
  | "registered-conflicts"
  | "registered-broken"
  | "registered-mixed-broken"
  | "unregistered-real"
  | "unregistered-foreign"
  | "unregistered-conflicts"
  | "unregistered-broken"
  | "canon-hidden"
  // M6 heal states:
  | "canon-drift"
  | "registry-folder-missing"
  | "external-target-missing";

export type PrimaryAction =
  | "install"
  | "remove-from-agents"
  | "register"
  | "resolve-conflicts"
  | "resolve-registration-conflicts"
  | "repair-broken"
  | "unhide"
  // M6:
  | "accept-drift"
  | "forget-missing";

export interface DrawerCapabilities {
  canInstall: boolean;
  canRemoveFromAgents: boolean;
  canManageLinks: boolean;
  canExport: boolean;
  canRevealInFinder: boolean;
  canDeleteFromBank: boolean;
  /**
   * Mid-tier destructive action (M4). Move adopted files to the
   * configured agents dir (or drop the entry, for non-adopted), then
   * remove the registry entry. Co-varies with canDeleteFromBank in
   * M4; M5 may tighten further for canon protection.
   */
  canUnregister: boolean;
  canRegister: boolean;
  /**
   * M5: tuck the skill out of the default views without unregistering
   * it. Only granted for canon skills the user hasn't already hidden.
   * Replaces canUnregister/canDeleteFromBank for canon (those are
   * prohibited by IPC).
   */
  canHide: boolean;
  /** M5: undo Hide. Granted only in the canon-hidden state. */
  canUnhide: boolean;
  /**
   * M6: canon-drift heal — accept the local edits as user-authored.
   * Clears the source: canonical marker so future syncs leave the
   * skill alone. The only sensible "single option" today; a future
   * take-canonical adds the other arm.
   */
  canAcceptDrift: boolean;
  /**
   * M6: forget a missing entry — drop the registry/external record.
   * For adopted missing: the entry naturally drops on next index
   * build (folder was gone), so the action is mostly UI cleanup. For
   * non-adopted missing: removes the external.json row.
   */
  canForgetMissing: boolean;
  canResolveConflicts: boolean;
  /**
   * Same skill name has multiple non-ours installations across agent
   * dirs. The user must pick a canonical copy before registration —
   * not a silent dedup by kind rank.
   */
  canResolveRegistrationConflicts: boolean;
  canRepairBroken: boolean;
  primary: PrimaryAction;
}

export interface DrawerStateClassification {
  state: DrawerState;
  capabilities: DrawerCapabilities;
  /** Count of broken-symlink installations (drives the Repair label). */
  brokenCount: number;
  /** Count of conflict installations (drives the Resolve label). */
  conflictCount: number;
}

/**
 * Classifier inputs beyond the original three. `canon` is plumbed
 * through now (M1) and populated by M2's resolution against the
 * linked registry repo. Defaults to false so M1 ships with no
 * behavior change.
 */
export interface ClassifyOptions {
  /**
   * Whether the skill is canon — its name appears in the linked
   * registry repo's upstream index. Reserved for M5/M6 states.
   */
  canon?: boolean;
}

const NEVER: DrawerCapabilities = {
  canInstall: false,
  canRemoveFromAgents: false,
  canManageLinks: false,
  canExport: false,
  canRevealInFinder: false,
  canDeleteFromBank: false,
  canUnregister: false,
  canRegister: false,
  canHide: false,
  canUnhide: false,
  canAcceptDrift: false,
  canForgetMissing: false,
  canResolveConflicts: false,
  canResolveRegistrationConflicts: false,
  canRepairBroken: false,
  primary: "install",
};

export function classifyDrawerState(
  entry: RegistryEntry,
  installed: InstalledSkill[],
  isRegistered: boolean,
  _options: ClassifyOptions = {},
): DrawerStateClassification {
  // M5: canon + hidden short-circuits to a dedicated state. Hide is
  // purely a UI dormancy flag — installations and metadata are
  // preserved — so this state still allows install/remove/etc. but
  // the primary action is Unhide and Delete/Unregister are gone.
  if (isRegistered && entry.canon === true && entry.hidden === true) {
    return applyCanonGate(entry, {
      state: "canon-hidden",
      brokenCount: 0,
      conflictCount: 0,
      capabilities: {
        ...NEVER,
        canRevealInFinder: true,
        canUnhide: true,
        primary: "unhide",
      },
    });
  }

  // M6: missing files. Adopted vs. external split is just the
  // user-facing copy; the heal flow is the same single-option
  // "Forget this entry" today (M6-pragmatic — repoint/refetch are
  // future work).
  if (isRegistered && entry.missing === true) {
    return {
      state:
        entry.adopted === false
          ? "external-target-missing"
          : "registry-folder-missing",
      brokenCount: 0,
      conflictCount: 0,
      capabilities: {
        ...NEVER,
        canRevealInFinder: true,
        canForgetMissing: true,
        primary: "forget-missing",
      },
    };
  }

  // M6: canon-drift. Local copy of a canonical skill has been edited
  // since the last sync. The single recoverable heal action today is
  // "accept local changes" (clear the canonical marker so sync stops
  // trying to overwrite). Take-canonical is future work.
  if (isRegistered && entry.drift === true) {
    return {
      state: "canon-drift",
      brokenCount: 0,
      conflictCount: 0,
      capabilities: {
        ...NEVER,
        canRevealInFinder: true,
        canAcceptDrift: true,
        canExport: true,
        primary: "accept-drift",
      },
    };
  }
  // Only consider installations for THIS skill — the caller may pass
  // the full installed list, the registry view's full list, etc.
  const mine = installed.filter((i) => i.name === entry.name);
  const ours = mine.filter((i) => i.kind === "ours");
  const broken = mine.filter((i) => i.kind === "broken-symlink");
  const conflicts = mine.filter(
    (i) => i.kind === "foreign-symlink" || i.kind === "real-directory",
  );

  const hasOurs = ours.length > 0;
  const hasBroken = broken.length > 0;
  const hasConflicts = conflicts.length > 0;

  if (!isRegistered) {
    // Unregistered branch: the only Bank-relevant action is Register
    // (adopt into the registry). Skills with no usable source on disk
    // can't be registered — they're a dead symlink, repair-or-delete.
    if (hasConflicts) {
      const hasRealDir = conflicts.some((c) => c.kind === "real-directory");
      // Multi-installation across ANY kinds (real-dir + foreign,
      // real-dir + broken, two foreign, etc.) is a registration
      // conflict: the user has more than one on-disk copy of this
      // skill name and needs to pick the canonical one. Route them
      // through RegisterModal where per-kind options live.
      const totalNonOurs = conflicts.length + broken.length;
      if (totalNonOurs > 1) {
        return {
          state: "unregistered-conflicts",
          brokenCount: broken.length,
          conflictCount: conflicts.length,
          capabilities: {
            ...NEVER,
            canRevealInFinder: true,
            canResolveRegistrationConflicts: true,
            primary: "resolve-registration-conflicts",
          },
        };
      }
      // Single-installation unregistered. Register is the single
      // primary; M3 unified adopt vs. symlink-mode behind the global
      // `registerAdopts` setting, so no per-skill split here.
      return {
        state: hasRealDir ? "unregistered-real" : "unregistered-foreign",
        brokenCount: broken.length,
        conflictCount: conflicts.length,
        capabilities: {
          ...NEVER,
          canRevealInFinder: true,
          canRegister: true,
          primary: "register",
        },
      };
    }
    // No real-dir or foreign-symlink, only broken symlinks: dead skill.
    // Keep Reveal so the user can manually inspect/clean up the dead
    // symlink in Finder; everything else would error.
    return {
      state: "unregistered-broken",
      brokenCount: broken.length,
      conflictCount: 0,
      capabilities: {
        ...NEVER,
        canRevealInFinder: true,
        canRepairBroken: hasBroken,
        primary: "repair-broken",
      },
    };
  }

  // Registered branch. Subdivide by what's on disk in the agent dirs.
  // Conflicts (real-dir/foreign-symlink) take priority over broken
  // because the resolve flow itself may eliminate the broken state.

  if (hasConflicts) {
    return applyCanonGate(entry, {
      state: "registered-conflicts",
      brokenCount: broken.length,
      conflictCount: conflicts.length,
      capabilities: {
        ...NEVER,
        canInstall: true, // secondary; will route to InstallConflictModal
        canRemoveFromAgents: hasOurs,
        canManageLinks: true,
        canExport: true,
        canRevealInFinder: true,
        canDeleteFromBank: true,
        canUnregister: true,
        canResolveConflicts: true,
        canRepairBroken: hasBroken,
        primary: "resolve-conflicts",
      },
    });
  }

  if (hasBroken && hasOurs) {
    return applyCanonGate(entry, {
      state: "registered-mixed-broken",
      brokenCount: broken.length,
      conflictCount: 0,
      capabilities: {
        ...NEVER,
        canRemoveFromAgents: true,
        canManageLinks: true,
        canExport: true,
        canRevealInFinder: true,
        canDeleteFromBank: true,
        canUnregister: true,
        canRepairBroken: true,
        primary: "repair-broken",
      },
    });
  }

  if (hasBroken) {
    return applyCanonGate(entry, {
      state: "registered-broken",
      brokenCount: broken.length,
      conflictCount: 0,
      capabilities: {
        ...NEVER,
        canInstall: true, // reinstall replaces broken with fresh symlinks
        canExport: true,
        canRevealInFinder: true,
        canDeleteFromBank: true,
        canUnregister: true,
        canRepairBroken: true,
        primary: "repair-broken",
      },
    });
  }

  if (hasOurs) {
    return applyCanonGate(entry, {
      state: "registered-healthy",
      brokenCount: 0,
      conflictCount: 0,
      capabilities: {
        ...NEVER,
        canRemoveFromAgents: true,
        canManageLinks: true,
        canExport: true,
        canRevealInFinder: true,
        canDeleteFromBank: true,
        canUnregister: true,
        primary: "remove-from-agents",
      },
    });
  }

  // Registered but no installations of any kind.
  return applyCanonGate(entry, {
    state: "registered-available",
    brokenCount: 0,
    conflictCount: 0,
    capabilities: {
      ...NEVER,
      canInstall: true,
      canManageLinks: true,
      canExport: true,
      canRevealInFinder: true,
      canDeleteFromBank: true,
      canUnregister: true,
      canRepairBroken: false,
      primary: "install",
    },
  });
}

/**
 * Apply canon protection rules to a classification. Canon skills are
 * upstream-owned: locally unregistering or deleting one is
 * irrecoverable from the UI, so we strip those capabilities and grant
 * Hide instead. Mirrored on the IPC side in main.ts so the renderer
 * can't bypass via direct invoke.
 *
 * Non-canon classifications pass through unchanged. The canon-hidden
 * state takes its own dedicated short-circuit at the top of
 * classifyDrawerState — it never reaches this wrapper.
 */
function applyCanonGate(
  entry: RegistryEntry,
  c: DrawerStateClassification,
): DrawerStateClassification {
  if (entry.canon !== true) return c;
  // For registered + canon skills, swap delete/unregister for hide.
  // Other capabilities (install, remove-from-agents, manage links,
  // export, reveal) keep working — canon doesn't restrict day-to-day
  // use, only locally irrecoverable mutations.
  return {
    ...c,
    capabilities: {
      ...c.capabilities,
      canDeleteFromBank: false,
      canUnregister: false,
      canHide: true,
    },
  };
}



