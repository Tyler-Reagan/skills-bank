import { describe, expect, test } from "vitest";
import { classifyDrawerState } from "./skill-state.js";
import type {
  DrawerState,
  PrimaryAction,
  DrawerCapabilities,
} from "./skill-state.js";
import type { InstalledSkill, RegistryEntry } from "./types.js";

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
  source: { source: "user" },
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
    label: "bundled + hidden → bundled-skill-dismissed (Unhide)",
    entry: entry({ canon: true, hidden: true }),
    installed: [],
    isRegistered: true,
    expectedState: "bundled-skill-dismissed",
    expectedPrimary: "unhide",
    // applyCanonGate sets canHide:true on every canon classification —
    // this state inherits it. The UI gates on canUnhide for the
    // primary CTA, so the redundant canHide is harmless. Pin it here
    // so a future tightening of canon-gate semantics has to confront
    // the choice instead of silently changing.
    expectedCaps: { canUnhide: true, canHide: true },
  },
  {
    label: "adopted + missing → registry-folder-missing (Forget)",
    entry: entry({ missing: true, adopted: true }),
    installed: [],
    isRegistered: true,
    expectedState: "registry-folder-missing",
    expectedPrimary: "forget-missing",
    expectedCaps: { canForgetMissing: true, canRepoint: false },
  },
  {
    label: "external + missing → external-target-missing (Repoint)",
    entry: entry({ missing: true, adopted: false }),
    installed: [],
    isRegistered: true,
    expectedState: "external-target-missing",
    expectedPrimary: "repoint",
    expectedCaps: { canForgetMissing: true, canRepoint: true },
  },
  {
    label:
      "drift + upstream-github → edited-with-origin (Accept/TakeUpstream)",
    entry: entry({
      drift: true,
      source: {
        source: "user",
        origin: {
          kind: "github",
          repo: "u/r",
          sourceUrl: "https://github.com/u/r",
          skillPath: "skills/test/SKILL.md",
        },
      },
    }),
    installed: [],
    isRegistered: true,
    expectedState: "edited-with-origin",
    expectedPrimary: "accept-drift",
    expectedCaps: { canAcceptDrift: true, canResetToOrigin: true },
  },
  {
    label:
      "drift + bundled-no-upstream → edited-without-origin (Accept/TakeCanonical)",
    entry: entry({ drift: true, source: { source: "curated" } }),
    installed: [],
    isRegistered: true,
    expectedState: "edited-without-origin",
    expectedPrimary: "accept-drift",
    expectedCaps: { canAcceptDrift: true, canTakeCanonical: true },
  },
  {
    label:
      "drift + bundled + upstream → upstream branch (upstream is more specific)",
    entry: entry({
      drift: true,
      source: {
        source: "curated",
        origin: {
          kind: "github",
          repo: "u/r",
          sourceUrl: "https://github.com/u/r",
          skillPath: "skills/test/SKILL.md",
        },
      },
    }),
    installed: [],
    isRegistered: true,
    expectedState: "edited-with-origin",
    expectedPrimary: "accept-drift",
    expectedCaps: { canResetToOrigin: true, canTakeCanonical: false },
  },
  {
    label:
      "originUpdateAvailable + no drift → origin-update-available (Update)",
    entry: entry({ originUpdateAvailable: true }),
    installed: [],
    isRegistered: true,
    expectedState: "origin-update-available",
    expectedPrimary: "update",
    expectedCaps: { canUpdate: true, canAcceptDrift: false },
  },
  {
    label:
      "drift + originUpdateAvailable → drift wins (edited-with-origin)",
    entry: entry({
      drift: true,
      originUpdateAvailable: true,
      source: {
        source: "user",
        origin: {
          kind: "github",
          repo: "u/r",
          sourceUrl: "https://github.com/u/r",
          skillPath: "skills/test/SKILL.md",
        },
      },
    }),
    installed: [],
    isRegistered: true,
    expectedState: "edited-with-origin",
    expectedPrimary: "accept-drift",
    expectedCaps: { canUpdate: false },
  },
  // v1.4: origin-unreachable.
  {
    label: "originUnreachable + github origin → origin-unreachable",
    entry: entry({
      originUnreachable: true,
      source: {
        source: "user",
        origin: {
          kind: "github",
          repo: "u/r",
          skillPath: "skills/test/SKILL.md",
        },
      },
    }),
    installed: [],
    isRegistered: true,
    expectedState: "origin-unreachable",
    expectedPrimary: "retry-probe",
    expectedCaps: {
      canRetryOriginProbe: true,
      canAcceptDrift: true,
    },
  },
  {
    label:
      "originUnreachable + origin.kind === none → NOT origin-unreachable (state requires github)",
    entry: entry({
      originUnreachable: true,
      source: { source: "user", origin: { kind: "none" } },
    }),
    installed: [],
    isRegistered: true,
    // Falls through to registered-available since no other state matches.
    expectedState: "registered-available",
    expectedPrimary: "install",
    expectedCaps: { canRetryOriginProbe: false },
  },
  {
    label:
      "drift + originUnreachable → drift wins (drift implies reachable-recently)",
    entry: entry({
      drift: true,
      originUnreachable: true,
      source: {
        source: "user",
        origin: {
          kind: "github",
          repo: "u/r",
          skillPath: "skills/test/SKILL.md",
        },
      },
    }),
    installed: [],
    isRegistered: true,
    expectedState: "edited-with-origin",
    expectedPrimary: "accept-drift",
    expectedCaps: { canRetryOriginProbe: false },
  },
  {
    label:
      "originUnreachable + originUpdateAvailable → unreachable wins (can't update what we can't probe)",
    entry: entry({
      originUnreachable: true,
      originUpdateAvailable: true,
      source: {
        source: "user",
        origin: {
          kind: "github",
          repo: "u/r",
          skillPath: "skills/test/SKILL.md",
        },
      },
    }),
    installed: [],
    isRegistered: true,
    expectedState: "origin-unreachable",
    expectedPrimary: "retry-probe",
    expectedCaps: { canRetryOriginProbe: true, canUpdate: false },
  },

  // ── Unregistered branch ─────────────────────────────────
  {
    label: "unregistered + 1 real-dir → unregistered-real (Register)",
    entry: entry(),
    installed: [
      inst({ kind: "real-directory", target: null }),
    ],
    isRegistered: false,
    expectedState: "unregistered-real",
    expectedPrimary: "register",
    expectedCaps: { canRegister: true },
  },
  {
    label:
      "unregistered + 1 foreign-symlink → unregistered-foreign (Register)",
    entry: entry(),
    installed: [
      inst({ kind: "foreign-symlink", target: "/elsewhere/test" }),
    ],
    isRegistered: false,
    expectedState: "unregistered-foreign",
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
      "unregistered + foreign collapses onto sibling real-dir → unregistered-real (one install)",
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
    expectedState: "unregistered-real",
    expectedPrimary: "register",
    expectedCaps: { canRegister: true },
  },
  {
    label: "unregistered + only broken → unregistered-broken (Repair)",
    entry: entry(),
    installed: [
      inst({ kind: "broken-symlink", target: null }),
    ],
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
    // routes this to `unregistered-foreign` so Register is offered.
    label: "unregistered + ours (no index entry) → unregistered-foreign (Register)",
    entry: entry(),
    installed: [inst()],
    isRegistered: false,
    expectedState: "unregistered-foreign",
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
    expectedCaps: { canInstall: true },
  },
  {
    label:
      "registered + conflict (non-ours real-dir) → registered-conflicts (Resolve)",
    entry: entry(),
    installed: [
      inst({ kind: "real-directory", target: null }),
    ],
    isRegistered: true,
    expectedState: "registered-conflicts",
    expectedPrimary: "resolve-conflicts",
    expectedCaps: { canResolveConflicts: true },
  },
  {
    label: "registered + only broken → registered-broken (Repair)",
    entry: entry(),
    installed: [
      inst({ kind: "broken-symlink", target: null }),
    ],
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

  // ── Canon protection (applyCanonGate) ──────────────────
  {
    label:
      "registered + healthy + canon → Unregister/Delete swapped for Hide",
    entry: entry({ canon: true }),
    installed: [inst()],
    isRegistered: true,
    expectedState: "registered-healthy",
    expectedPrimary: "manage-links",
    expectedCaps: {
      canHide: true,
      canUnregister: false,
      canDeleteFromBank: false,
    },
  },
  {
    label: "registered + conflicts + canon → Hide instead of Delete",
    entry: entry({ canon: true }),
    installed: [
      inst({ kind: "real-directory", target: null }),
    ],
    isRegistered: true,
    expectedState: "registered-conflicts",
    expectedPrimary: "resolve-conflicts",
    expectedCaps: {
      canHide: true,
      canDeleteFromBank: false,
      canResolveConflicts: true,
    },
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
