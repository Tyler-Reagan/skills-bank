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
  | "unregistered-broken";

export type PrimaryAction =
  | "install"
  | "remove-from-agents"
  | "register"
  | "resolve-conflicts"
  | "resolve-registration-conflicts"
  | "repair-broken";

export interface DrawerCapabilities {
  canInstall: boolean;
  canRemoveFromAgents: boolean;
  canManageLinks: boolean;
  canExport: boolean;
  canRevealInFinder: boolean;
  canDeleteFromBank: boolean;
  canRegister: boolean;
  /**
   * Foreign-symlink only: record the symlink target without moving
   * files into the bank. Mirrors RegisterModal's "Register as external"
   * option. M3 collapses this into the unified register flow.
   */
  canRegisterAsExternal: boolean;
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
  canRegister: false,
  canRegisterAsExternal: false,
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
      const onlyForeign = conflicts.every((c) => c.kind === "foreign-symlink");
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
      // Single-installation unregistered. Register-as-external is only
      // meaningful when the installation is a foreign symlink; for a
      // real directory it's nonsensical (there's nothing external to
      // track — the files live in the agent dir already).
      return {
        state: hasRealDir ? "unregistered-real" : "unregistered-foreign",
        brokenCount: broken.length,
        conflictCount: conflicts.length,
        capabilities: {
          ...NEVER,
          canRevealInFinder: true,
          canRegister: true,
          canRegisterAsExternal: onlyForeign,
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
    return {
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
        canResolveConflicts: true,
        canRepairBroken: hasBroken,
        primary: "resolve-conflicts",
      },
    };
  }

  if (hasBroken && hasOurs) {
    return {
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
        canRepairBroken: true,
        primary: "repair-broken",
      },
    };
  }

  if (hasBroken) {
    return {
      state: "registered-broken",
      brokenCount: broken.length,
      conflictCount: 0,
      capabilities: {
        ...NEVER,
        canInstall: true, // reinstall replaces broken with fresh symlinks
        canExport: true,
        canRevealInFinder: true,
        canDeleteFromBank: true,
        canRepairBroken: true,
        primary: "repair-broken",
      },
    };
  }

  if (hasOurs) {
    return {
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
        primary: "remove-from-agents",
      },
    };
  }

  // Registered but no installations of any kind.
  return {
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
      canRepairBroken: false,
      primary: "install",
    },
  };
}


