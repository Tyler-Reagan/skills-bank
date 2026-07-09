import { describe, expect, test } from "vitest";
import { classifyDrawerState } from "../skill-state.js";
import type {
  DrawerState,
  PrimaryAction,
  DrawerCapabilities,
} from "../skill-state.js";
import type { InstalledSkill, RegistryEntry } from "../types.js";

/**
 * Table-driven classifier tests. Each row pins a triple
 * (DrawerState, PrimaryAction, capability subset). Adding a new
 * state, adding a new capability flag, or shifting a state's
 * primary all fail loudly here — catches drift between this
 * classifier and the IPC enforcement layer that mirrors it.
 *
 * Capability assertions use `partial` matching: the row lists the
 * caps it cares about, the rest of `DrawerCapabilities` is unchecked.
 * This keeps rows readable while still catching regressions on the
 * load-bearing flags.
 */

const baseEntry: RegistryEntry = {
  name: "test",
  description: "test skill",
  path: "skills/test",
  origin: { url: null },
};

function entry(over: Partial<RegistryEntry> = {}): RegistryEntry {
  return { ...baseEntry, ...over };
}

function inst(over: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    name: "test",
    agent: "claude",
    linkPath: "/home/u/.claude/skills/test",
    target: "/registry/skills/test",
    kind: "ours",
    ...over,
  };
}

interface Row {
  label: string;
  entry: RegistryEntry;
  installed: InstalledSkill[];
  isRegistered: boolean;
  expectedState: DrawerState;
  expectedPrimary: PrimaryAction;
  expectedCaps: Partial<DrawerCapabilities>;
}

const ROWS: Row[] = [
  // ── Heal states ─────────────────────────────────────────
  {
    label: "missing → registry-folder-missing (Forget)",
    entry: entry({ missing: true }),
    installed: [],
    isRegistered: true,
    expectedState: "registry-folder-missing",
    expectedPrimary: "forget-missing",
    expectedCaps: { canForgetMissing: true },
  },
  {
    label: "drift + github origin → edited-with-origin",
    entry: entry({
      drift: true,
      origin: {
        url: "https://github.com/u/r",
        skillPath: "skills/test/SKILL.md",
      },
    }),
    installed: [],
    isRegistered: true,
    expectedState: "edited-with-origin",
    expectedPrimary: "install",
    expectedCaps: {
      canInstall: true,
      canManageLinks: false,
      canUnregister: true,
      canExtract: true,
      // Drift "keep my edits" (ADR-0012).
      canDetachLocal: true,
    },
  },
  {
    label:
      "drift + github origin + installed → edited-with-origin, manage-links primary",
    entry: entry({
      drift: true,
      origin: {
        url: "https://github.com/u/r",
        skillPath: "skills/test/SKILL.md",
      },
    }),
    installed: [inst()],
    isRegistered: true,
    expectedState: "edited-with-origin",
    expectedPrimary: "manage-links",
    expectedCaps: {
      canInstall: false,
      canManageLinks: true,
      canUnregister: true,
      canExtract: true,
    },
  },
  {
    label: "drift + no origin (local skill) → edited-without-origin",
    entry: entry({ drift: true, origin: { url: null } }),
    installed: [],
    isRegistered: true,
    expectedState: "edited-without-origin",
    expectedPrimary: "install",
    expectedCaps: {
      canInstall: true,
      canManageLinks: false,
      canUnregister: true,
      canExtract: true,
    },
  },
  {
    label:
      "drift + no origin + installed → edited-without-origin, manage-links primary",
    entry: entry({ drift: true, origin: { url: null } }),
    installed: [inst()],
    isRegistered: true,
    expectedState: "edited-without-origin",
    expectedPrimary: "manage-links",
    expectedCaps: {
      canInstall: false,
      canManageLinks: true,
      canUnregister: true,
      canExtract: true,
    },
  },
  {
    label: "skillUpdateAvailable + no drift → skill-update-available (Update)",
    entry: entry({ skillUpdateAvailable: true }),
    installed: [],
    isRegistered: true,
    expectedState: "skill-update-available",
    expectedPrimary: "update",
    // Uninstalled → Install offered, nothing to manage-links.
    expectedCaps: { canUpdate: true, canInstall: true, canManageLinks: false },
  },
  {
    label:
      "skillUpdateAvailable + installed → manage-links granted, install not",
    entry: entry({ skillUpdateAvailable: true }),
    installed: [inst()],
    isRegistered: true,
    expectedState: "skill-update-available",
    expectedPrimary: "update",
    expectedCaps: { canUpdate: true, canInstall: false, canManageLinks: true },
  },
  {
    label: "drift + skillUpdateAvailable → drift wins (edited-with-origin)",
    entry: entry({
      drift: true,
      skillUpdateAvailable: true,
      origin: {
        url: "https://github.com/u/r",
        skillPath: "skills/test/SKILL.md",
      },
    }),
    installed: [],
    isRegistered: true,
    expectedState: "edited-with-origin",
    expectedPrimary: "install",
    expectedCaps: { canUpdate: false, canInstall: true, canManageLinks: false },
  },
  // v1.4: origin-unreachable.
  {
    label: "originUnreachable + github origin → origin-unreachable",
    entry: entry({
      originUnreachable: true,
      origin: {
        url: "https://github.com/u/r",
        skillPath: "skills/test/SKILL.md",
      },
    }),
    installed: [],
    isRegistered: true,
    expectedState: "origin-unreachable",
    // Restore is the headline action (ADR-0012); install/manage-links
    // remain as secondary affordances.
    expectedPrimary: "restore-origin",
    expectedCaps: {
      canManageLinks: false,
      canInstall: true,
      canUnregister: true,
      canRestoreOrigin: true,
      canDetachLocal: true,
    },
  },
  {
    label:
      "originUnreachable + installed → restore-origin primary, manage-links secondary",
    entry: entry({
      originUnreachable: true,
      origin: {
        url: "https://github.com/u/r",
        skillPath: "skills/test/SKILL.md",
      },
    }),
    installed: [inst()],
    isRegistered: true,
    expectedState: "origin-unreachable",
    expectedPrimary: "restore-origin",
    expectedCaps: {
      canManageLinks: true,
      canInstall: false,
      canUnregister: true,
      canRestoreOrigin: true,
      canDetachLocal: true,
    },
  },
  {
    label:
      "originUnreachable + url: null → NOT origin-unreachable (state requires a github origin)",
    entry: entry({
      originUnreachable: true,
      origin: { url: null },
    }),
    installed: [],
    isRegistered: true,
    // Falls through to registered-available since no other state matches.
    expectedState: "registered-available",
    expectedPrimary: "install",
    expectedCaps: { canUpdate: false },
  },
  {
    label:
      "drift + originUnreachable → drift wins (drift implies reachable-recently)",
    entry: entry({
      drift: true,
      originUnreachable: true,
      origin: {
        url: "https://github.com/u/r",
        skillPath: "skills/test/SKILL.md",
      },
    }),
    installed: [],
    isRegistered: true,
    expectedState: "edited-with-origin",
    expectedPrimary: "install",
    expectedCaps: { canUpdate: false, canInstall: true, canManageLinks: false },
  },
  {
    label:
      "originUnreachable + skillUpdateAvailable → unreachable wins (can't update what we can't probe)",
    entry: entry({
      originUnreachable: true,
      skillUpdateAvailable: true,
      origin: {
        url: "https://github.com/u/r",
        skillPath: "skills/test/SKILL.md",
      },
    }),
    installed: [],
    isRegistered: true,
    expectedState: "origin-unreachable",
    expectedPrimary: "restore-origin",
    expectedCaps: {
      canManageLinks: false,
      canUpdate: false,
      canRestoreOrigin: true,
    },
  },

  // ── Unregistered branch ─────────────────────────────────
  {
    label: "unregistered + 1 real-dir → unregistered (Register)",
    entry: entry(),
    installed: [inst({ kind: "real-directory", target: null })],
    isRegistered: false,
    expectedState: "unregistered",
    expectedPrimary: "register",
    expectedCaps: { canRegister: true },
  },
  {
    label: "unregistered + 1 foreign-symlink → unregistered (Register)",
    entry: entry(),
    installed: [inst({ kind: "foreign-symlink", target: "/elsewhere/test" })],
    isRegistered: false,
    expectedState: "unregistered",
    expectedPrimary: "register",
    expectedCaps: { canRegister: true },
  },
  {
    label: "unregistered + 2 non-ours installs → unregistered-conflicts",
    entry: entry(),
    installed: [
      inst({ kind: "real-directory", target: null }),
      inst({
        agent: "cursor",
        linkPath: "/home/u/.cursor/skills/test",
        kind: "foreign-symlink",
        target: "/elsewhere/test",
      }),
    ],
    isRegistered: false,
    expectedState: "unregistered-conflicts",
    expectedPrimary: "resolve-registration-conflicts",
    expectedCaps: { canResolveRegistrationConflicts: true },
  },
  {
    label:
      "unregistered + foreign collapses onto sibling real-dir → unregistered (one install)",
    entry: entry(),
    installed: [
      inst({
        kind: "real-directory",
        target: null,
        linkPath: "/home/u/.claude/skills/test",
      }),
      inst({
        agent: "cursor",
        linkPath: "/home/u/.cursor/skills/test",
        kind: "foreign-symlink",
        target: "/home/u/.claude/skills/test",
      }),
    ],
    isRegistered: false,
    expectedState: "unregistered",
    expectedPrimary: "register",
    expectedCaps: { canRegister: true },
  },
  {
    label: "unregistered + only broken → unregistered-broken (Repair)",
    entry: entry(),
    installed: [inst({ kind: "broken-symlink", target: null })],
    isRegistered: false,
    expectedState: "unregistered-broken",
    expectedPrimary: "repair-broken",
    expectedCaps: { canRepairBroken: true },
  },
  {
    // Regression: pre-v0.11.3 adopt path placed files at
    // `skills/<name>/`, which walkSkills skips. The symlink target
    // resolved inside the registry → installed classified `ours`,
    // but `isRegistered` was false → fell into `unregistered-broken`
    // with brokenCount=0 ("Fix broken link (0)"). Branch added above
    // routes this to `unregistered` so Register is offered.
    label: "unregistered + ours (no index entry) → unregistered (Register)",
    entry: entry(),
    installed: [inst()],
    isRegistered: false,
    expectedState: "unregistered",
    expectedPrimary: "register",
    expectedCaps: { canRegister: true },
  },

  // ── Registered branch ──────────────────────────────────
  {
    label: "registered + clean ours → registered-healthy (ManageLinks)",
    entry: entry(),
    installed: [inst()],
    isRegistered: true,
    expectedState: "registered-healthy",
    expectedPrimary: "manage-links",
    expectedCaps: {
      canManageLinks: true,
      canUnregister: true,
      canDeleteFromBank: true,
    },
  },
  {
    label: "registered + no installs → registered-available (Install)",
    entry: entry(),
    installed: [],
    isRegistered: true,
    expectedState: "registered-available",
    expectedPrimary: "install",
    // No installations → Manage agent links is withheld; Install is
    // the entry point.
    expectedCaps: { canInstall: true, canManageLinks: false },
  },
  {
    label:
      "registered + conflict (non-ours real-dir) → registered-conflicts (Resolve)",
    entry: entry(),
    installed: [inst({ kind: "real-directory", target: null })],
    isRegistered: true,
    expectedState: "registered-conflicts",
    expectedPrimary: "resolve-conflicts",
    expectedCaps: { canResolveConflicts: true },
  },
  {
    label: "registered + only broken → registered-broken (Repair)",
    entry: entry(),
    installed: [inst({ kind: "broken-symlink", target: null })],
    isRegistered: true,
    expectedState: "registered-broken",
    expectedPrimary: "repair-broken",
    expectedCaps: { canRepairBroken: true, canInstall: true },
  },
  {
    label:
      "registered + ours + broken sibling → registered-mixed-broken (Repair, no Install)",
    entry: entry(),
    installed: [
      inst(),
      inst({
        agent: "cursor",
        linkPath: "/home/u/.cursor/skills/test",
        kind: "broken-symlink",
        target: null,
      }),
    ],
    isRegistered: true,
    expectedState: "registered-mixed-broken",
    expectedPrimary: "repair-broken",
    expectedCaps: { canRepairBroken: true, canInstall: false },
  },
];

describe("classifyDrawerState", () => {
  for (const row of ROWS) {
    test(row.label, () => {
      const result = classifyDrawerState(
        row.entry,
        row.installed,
        row.isRegistered,
      );
      expect(result.state).toBe(row.expectedState);
      expect(result.capabilities.primary).toBe(row.expectedPrimary);
      for (const [k, v] of Object.entries(row.expectedCaps)) {
        expect(result.capabilities[k as keyof DrawerCapabilities]).toBe(v);
      }
    });
  }
});
