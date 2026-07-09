// Pure classifier — no node imports. The renderer pulls this in via
// the `@skills-bank/core/skill-state` subpath; importing from the main
// barrel would transitively load `node:child_process` (build.ts) and
// blow up the browser-target vite build.
import type { InstalledSkill, RegistryEntry } from "./types.js";
import { isGithubUrl } from "../github/url.js";

/**
 * Discrete states a skill can be in. Derived from the taxonomy axes
 * (Registered, Adopted, Installed) plus the on-disk installation
 * kinds. Drives which actions are valid, which are no-ops, and which
 * would make the state worse — for both renderer UI gating and
 * IPC-level enforcement.
 *
 * State names align with user-facing copy where the state is surfaced
 * in the drawer (e.g. `edited-without-origin` matches the "You've
 * edited this skill" heading). Internal-only states keep their
 * composite shape.
 */
export type DrawerState =
  | "registered-healthy"
  | "registered-available"
  | "registered-conflicts"
  | "registered-broken"
  | "registered-mixed-broken"
  | "unregistered"
  | "unregistered-conflicts"
  | "unregistered-broken"
  // Heal states:
  | "edited-without-origin"
  | "edited-with-origin"
  | "skill-update-available"
  | "origin-unreachable"
  | "registry-folder-missing";

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
  | "update"
  | "forget-missing"
  | "restore-origin";

export interface DrawerCapabilities {
  canInstall: boolean;
  canManageLinks: boolean;
  canExtract: boolean;
  canRevealInFinder: boolean;
  /**
   * Deletion of registered skills routes through Unregister first,
   * then the inline Delete on Unregistered cards
   * (`deleteUnregisteredSkill`). Kept in the capability surface for
   * non-UI consumers (CLI / IPC enforcement layer).
   */
  canDeleteFromBank: boolean;
  /**
   * Mid-tier destructive action. Move the skill's files to the
   * configured agents dir, then drop the manifest row. Co-varies with
   * canDeleteFromBank.
   */
  canUnregister: boolean;
  canRegister: boolean;
  /**
   * `skill-update-available` heal — apply the upstream change in
   * place. Runs `npx skills update <name>`; the new content replaces
   * the on-disk skill and the baseline hash is re-snapshotted.
   */
  canUpdate: boolean;
  /**
   * Forget a missing entry (`registry-folder-missing`) — the folder
   * under skills/ is gone; drop the lingering manifest row so the entry
   * stops being surfaced.
   */
  canForgetMissing: boolean;
  /**
   * Restore an unreachable origin (ADR-0012). Opens the restore modal
   * offering two human-driven paths — repoint to a new GitHub URL, or
   * re-home the skill into the linked repo via a PR. Granted only in
   * `origin-unreachable`.
   */
  canRestoreOrigin: boolean;
  /**
   * Sever an origin and rehome the skill locally (`detachOrigin`). The
   * drift "keep my edits" action on `edited-with-origin`; also reachable
   * from the restore modal as the "upstream is gone, keep it local"
   * escape.
   */
  canDetachLocal: boolean;
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

const NEVER: DrawerCapabilities = {
  canInstall: false,
  canManageLinks: false,
  canExtract: false,
  canRevealInFinder: false,
  canDeleteFromBank: false,
  canUnregister: false,
  canRegister: false,
  canUpdate: false,
  canForgetMissing: false,
  canRestoreOrigin: false,
  canDetachLocal: false,
  canResolveConflicts: false,
  canResolveRegistrationConflicts: false,
  canRepairBroken: false,
  primary: "install",
};

export function classifyDrawerState(
  entry: RegistryEntry,
  installed: InstalledSkill[],
  isRegistered: boolean,
): DrawerStateClassification {
  // Manage-links is only meaningful when the skill has at least one
  // installation to manage — a registered-but-uninstalled skill offers
  // Install instead. Computed up front because the origin-* arms below
  // fire before the per-installation partition (`mine`).
  const hasAnyInstallation = installed.some((i) => i.name === entry.name);

  // Missing files: the skill's folder under skills/ is gone. Single
  // heal option — Forget this entry (drops the lingering manifest row).
  if (isRegistered && entry.missing === true) {
    return {
      state: "registry-folder-missing",
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

  // Drift fan-out: local content has diverged from the recorded
  // baseline. The states are still classified (origin-pointer skills →
  // `edited-with-origin`, others → `edited-without-origin`) but the
  // heal actions that used to hang off them (Keep my edits /
  // Re-baseline / Reset to origin) were removed in v1.20
  // pending a redesign with proper source-axis semantics — both arms
  // expose only the baseline capabilities. Drift still gates one-click
  // updates: a drifted skill classifies here before the
  // skill-update-available arm below can grant `canUpdate`.
  if (isRegistered && entry.drift === true) {
    if (isGithubUrl(entry.origin.url)) {
      return {
        state: "edited-with-origin",
        brokenCount: 0,
        conflictCount: 0,
        capabilities: {
          ...NEVER,
          canRevealInFinder: true,
          canInstall: !hasAnyInstallation,
          canManageLinks: hasAnyInstallation,
          // Drift "keep my edits": sever the origin and rehome local.
          canDetachLocal: true,
          canExtract: true,
          canUnregister: true,
          primary: hasAnyInstallation ? "manage-links" : "install",
        },
      };
    }
    return {
      state: "edited-without-origin",
      brokenCount: 0,
      conflictCount: 0,
      capabilities: {
        ...NEVER,
        canRevealInFinder: true,
        canInstall: !hasAnyInstallation,
        canManageLinks: hasAnyInstallation,
        canExtract: true,
        canUnregister: true,
        primary: hasAnyInstallation ? "manage-links" : "install",
      },
    };
  }

  // Origin probe persistently failing. Lower priority than drift —
  // a baseline-hash mismatch implies the origin was reachable at
  // least once recently, which is a stronger signal than "we
  // couldn't reach the origin this pass." Higher priority than
  // `skill-update-available` — we can't surface an update we
  // couldn't probe for. v1.4.
  if (
    isRegistered &&
    entry.originUnreachable === true &&
    isGithubUrl(entry.origin.url)
  ) {
    return {
      state: "origin-unreachable",
      brokenCount: 0,
      conflictCount: 0,
      capabilities: {
        ...NEVER,
        canRevealInFinder: true,
        canInstall: !hasAnyInstallation,
        canManageLinks: hasAnyInstallation,
        // Restore is the headline action: opens the modal offering
        // repoint (new URL) or adopt-into-linked-repo (PR), with
        // detach-to-local as the escape (ADR-0012).
        canRestoreOrigin: true,
        canDetachLocal: true,
        canExtract: true,
        canUnregister: true,
        primary: "restore-origin",
      },
    };
  }

  // Upstream update available with no local drift. The user can
  // apply the change in place. Drift takes priority above so this
  // arm only fires for clean local state.
  if (isRegistered && entry.skillUpdateAvailable === true) {
    return {
      state: "skill-update-available",
      brokenCount: 0,
      conflictCount: 0,
      capabilities: {
        ...NEVER,
        canRevealInFinder: true,
        canInstall: !hasAnyInstallation,
        canManageLinks: hasAnyInstallation,
        canExtract: true,
        canUpdate: true,
        canUnregister: true,
        primary: "update",
      },
    };
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
    // (move the skill's files into the bank). Skills with no usable
    // source on disk can't be registered — dead symlink, repair-or-delete.
    if (hasConflicts) {
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
      // Single-installation unregistered. Register moves the skill's
      // files into the bank (ADR-0022).
      return {
        state: "unregistered",
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
    // or an index that hasn't been rebuilt. Offer Register, which
    // relocates it into `skills/personal/<name>/`. Skipping this branch
    // would fall into the broken-symlink catch-all below — that
    // rendered as "Fix broken link (0)" with no actionable repair.
    if (hasOurs && !hasBroken) {
      return {
        state: "unregistered",
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
    return {
      state: "registered-conflicts",
      brokenCount: broken.length,
      conflictCount: conflicts.length,
      capabilities: {
        ...NEVER,
        canInstall: true, // secondary; will route to InstallConflictModal
        canManageLinks: true,
        canExtract: true,
        canRevealInFinder: true,
        canDeleteFromBank: true,
        canUnregister: true,
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
        canManageLinks: true,
        canExtract: true,
        canRevealInFinder: true,
        canDeleteFromBank: true,
        canUnregister: true,
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
        canExtract: true,
        canRevealInFinder: true,
        canDeleteFromBank: true,
        canUnregister: true,
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
        canManageLinks: true,
        canExtract: true,
        canRevealInFinder: true,
        canDeleteFromBank: true,
        canUnregister: true,
        primary: "manage-links",
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
      // No installations yet → nothing to manage; Install is the
      // entry point. Manage links appears once links exist.
      canManageLinks: false,
      canExtract: true,
      canRevealInFinder: true,
      canDeleteFromBank: true,
      canUnregister: true,
      canRepairBroken: false,
      primary: "install",
    },
  };
}
