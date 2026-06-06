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
 * State names align with user-facing copy where the state is surfaced
 * in the drawer (e.g. `edited-without-origin` matches the "You've
 * edited this bundled skill" heading). Internal-only states keep
 * their composite shape.
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
  | "bundled-skill-dismissed"
  // Heal states:
  | "edited-without-origin"
  | "edited-with-origin"
  | "origin-update-available"
  | "origin-unreachable"
  | "registry-folder-missing"
  | "external-target-missing";

/**
 * Consecutive probe-failure threshold at which a GitHub-origin
 * skill enters the `origin-unreachable` drawer state. Three failures
 * matches the desktop runner's 6-hourly default probe cadence (~18
 * hours of real-world unreachability) — long enough to ride out
 * transient regional outages, short enough to be useful to the user.
 * v1.4. See `docs/plans/bank-mode-persistence.md`.
 */
export const ORIGIN_UNREACHABLE_THRESHOLD = 3 as const;

export type PrimaryAction =
  | "install"
  | "manage-links"
  | "register"
  | "resolve-conflicts"
  | "resolve-registration-conflicts"
  | "repair-broken"
  | "unhide"
  | "update"
  | "forget-missing"
  | "repoint";

export interface DrawerCapabilities {
  canInstall: boolean;
  canManageLinks: boolean;
  canExport: boolean;
  canRevealInFinder: boolean;
  /**
   * Deletion of registered skills routes through Unregister first,
   * then the inline Delete on Unregistered cards
   * (`deleteUnregisteredSkill`). Kept in the capability surface for
   * non-UI consumers (CLI / IPC enforcement layer).
   */
  canDeleteFromBank: boolean;
  /**
   * Mid-tier destructive action. Move adopted files to the configured
   * agents dir (or drop the entry, for non-adopted), then remove the
   * registry entry. Co-varies with canDeleteFromBank.
   */
  canUnregister: boolean;
  canRegister: boolean;
  /**
   * Dismiss the bundled skill from default views without unregistering
   * it. Only granted for bundled skills (canon) the user hasn't
   * already dismissed. Replaces canUnregister/canDeleteFromBank for
   * bundled skills (those are prohibited by IPC).
   */
  canHide: boolean;
  /** Undo Dismiss. Granted only in the bundled-skill-dismissed state. */
  canUnhide: boolean;
  /**
   * `origin-update-available` heal — apply the upstream change in
   * place. Runs `npx skills update <name>`; the new content replaces
   * the on-disk skill and the baseline hash is re-snapshotted.
   */
  canUpdate: boolean;
  /**
   * Forget a missing entry — drop the registry/external record. For
   * adopted missing: the entry naturally drops on next index build
   * (folder was gone), so the action is mostly UI cleanup. For
   * non-adopted missing: removes the external.json row.
   */
  canForgetMissing: boolean;
  /**
   * Repoint a non-adopted missing entry — open a directory picker, let
   * the user pick the new location of a skill they moved on disk, and
   * rewrite the external.json target so the missing flag clears.
   * Only granted for `external-target-missing` (not adopted-missing —
   * adopted entries have no external row to repoint).
   */
  canRepoint: boolean;
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
 * Classifier inputs beyond the original three. `canon` is the
 * internal protection-rule axis — never surfaced to the user.
 */
export interface ClassifyOptions {
  /**
   * Whether the skill is currently in the linked registry's upstream
   * bundled snapshot. Drives destructive-action protection only.
   */
  canon?: boolean;
}

const NEVER: DrawerCapabilities = {
  canInstall: false,
  canManageLinks: false,
  canExport: false,
  canRevealInFinder: false,
  canDeleteFromBank: false,
  canUnregister: false,
  canRegister: false,
  canHide: false,
  canUnhide: false,
  canUpdate: false,
  canForgetMissing: false,
  canRepoint: false,
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
  // Manage-links is only meaningful when the skill has at least one
  // installation to manage — a registered-but-uninstalled skill offers
  // Install instead. Computed up front because the origin-* arms below
  // fire before the per-installation partition (`mine`).
  const hasAnyInstallation = installed.some((i) => i.name === entry.name);

  // Bundled + dismissed short-circuits to a dedicated state. Dismiss
  // is purely a UI dormancy flag — installations and metadata are
  // preserved — so this state still allows install/remove/etc. but
  // the primary action is Unhide and Delete/Unregister are gone.
  if (isRegistered && entry.canon === true && entry.hidden === true) {
    return applyCanonGate(entry, {
      state: "bundled-skill-dismissed",
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

  // Missing files. Adopted vs. external split is just the user-facing
  // copy; today's heal flow is the same single-option "Forget this
  // entry" for both (repoint/refetch are future work).
  if (isRegistered && entry.missing === true) {
    const isExternal = entry.adopted === false;
    return {
      state: isExternal ? "external-target-missing" : "registry-folder-missing",
      brokenCount: 0,
      conflictCount: 0,
      capabilities: {
        ...NEVER,
        canRevealInFinder: true,
        canForgetMissing: true,
        // Repoint only applies to external entries; adopted-missing has
        // no external.json row to rewrite.
        canRepoint: isExternal,
        primary: isExternal ? "repoint" : "forget-missing",
      },
    };
  }

  // Drift fan-out: local content has diverged from the recorded
  // baseline. The states are still classified (origin-pointer skills →
  // `edited-with-origin`, others → `edited-without-origin`) but the
  // heal actions that used to hang off them (Keep my edits /
  // Re-baseline / Reset to origin) were removed in v1.20 (ADR-0010)
  // pending a redesign with proper source-axis semantics — both arms
  // expose only the baseline capabilities. Drift still gates one-click
  // updates: a drifted skill classifies here before the
  // origin-update-available arm below can grant `canUpdate`.
  if (isRegistered && entry.drift === true) {
    if (entry.source.origin?.kind === "github") {
      return applyCanonGate(entry, {
        state: "edited-with-origin",
        brokenCount: 0,
        conflictCount: 0,
        capabilities: {
          ...NEVER,
          canRevealInFinder: true,
          canExport: true,
          canUnregister: true,
          primary: "manage-links",
        },
      });
    }
    return applyCanonGate(entry, {
      state: "edited-without-origin",
      brokenCount: 0,
      conflictCount: 0,
      capabilities: {
        ...NEVER,
        canRevealInFinder: true,
        canExport: true,
        canUnregister: true,
        primary: "manage-links",
      },
    });
  }

  // Origin probe persistently failing. Lower priority than drift —
  // a baseline-hash mismatch implies the origin was reachable at
  // least once recently, which is a stronger signal than "we
  // couldn't reach the origin this pass." Higher priority than
  // `origin-update-available` — we can't surface an update we
  // couldn't probe for. v1.4.
  if (
    isRegistered &&
    entry.originUnreachable === true &&
    entry.source.origin?.kind === "github"
  ) {
    return applyCanonGate(entry, {
      state: "origin-unreachable",
      brokenCount: 0,
      conflictCount: 0,
      capabilities: {
        ...NEVER,
        canRevealInFinder: true,
        canInstall: !hasAnyInstallation,
        canManageLinks: hasAnyInstallation,
        canExport: true,
        canUnregister: true,
        primary: hasAnyInstallation ? "manage-links" : "install",
      },
    });
  }

  // Upstream update available with no local drift. The user can
  // apply the change in place. Drift takes priority above so this
  // arm only fires for clean local state.
  if (isRegistered && entry.originUpdateAvailable === true) {
    return applyCanonGate(entry, {
      state: "origin-update-available",
      brokenCount: 0,
      conflictCount: 0,
      capabilities: {
        ...NEVER,
        canRevealInFinder: true,
        canInstall: !hasAnyInstallation,
        canManageLinks: hasAnyInstallation,
        canExport: true,
        canUpdate: true,
        canUnregister: true,
        primary: "update",
      },
    });
  }
  // Only consider installations for THIS skill — the caller may pass
  // the full installed list, the registry view's full list, etc.
  const mine = installed.filter((i) => i.name === entry.name);
  const ours = mine.filter((i) => i.kind === "ours");
  const broken = mine.filter((i) => i.kind === "broken-symlink");
  // Foreign-symlinks that resolve to a real-directory in the same
  // group are collapsed onto that real-directory: they're the same
  // installation, just linked from multiple agent dirs. This is the
  // post-unregister steady state (one real-dir at the destination +
  // N rewritten symlinks pointing at it) and shouldn't read as
  // ambiguous to the classifier — there's exactly one canonical copy.
  const realDirs = mine.filter((i) => i.kind === "real-directory");
  const realDirPaths = new Set(realDirs.map((d) => d.linkPath));
  const foreignSymlinks = mine.filter(
    (i) => i.kind === "foreign-symlink" && !realDirPaths.has(i.target ?? ""),
  );
  const conflicts = [...realDirs, ...foreignSymlinks];

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
      // skill name and needs to pick the right copy. Route them
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
      // primary; adopt vs. symlink-mode is controlled by the global
      // `registerAdopts` setting.
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
    // `kind: "ours"` with no index entry: the installed.ts classifier
    // matched the symlink target to the registry tree but `walkSkills`
    // didn't surface a matching folder. Typically a stale pre-v0.11.3
    // layout (`skills/<name>/` directly, missed by the bucket walker)
    // or an index that hasn't been rebuilt. Treat like a foreign
    // symlink: offer Register, which the bucket-aware adopt path
    // relocates into `skills/personal/<name>/`. Skipping this branch
    // would fall into the broken-symlink catch-all below — that
    // rendered as "Fix broken link (0)" with no actionable repair.
    if (hasOurs && !hasBroken) {
      return {
        state: "unregistered-foreign",
        brokenCount: 0,
        conflictCount: 0,
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
        canManageLinks: true,
        canExport: true,
        canRevealInFinder: true,
        canDeleteFromBank: true,
        canUnregister: true,
        primary: "manage-links",
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
      // No installations yet → nothing to manage; Install is the
      // entry point. Manage links appears once links exist.
      canManageLinks: false,
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
