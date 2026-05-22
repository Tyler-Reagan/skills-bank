import React from "react";
import type { AgentId, InstalledSkill, RegistryEntry } from "@skills-bank/core";
// Renderer-only subpath import — the main barrel transitively pulls
// `build.ts` which imports `node:child_process` and blows up the
// vite browser build. See `components/skillState.ts` for the shim.
import { classifyDrawerState } from "./skillState.js";
import type {
  AuthStatus,
  OriginManualChoice,
  OriginUpdateResult,
} from "../../shared/ipc.js";
import { SkillDetailDrawer } from "./SkillDetailDrawer.js";
import { useRegistryHost } from "../RegistryHostContext.js";
import type { AppSettings } from "./SettingsModal.js";

interface Props {
  /** Currently-selected entry (drawer is mounted when non-null). */
  selected: RegistryEntry | null;
  /** Close the drawer (clears selection). */
  onClose: () => void;
  /** Pre-built name → entry map. */
  registryByName: Map<string, RegistryEntry>;
  /** Full installed list (drawer filters internally). */
  installed: InstalledSkill[];
  /** Registry root (passed through to the drawer for path rendering). */
  registryRoot: string | null;
  /** App-level settings (drawer reads showOriginActivity / defaultInstallAgents / etc.). */
  settings: AppSettings;
  /** Auth state — drawer gates the upstream-activity strip on whether the user is signed in. */
  authStatus: AuthStatus | null;
  /** Re-fetch the registry after a state-changing action. */
  refresh: () => Promise<unknown>;
  /** Centralized handler for the three Update result paths. */
  onUpdateResult: (r: OriginUpdateResult) => void;
  /** Open the per-skill ManageLinks modal. */
  onOpenManageLinks: (target: {
    name: string;
    installations: InstalledSkill[];
  }) => void;
  /** Open the conflict resolver. */
  onOpenConflicts: (target: {
    name: string;
    conflicts: InstalledSkill[];
    allowReplaceWithSymlink: boolean;
  }) => void;
  /** Surface an install-conflict structured error. */
  onInstallConflict: (payload: {
    name: string;
    errors: import("./InstallConflictModal.js").InstallConflictError[];
  }) => void;
  /** Persist the "user has seen the unregister-destination hint" bit. */
  unregisterHintShown: () => boolean;
  markUnregisterHintShown: () => void;
}

/**
 * v0.11.6 M3 extraction: the giant IIFE that wrapped `<SkillDetailDrawer>`
 * in `App.tsx` (capability-gated callbacks for every action the drawer
 * surfaces). Moved here verbatim so the drawer's wiring lives next to
 * the drawer itself.
 *
 * Cross-host coordination (opening Manage Links, the conflict resolver,
 * the install-conflict modal) is wired via explicit callback props
 * rather than context — those modals' state belongs to their own
 * eventual hosts (`<ConflictHost>` in the same plan), and threading
 * them through this component is the cleanest seam until that host
 * lands.
 *
 * Toast + error surfaces come from `useRegistryHost()` (M2 context),
 * not props — they're cross-cutting.
 */
export function DrawerHost({
  selected,
  onClose,
  registryByName,
  installed,
  registryRoot,
  settings,
  authStatus,
  refresh,
  onUpdateResult,
  onOpenManageLinks,
  onOpenConflicts,
  onInstallConflict,
  unregisterHintShown,
  markUnregisterHintShown,
}: Props): React.ReactElement | null {
  const { flash, pushAppError } = useRegistryHost();
  if (!selected) return null;
  const isRegistered = registryByName.has(selected.name);
  const installations = installed.filter((i) => i.name === selected.name);
  // Classifier is non-trivial (full installation partition + capability
  // fan-out). Compute once per render rather than 10× inline per drawer-
  // prop callback.
  const classification = classifyDrawerState(selected, installed, isRegistered);
  const caps = classification.capabilities;

  return (
    <SkillDetailDrawer
      entry={selected}
      installed={installed}
      registryRoot={registryRoot}
      isRegistered={isRegistered}
      defaultInstallAgents={
        settings.defaultInstallAgents.length > 0
          ? settings.defaultInstallAgents
          : undefined
      }
      showOriginActivity={
        settings.showOriginActivity && Boolean(authStatus?.user)
      }
      linkedRepoName={authStatus?.linkedRepo?.fullName ?? null}
      onSetManualUpstream={async (choice: OriginManualChoice) => {
        const r = await window.skillsBank.originSetManual(
          selected.name,
          choice,
        );
        flash(r.message);
        if (r.ok) await refresh();
        return r;
      }}
      onClose={onClose}
      onChanged={async (msg) => {
        flash(msg);
        await refresh();
      }}
      onInstallConflict={(payload) => onInstallConflict(payload)}
      onManageLinks={() => {
        onOpenManageLinks({ name: selected.name, installations });
        onClose();
      }}
      onResolveConflicts={() => {
        // Same level-pure routing as the InstalledTab path: unregistered
        // skills get delete/keep only, including broken stragglers;
        // registered skills get the full three-action picker excluding
        // broken (Repair handles those).
        const conflicts = isRegistered
          ? installations.filter(
              (i) => i.kind !== "ours" && i.kind !== "broken-symlink",
            )
          : installations.filter((i) => i.kind !== "ours");
        if (conflicts.length === 0) return;
        onOpenConflicts({
          name: selected.name,
          conflicts,
          allowReplaceWithSymlink: isRegistered,
        });
        onClose();
      }}
      onRegister={
        caps.canRegister
          ? async () => {
              const results = await window.skillsBank.register([
                {
                  name: selected.name,
                  action: {
                    type: "register",
                    name: selected.name,
                    adopt: settings.registerAdopts,
                  },
                },
              ]);
              const r = results[0]!;
              flash(r.message);
              if (r.ok) onClose();
              await refresh();
            }
          : undefined
      }
      onAcceptDrift={
        caps.canAcceptDrift
          ? async () => {
              const r = await window.skillsBank.acceptDrift(selected.name);
              flash(r.message);
              if (r.ok) onClose();
              await refresh();
            }
          : undefined
      }
      onTakeCanonical={
        caps.canTakeCanonical
          ? async () => {
              const r = await window.skillsBank.takeCanonical(selected.name);
              flash(r.message);
              if (r.ok) onClose();
              await refresh();
            }
          : undefined
      }
      onTakeUpstream={
        caps.canResetToOrigin
          ? async () => {
              const r = await window.skillsBank.originUpdate(selected.name);
              onUpdateResult(r);
              if (r.ok) onClose();
              await refresh();
            }
          : undefined
      }
      onUpdate={
        caps.canUpdate
          ? async () => {
              const r = await window.skillsBank.originUpdate(selected.name);
              onUpdateResult(r);
              await refresh();
            }
          : undefined
      }
      onForgetMissing={
        caps.canForgetMissing
          ? async () => {
              const r = await window.skillsBank.forgetMissing(selected.name);
              flash(r.message);
              if (r.ok) onClose();
              await refresh();
            }
          : undefined
      }
      onRepoint={
        caps.canRepoint
          ? async () => {
              const r = await window.skillsBank.repointExternal(selected.name);
              if (r.message !== "cancelled") flash(r.message);
              if (r.ok) await refresh();
            }
          : undefined
      }
      onHide={
        caps.canHide
          ? async () => {
              const r = await window.skillsBank.hide(selected.name);
              flash(r.message);
              if (r.ok) onClose();
              await refresh();
            }
          : undefined
      }
      onUnhide={
        caps.canUnhide
          ? async () => {
              const r = await window.skillsBank.unhide(selected.name);
              flash(r.message);
              if (r.ok) onClose();
              await refresh();
            }
          : undefined
      }
      onUnregister={
        caps.canUnregister
          ? async () => {
              // Remove-from-registry is a terminating action for this
              // surface — close the drawer up-front so the result
              // (toast or ErrorPanel) is the only thing the user has
              // to read.
              const name = selected.name;
              onClose();
              const r = await window.skillsBank.unregister(
                name,
                settings.unregisterDestinationAgent as AgentId,
              );
              if (r.ok && r.wasAdopted) {
                // First-run hint about the destination setting. Surface
                // once per machine — subsequent unregistrations just
                // toast the move.
                if (!unregisterHintShown()) {
                  flash(
                    `${r.message} — change the destination in Settings → Unregister destination.`,
                  );
                  markUnregisterHintShown();
                } else {
                  flash(r.message);
                }
              } else if (r.error) {
                // Structured failure — route to the persistent
                // ErrorPanel so the user can see details, copy, and
                // act on a suggestedAction.
                pushAppError(r.error);
              } else {
                flash(r.message);
              }
              await refresh();
            }
          : undefined
      }
    />
  );
}
