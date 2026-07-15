import React, { useCallback } from "react";
import type { AgentId, InstalledSkill, RegistryEntry } from "@skills-bank/core";
import { RegistrationPlanModal } from "./RegistrationPlanModal.js";
import { ManageLinksModal } from "./ManageLinksModal.js";
import { InstallCollisionModal } from "./InstallCollisionModal.js";
import { InstallConflictModal } from "./InstallConflictModal.js";
import type { InstallConflictError } from "./InstallConflictModal.js";
import { ManifestConflictModal } from "./ManifestConflictModal.js";
import { ResolveAllConflictsModal } from "./ResolveAllConflictsModal.js";
import { DeleteUnregisteredDialog } from "./DeleteUnregisteredDialog.js";
import { SettingsModal } from "./SettingsModal.js";
import { KeyboardShortcutsOverlay } from "./KeyboardShortcutsOverlay.js";
import { AccountModal } from "./AccountModal.js";
import { ManifestModal } from "./manifest/ManifestModal.js";
import { ConnectGithubModal } from "./ConnectGithubModal.js";
import { SkillUpdatesModal } from "./SkillUpdatesModal.js";
import { AppUpdateNotesModal } from "./AppUpdateNotesModal.js";
import { RepoPickerModal } from "./RepoPickerModal.js";
import { DestinationPickerDialog } from "./DestinationPickerDialog.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { ManageLabelsModal } from "./ManageLabelsModal.js";
import { BulkInstallModal } from "./BulkInstallModal.js";
import { SkillDetailDrawer, type ReviewContext } from "./SkillDetailDrawer.js";
// Renderer-only subpath import — the main barrel transitively pulls
// `build.ts` which imports `node:child_process` and blows up the
// vite browser build. See `components/skillState.ts` for the shim.
import { classifyDrawerState } from "./skillState.js";
import {
  selectResolvableConflicts,
  type InstalledGroup,
} from "./installedGrouping.js";
import { useRegistry } from "../RegistryContext.js";
import { useRegisterSkill } from "../useRegisterSkill.js";
import { useSettings } from "../SettingsContext.js";
import { useRegistryHost } from "../RegistryHostContext.js";
import type {
  AppUpdateStatus,
  AuthStatus,
  OriginManualChoice,
  SkillUpdateResult,
} from "../../shared/ipc.js";

/**
 * Every mutually-exclusive modal AppContent can show. One at a time —
 * see useModalRouter. The drawer (`selected`) and the bulk resolve-all
 * flow keep their own state because they can overlay a modal or carry
 * multi-step state.
 */
export type ActiveModal =
  | { kind: "register" }
  | { kind: "settings" }
  | { kind: "shortcuts" }
  | { kind: "account" }
  | { kind: "connectGithub" }
  | { kind: "updates" }
  | { kind: "repoPicker" }
  | { kind: "updateNotes" }
  | { kind: "manifest"; mode: "import" | "export" }
  | {
      kind: "manageLinks";
      target: { name: string; installations: InstalledSkill[] };
    }
  | {
      kind: "conflict";
      target: {
        name: string;
        conflicts: InstalledSkill[];
        /**
         * False when resolving conflicts for an unregistered skill —
         * hides "Replace with symlink to registry" (no registry copy to
         * point at) and defaults each per-installation pick to delete.
         */
        allowReplaceWithSymlink: boolean;
      };
    }
  | {
      kind: "installConflict";
      target: { name: string; errors: InstallConflictError[] };
    }
  | {
      kind: "delete";
      target: { name: string; installations: InstalledSkill[] };
    }
  | {
      kind: "manifestConflict";
      target: {
        conflicts: import("@skills-bank/core").ManifestConflict[];
      };
    }
  | {
      kind: "pickDestination";
      target: { errorId: number; name: string; currentDestination: AgentId };
    }
  | {
      kind: "overwrite";
      target: { errorId: number; name: string; destDir: string };
    }
  | {
      kind: "removeFromRegistry";
      target: { errorId: number; name: string };
    }
  | {
      kind: "bulkRepair";
      target: {
        repaired: number;
        unrepairable: Array<{
          name: string;
          entries: Array<{ agent: string; linkPath: string }>;
        }>;
      };
    }
  | { kind: "manageLabels" }
  | { kind: "bulkInstall" };

interface Props {
  modal: ActiveModal | null;
  openModal: (m: ActiveModal) => void;
  closeModal: () => void;
  authStatus: AuthStatus | null;
  setAuthStatus: (s: AuthStatus | null) => void;
  selected: RegistryEntry | null;
  setSelected: (e: RegistryEntry | null) => void;
  importingManifest: boolean;
  cancelManifestImport: () => void;
  importLinkedRepo: () => Promise<void>;
  latestAppUpdateStatus: AppUpdateStatus | null;
  setDismissedAppUpdateVersion: (v: string | null) => void;
  resolveAllTarget: InstalledGroup[] | null;
  setResolveAllTarget: (v: InstalledGroup[] | null) => void;
  checkForAppUpdates: () => void;
  unregisterHintShown: () => boolean;
  markUnregisterHintShown: () => void;
  reviewContext?: ReviewContext | null;
}

/**
 * Owns the render of every modal + the detail drawer. Extracted from
 * AppContent to keep the modal block (formerly ~660 inline lines) out
 * of the main app render. Pulls registry/settings/host state from
 * context; receives shared cross-cutting state as props.
 */
export function ModalHost({
  modal,
  openModal,
  closeModal,
  authStatus,
  setAuthStatus,
  selected,
  setSelected,
  importingManifest,
  cancelManifestImport,
  importLinkedRepo,
  latestAppUpdateStatus,
  setDismissedAppUpdateVersion,
  resolveAllTarget,
  setResolveAllTarget,
  checkForAppUpdates,
  unregisterHintShown,
  markUnregisterHintShown,
  reviewContext,
}: Props): React.ReactElement {
  const { registry, installed, pendingSkillUpdates, refresh } = useRegistry();
  const { settings, saveSettings } = useSettings();
  const { flash, flashError, dismissToast, pushAppError, dismissAppError } =
    useRegistryHost();

  const pickDestinationTarget =
    modal?.kind === "pickDestination" ? modal.target : null;
  const overwriteTarget = modal?.kind === "overwrite" ? modal.target : null;
  const removeFromRegistryTarget =
    modal?.kind === "removeFromRegistry" ? modal.target : null;
  const bulkRepairPrompt = modal?.kind === "bulkRepair" ? modal.target : null;

  const handleUpdateResult = useCallback(
    (r: SkillUpdateResult) => {
      if (r.ok) {
        flash(r.message);
        return;
      }
      if (r.rateLimit) {
        const resetAt = new Date(r.rateLimit.resetAt);
        const resetText = resetAt.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        });
        const msg = `${r.message}. Resets at ${resetText}.`;
        const action = r.rateLimit.unauthenticated
          ? {
              label: "Sign in",
              onClick: () => {
                dismissToast();
                openModal({ kind: "account" });
              },
            }
          : undefined;
        flashError(msg, {
          ...(action ? { action } : {}),
          diagnostic:
            `${r.message}\n` +
            `limit=${r.rateLimit.limit}/hr\n` +
            `remaining=${r.rateLimit.remaining}\n` +
            `resetsAt=${r.rateLimit.resetAt}\n` +
            `authenticated=${!r.rateLimit.unauthenticated}`,
        });
        return;
      }
      flashError(r.message, {
        diagnostic: r.diagnostic ?? r.message,
      });
    },
    [flash, flashError, dismissToast, openModal],
  );

  const handleUnregisterResult = useCallback(
    async (
      errorId: number,
      r:
        | Awaited<ReturnType<typeof window.skillsBank.unregister>>
        | Awaited<ReturnType<typeof window.skillsBank.removeFromRegistry>>,
    ) => {
      if (r.ok) {
        dismissAppError(errorId);
        flash(r.message);
        await refresh();
      } else if (r.error) {
        dismissAppError(errorId);
        pushAppError(r.error);
      } else {
        flash(r.message);
      }
    },
    [flash, refresh, dismissAppError, pushAppError],
  );

  const changeRegistry = useCallback(() => {
    openModal({ kind: "repoPicker" });
  }, [openModal]);

  const signOut = useCallback(async () => {
    const s = await window.skillsBank.authLogout();
    setAuthStatus(s);
    closeModal();
    flash("Signed out");
  }, [flash, setAuthStatus, closeModal]);

  const pickRepo = useCallback(
    async (fullName: string) => {
      const r = await window.skillsBank.reposReplaceRegistry(fullName);
      if (r.ok) {
        flash(r.message);
        closeModal();
        const next = await window.skillsBank.authStatus();
        setAuthStatus(next);
        await refresh();
      } else {
        throw new Error(r.message);
      }
    },
    [refresh, flash, closeModal, setAuthStatus],
  );

  return (
    <>
      {modal?.kind === "register" && (
        <RegistrationPlanModal
          onClose={async () => {
            closeModal();
            await refresh();
          }}
          onFlash={flash}
          defaultInstallAgents={
            settings.defaultInstallAgents.length > 0
              ? settings.defaultInstallAgents
              : undefined
          }
        />
      )}

      {modal?.kind === "manageLinks" && (
        <ManageLinksModal
          name={modal.target.name}
          installations={modal.target.installations}
          onClose={async () => {
            closeModal();
            await refresh();
          }}
          onFlash={flash}
        />
      )}

      {modal?.kind === "conflict" && (
        <InstallCollisionModal
          name={modal.target.name}
          conflicts={modal.target.conflicts}
          allowReplaceWithSymlink={modal.target.allowReplaceWithSymlink}
          onClose={async () => {
            closeModal();
            await refresh();
          }}
          onFlash={flash}
        />
      )}

      {resolveAllTarget && (
        <ResolveAllConflictsModal
          target={resolveAllTarget}
          onClose={() => setResolveAllTarget(null)}
          onFlash={flash}
          refresh={refresh}
        />
      )}

      {modal?.kind === "installConflict" && (
        <InstallConflictModal
          name={modal.target.name}
          errors={modal.target.errors}
          onClose={() => closeModal()}
          onForce={async () => {
            const r = await window.skillsBank.install(
              modal.target.name,
              true,
              settings.defaultInstallAgents.length > 0
                ? settings.defaultInstallAgents
                : undefined,
            );
            flash(r.message);
            closeModal();
            await refresh();
          }}
          onResolve={() => {
            // Install-conflict resolution only ever reaches an already-
            // registered skill, so this is the always-registered variant.
            const { conflicts, allowReplaceWithSymlink } =
              selectResolvableConflicts(
                installed.filter((i) => i.name === modal.target.name),
                true,
              );
            openModal({
              kind: "conflict",
              target: {
                name: modal.target.name,
                conflicts,
                allowReplaceWithSymlink,
              },
            });
          }}
        />
      )}

      {modal?.kind === "manifestConflict" && (
        <ManifestConflictModal
          conflicts={modal.target.conflicts}
          onClose={() => {
            closeModal();
            flash("Merge cancelled — conflicts left pending.");
          }}
          onResolve={async (decisions) => {
            closeModal();
            const r =
              await window.skillsBank.resolveManifestConflicts(decisions);
            flash(r.message);
            await refresh();
          }}
        />
      )}

      {modal?.kind === "delete" && (
        <DeleteUnregisteredDialog
          name={modal.target.name}
          installations={modal.target.installations}
          onCancel={() => closeModal()}
          onConfirm={async () => {
            const target = modal.target;
            closeModal();
            const r = await window.skillsBank.deleteUnregistered(target.name);
            flash(r.message);
            await refresh();
          }}
        />
      )}

      {modal?.kind === "settings" && (
        <SettingsModal
          onClose={() => closeModal()}
          isAuthed={Boolean(authStatus?.user)}
          appVersion="dev"
          onCheckForAppUpdates={checkForAppUpdates}
        />
      )}

      {modal?.kind === "shortcuts" && (
        <KeyboardShortcutsOverlay onClose={() => closeModal()} />
      )}

      {modal?.kind === "account" && (
        <AccountModal
          authStatus={authStatus}
          onClose={() => closeModal()}
          onChangeRegistry={async () => {
            closeModal();
            await changeRegistry();
          }}
          onRefreshRegistry={async () => {
            closeModal();
            await importLinkedRepo();
          }}
          onOpenImportManifest={() =>
            openModal({ kind: "manifest", mode: "import" })
          }
          importingManifest={importingManifest}
          onOpenExportManifest={() =>
            openModal({ kind: "manifest", mode: "export" })
          }
          onSignOut={async () => {
            closeModal();
            await signOut();
          }}
          onConnectGithub={() => openModal({ kind: "connectGithub" })}
        />
      )}

      {modal?.kind === "manifest" && (
        <ManifestModal
          mode={modal.mode}
          linkedRepo={authStatus?.linkedRepo ?? null}
          appVersion="dev"
          importingManifest={importingManifest}
          onCancelImport={cancelManifestImport}
          onClose={() => closeModal()}
          onImportComplete={(result) => {
            closeModal();
            const registered = result.outcomes.filter(
              (o) => o.result === "registered",
            ).length;
            if (result.cancelled) {
              flash(
                `Import cancelled. Restored ${registered} skill${registered === 1 ? "" : "s"}.`,
              );
            } else {
              flash(
                `Restored ${registered} skill${registered === 1 ? "" : "s"} from manifest`,
              );
            }
            void refresh();
          }}
          onExportComplete={(msg) => {
            closeModal();
            flash(msg);
          }}
          onMerged={(msg) => {
            closeModal();
            flash(msg);
            void refresh();
          }}
          onConflicts={(conflicts) => {
            closeModal();
            openModal({ kind: "manifestConflict", target: { conflicts } });
          }}
        />
      )}

      {modal?.kind === "connectGithub" && authStatus && (
        <ConnectGithubModal
          isAuthConfigured={authStatus.isAuthConfigured}
          onClose={() => closeModal()}
          onConnected={(status) => {
            closeModal();
            setAuthStatus(status);
            if (!status.linkedRepo) {
              openModal({ kind: "repoPicker" });
            }
            void refresh();
          }}
        />
      )}

      {modal?.kind === "updates" && (
        <SkillUpdatesModal
          entries={pendingSkillUpdates}
          onClose={() => closeModal()}
          onUpdate={async (name) => {
            const r = await window.skillsBank.skillUpdate(name);
            handleUpdateResult(r);
            await refresh();
            return r;
          }}
          onView={(entry) => {
            closeModal();
            setSelected(entry);
          }}
          onCheckSkillUpdates={async () => {
            await window.skillsBank.originProbe();
            await refresh();
          }}
        />
      )}

      <DestinationPickerDialog
        open={pickDestinationTarget !== null}
        skillName={pickDestinationTarget?.name ?? ""}
        currentDestination={
          pickDestinationTarget?.currentDestination ??
          settings.unregisterDestinationAgent
        }
        onCancel={() => closeModal()}
        onPick={async (next, persistAsDefault) => {
          if (!pickDestinationTarget) return;
          const target = pickDestinationTarget;
          closeModal();
          if (persistAsDefault) {
            saveSettings({
              ...settings,
              unregisterDestinationAgent: next,
            });
          }
          const r = await window.skillsBank.unregister(target.name, next);
          await handleUnregisterResult(target.errorId, r);
        }}
      />

      <ConfirmDialog
        open={overwriteTarget !== null}
        title={`Overwrite existing folder?`}
        body={
          <>
            <p className="mt-0 mb-0">
              A folder already exists at <code>{overwriteTarget?.destDir}</code>
              . Continuing will permanently delete it and move{" "}
              <code>{overwriteTarget?.name}</code> in its place.
            </p>
            <p className="confirm-dialog-secondary">This cannot be undone.</p>
          </>
        }
        confirmLabel="Overwrite and unregister"
        tone="danger"
        onCancel={() => closeModal()}
        onConfirm={async () => {
          if (!overwriteTarget) return;
          const target = overwriteTarget;
          closeModal();
          const r = await window.skillsBank.unregister(
            target.name,
            settings.unregisterDestinationAgent,
            true,
          );
          await handleUnregisterResult(target.errorId, r);
        }}
      />

      <ConfirmDialog
        open={removeFromRegistryTarget !== null}
        title="Remove from registry?"
        body={
          <>
            <p className="mt-0 mb-0">
              This deletes <code>{removeFromRegistryTarget?.name}</code>
              &rsquo;s folder from the registry and its manifest entry, without
              moving the files anywhere first.
            </p>
            <p className="confirm-dialog-secondary">This cannot be undone.</p>
          </>
        }
        confirmLabel="Remove from registry"
        tone="danger"
        onCancel={() => closeModal()}
        onConfirm={async () => {
          if (!removeFromRegistryTarget) return;
          const target = removeFromRegistryTarget;
          closeModal();
          const r = await window.skillsBank.removeFromRegistry(target.name);
          await handleUnregisterResult(target.errorId, r);
        }}
      />

      <ConfirmDialog
        open={bulkRepairPrompt !== null}
        title="Remove dead symlinks?"
        body={(() => {
          if (!bulkRepairPrompt) return null;
          const { repaired, unrepairable } = bulkRepairPrompt;
          const totalLinks = unrepairable.reduce(
            (acc, u) => acc + u.entries.length,
            0,
          );
          return (
            <>
              <p className="mt-0 mb-0">
                Repaired {repaired} skill{repaired === 1 ? "" : "s"}.{" "}
                {unrepairable.length} skill
                {unrepairable.length === 1 ? "" : "s"} couldn't be repaired
                because the registry copy is gone.
              </p>
              <p className="confirm-dialog-secondary">
                Remove the {totalLinks} dead symlink
                {totalLinks === 1 ? "" : "s"}? The agent dirs lose the symlink.
                Because the registry copy is already gone, these skills will
                also disappear from the registry — there are no source files
                left to back them.
              </p>
              <ul className="confirm-dialog-list">
                {unrepairable.map((u) => (
                  <li key={u.name}>
                    <strong>{u.name}</strong> ({u.entries.length} link
                    {u.entries.length === 1 ? "" : "s"})
                  </li>
                ))}
              </ul>
            </>
          );
        })()}
        confirmLabel="Remove dead links"
        tone="danger"
        onCancel={() => {
          if (!bulkRepairPrompt) return;
          const { repaired, unrepairable } = bulkRepairPrompt;
          closeModal();
          flash(
            `Repaired ${repaired}; ${unrepairable.length} left unresolved.`,
          );
        }}
        onConfirm={async () => {
          if (!bulkRepairPrompt) return;
          const { repaired, unrepairable } = bulkRepairPrompt;
          closeModal();
          const results = await Promise.allSettled(
            unrepairable.map((u) =>
              window.skillsBank
                .removeBrokenLinks(
                  u.name,
                  u.entries.map((e) => e.agent) as AgentId[],
                )
                .then(() => u.name),
            ),
          );
          let removed = 0;
          results.forEach((r, i) => {
            if (r.status === "fulfilled") {
              removed += 1;
            } else {
              const name = unrepairable[i]!.name;
              pushAppError({
                code: "remove-broken.threw",
                message: `${name}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
                copyableDetails: { name },
              });
            }
          });
          await refresh();
          flash(
            `Repaired ${repaired}; removed dead links and dropped ${removed} unbacked registry entr${
              removed === 1 ? "y" : "ies"
            }.`,
          );
        }}
      />

      {modal?.kind === "updateNotes" &&
        latestAppUpdateStatus &&
        (latestAppUpdateStatus.kind === "available" ||
          latestAppUpdateStatus.kind === "downloading" ||
          latestAppUpdateStatus.kind === "downloaded") && (
          <AppUpdateNotesModal
            status={latestAppUpdateStatus}
            onClose={() => closeModal()}
            onSkip={(version) => {
              setDismissedAppUpdateVersion(version);
              void window.skillsBank.setDismissedAppUpdateVersion(version);
              closeModal();
            }}
            onDownload={() => {
              void window.skillsBank.downloadAppUpdate().then((r) => {
                if (!r.ok) flash(r.message);
              });
            }}
            onRestart={() => {
              closeModal();
              void window.skillsBank.quitAndInstallAppUpdate();
            }}
          />
        )}

      {modal?.kind === "repoPicker" && (
        <RepoPickerModal
          onClose={() => closeModal()}
          onPicked={pickRepo}
          onSignOut={signOut}
        />
      )}

      {modal?.kind === "bulkInstall" && (
        <BulkInstallModal onClose={closeModal} />
      )}

      {modal?.kind === "manageLabels" && (
        <ManageLabelsModal
          onClose={closeModal}
          onOpenSkill={setSelected}
          drawerOpen={selected !== null}
        />
      )}

      <DrawerHost
        selected={selected}
        onClose={() => setSelected(null)}
        authStatus={authStatus}
        onUpdateResult={handleUpdateResult}
        onOpenManageLinks={(t) => openModal({ kind: "manageLinks", target: t })}
        onOpenConflicts={(t) => openModal({ kind: "conflict", target: t })}
        onInstallConflict={(p) =>
          openModal({ kind: "installConflict", target: p })
        }
        unregisterHintShown={unregisterHintShown}
        markUnregisterHintShown={markUnregisterHintShown}
        reviewContext={reviewContext}
        elevated={modal?.kind === "manageLabels"}
      />
    </>
  );
}

// ─── DrawerHost (internal) ───────────────────────────────────────────

interface DrawerHostProps {
  /** Currently-selected entry (drawer is mounted when non-null). */
  selected: RegistryEntry | null;
  /** Close the drawer (clears selection). */
  onClose: () => void;
  /** Auth state — drawer gates the upstream-activity strip on whether the user is signed in. */
  authStatus: AuthStatus | null;
  /** Centralized handler for the three Update result paths. */
  onUpdateResult: (r: SkillUpdateResult) => void;
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
    errors: InstallConflictError[];
  }) => void;
  /** Persist the "user has seen the unregister-destination hint" bit. */
  unregisterHintShown: () => boolean;
  markUnregisterHintShown: () => void;
  reviewContext?: ReviewContext | null;
  /** When true, elevates the drawer overlay above an open modal. */
  elevated?: boolean;
}

/**
 * Capability-gated wiring around `<SkillDetailDrawer>`: every action the
 * drawer surfaces, gated on the classifier's capability fan-out.
 * History: extracted from App.tsx as its own file (v0.11.6 M3), folded
 * back in here once it was clear it stayed pure glue with no state or
 * domain of its own — it renders only from ModalHost, so the indirection
 * bought nothing. Re-extract if it ever grows a real job.
 *
 * Toast + error surfaces come from `useRegistryHost()`, not props —
 * they're cross-cutting.
 */
function DrawerHost({
  selected,
  onClose,
  authStatus,
  onUpdateResult,
  onOpenManageLinks,
  onOpenConflicts,
  onInstallConflict,
  unregisterHintShown,
  markUnregisterHintShown,
  reviewContext,
  elevated,
}: DrawerHostProps): React.ReactElement | null {
  const { flash, pushAppError } = useRegistryHost();
  const { registryByName, installed, registryRoot, refresh } = useRegistry();
  const { settings } = useSettings();
  const { registerSkill } = useRegisterSkill();
  if (!selected) return null;
  const isRegistered = registryByName.has(selected.name);
  const installations = installed.filter((i) => i.name === selected.name);
  // Representative install for action targeting: disambiguates when the
  // same name exists in multiple agent dirs.
  const drawerRep = installations[0] ?? null;
  const drawerTarget = drawerRep ? { agent: drawerRep.agent } : undefined;
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
        const { conflicts, allowReplaceWithSymlink } =
          selectResolvableConflicts(installations, isRegistered);
        if (conflicts.length === 0) return;
        onOpenConflicts({
          name: selected.name,
          conflicts,
          allowReplaceWithSymlink,
        });
        onClose();
      }}
      onRegister={
        caps.canRegister
          ? async () => {
              const r = await registerSkill({
                name: selected.name,
                ...(drawerTarget ? { target: drawerTarget } : {}),
              });
              if (r.ok) onClose();
            }
          : undefined
      }
      onUpdate={
        caps.canUpdate
          ? async () => {
              const r = await window.skillsBank.skillUpdate(selected.name);
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
              if (r.ok) {
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
      reviewContext={reviewContext}
      elevated={elevated}
    />
  );
}
