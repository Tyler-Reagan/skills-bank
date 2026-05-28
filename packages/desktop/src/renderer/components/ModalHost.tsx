import React, { useCallback, useState } from "react";
import type {
  AgentId,
  ConflictEntry,
  InstalledSkill,
  RegistryEntry,
} from "@skills-bank/core";
import { RegisterModal } from "./RegisterModal.js";
import { ManageLinksModal } from "./ManageLinksModal.js";
import { ConflictResolveModal } from "./ConflictResolveModal.js";
import { InstallConflictModal } from "./InstallConflictModal.js";
import type { InstallConflictError } from "./InstallConflictModal.js";
import { ConflictResolutionModal } from "./ConflictResolutionModal.js";
import { DeleteUnregisteredConfirm } from "./DeleteUnregisteredConfirm.js";
import { SettingsModal } from "./SettingsModal.js";
import { InstallFromGithubModal } from "./InstallFromGithubModal.js";
import { KeyboardShortcutsOverlay } from "./KeyboardShortcutsOverlay.js";
import { AccountModal } from "./AccountModal.js";
import { ManifestImportConfirmModal } from "./ManifestImportConfirmModal.js";
import { ManifestModal } from "./ManifestModal.js";
import { ConnectGithubModal } from "./ConnectGithubModal.js";
import { UpdatesModal } from "./UpdatesModal.js";
import { UpdateNotesModal } from "./UpdateNotesModal.js";
import { RepoPickerModal } from "./RepoPickerModal.js";
import { DestinationPickerDialog } from "./DestinationPickerDialog.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { DrawerHost } from "./DrawerHost.js";
import type { InstalledGroup } from "./InstalledTab.js";
import { useRegistry } from "../RegistryContext.js";
import { useSettings } from "../SettingsContext.js";
import { useRegistryHost } from "../RegistryHostContext.js";
import type {
  AuthStatus,
  OriginUpdateResult,
  UpdateStatus,
} from "../../shared/ipc.js";

/**
 * Every mutually-exclusive modal AppContent can show. One at a time —
 * see useModalRouter. The drawer (`selected`), the sync-triggered
 * conflict resolver (`conflictModalEntries`), and the bulk resolve-all
 * flow keep their own state because they can overlay a modal or carry
 * multi-step state.
 */
export type ActiveModal =
  | { kind: "register" }
  | { kind: "settings" }
  | { kind: "installFromGithub" }
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
      kind: "mergeConflict";
      target: {
        sourcePath: string;
        conflicts: import("@skills-bank/core").ConflictEntry[];
        priorReport: import("@skills-bank/core").MergeImportReport;
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
      kind: "bulkRepair";
      target: {
        repaired: number;
        unrepairable: Array<{
          name: string;
          entries: Array<{ agent: string; linkPath: string }>;
        }>;
      };
    };

interface Props {
  modal: ActiveModal | null;
  openModal: (m: ActiveModal) => void;
  closeModal: () => void;
  authStatus: AuthStatus | null;
  setAuthStatus: (s: AuthStatus | null) => void;
  conflictModalEntries: ConflictEntry[] | null;
  setConflictModalEntries: (v: ConflictEntry[] | null) => void;
  selected: RegistryEntry | null;
  setSelected: (e: RegistryEntry | null) => void;
  importingManifest: boolean;
  cancelManifestImport: () => void;
  refreshLinkedRepo: () => Promise<void>;
  latestUpdateStatus: UpdateStatus | null;
  setDismissedUpdateVersion: (v: string | null) => void;
  resolveAllTarget: InstalledGroup[] | null;
  setResolveAllTarget: (v: InstalledGroup[] | null) => void;
  checkForUpdates: () => void;
  unregisterHintShown: () => boolean;
  markUnregisterHintShown: () => void;
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
  conflictModalEntries,
  setConflictModalEntries,
  selected,
  setSelected,
  importingManifest,
  cancelManifestImport,
  refreshLinkedRepo,
  latestUpdateStatus,
  setDismissedUpdateVersion,
  resolveAllTarget,
  setResolveAllTarget,
  checkForUpdates,
  unregisterHintShown,
  markUnregisterHintShown,
}: Props): React.ReactElement {
  const { registry, installed, pendingSkillUpdates, refresh } = useRegistry();
  const { settings, saveSettings } = useSettings();
  const { flash, flashError, dismissToast, pushAppError, dismissAppError } =
    useRegistryHost();

  const [resolveAllRunning, setResolveAllRunning] = useState(false);
  const [resolveAllErrors, setResolveAllErrors] = useState<Record<
    string,
    string[]
  > | null>(null);
  const [manifestImportHints, setManifestImportHints] = useState<
    import("@skills-bank/core").ImportRegistryManifestResult | null
  >(null);

  const pickDestinationTarget =
    modal?.kind === "pickDestination" ? modal.target : null;
  const overwriteTarget = modal?.kind === "overwrite" ? modal.target : null;
  const bulkRepairPrompt = modal?.kind === "bulkRepair" ? modal.target : null;

  const handleUpdateResult = useCallback(
    (r: OriginUpdateResult) => {
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
      r: Awaited<ReturnType<typeof window.skillsBank.unregister>>,
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

  const importRegistryFromDisk = useCallback(async () => {
    const r = await window.skillsBank.importRegistry();
    if (r.ok && r.registryRoot) {
      flash(r.message);
      await refresh();
    } else if (r.message !== "cancelled") {
      flash(`Couldn't import registry: ${r.message}`);
    }
  }, [refresh, flash]);

  const mergeRegistry = useCallback(async () => {
    const r = await window.skillsBank.importRegistryMerge();
    if (!r.ok) {
      if (r.message !== "cancelled") {
        flash(`Couldn't merge: ${r.message}`);
      }
      return;
    }
    if (r.report.conflicts.length === 0) {
      flash(r.message);
      await refresh();
      return;
    }
    openModal({
      kind: "mergeConflict",
      target: {
        sourcePath: r.sourcePath,
        conflicts: r.report.conflicts,
        priorReport: r.report,
      },
    });
  }, [flash, refresh, openModal]);

  const exportRegistry = useCallback(async () => {
    const r = await window.skillsBank.exportRegistry();
    if (!r.ok && r.message !== "export cancelled") {
      flash(`Export failed: ${r.message}`);
    } else if (r.ok) {
      flash(r.message);
    }
  }, [flash]);

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

  const resolveConflicts = useCallback(
    async (decisions: import("@skills-bank/core").SyncDecisions) => {
      const r = await window.skillsBank.resolveConflicts(decisions);
      flash(r.message);
      setConflictModalEntries(null);
      await refresh();
    },
    [flash, refresh, setConflictModalEntries],
  );

  return (
    <>
      {modal?.kind === "register" && (
        <RegisterModal
          onClose={async () => {
            closeModal();
            await refresh();
          }}
          onFlash={flash}
          registerAdopts={settings.registerAdopts}
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
        <ConflictResolveModal
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
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border-hi)",
              borderRadius: 8,
              padding: 24,
              width: 520,
              maxWidth: "90vw",
            }}
          >
            <h3 style={{ marginTop: 0 }}>
              Resolve all conflicts ({resolveAllTarget.length})?
            </h3>
            <p style={{ color: "var(--text-2)", fontSize: 13 }}>
              For each skill below, every duplicate or stale agent-dir entry
              will be replaced with a symlink to the Skills Bank copy. This is
              the same as picking "Replace with symlink" for each conflict.
            </p>
            <ul
              style={{
                margin: "8px 0 12px",
                padding: "8px 12px",
                background: "var(--surface-hi)",
                borderRadius: 4,
                fontSize: 12,
                color: "var(--text-2)",
                listStyle: "none",
                maxHeight: 200,
                overflowY: "auto",
              }}
            >
              {resolveAllTarget.map((g) => {
                const skillErrors = resolveAllErrors?.[g.name];
                return (
                  <li key={g.name} style={{ padding: "3px 0" }}>
                    <code
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: skillErrors
                          ? "var(--danger, #d04444)"
                          : "var(--text-1)",
                      }}
                    >
                      {g.name}
                    </code>{" "}
                    <span style={{ color: "var(--text-3)" }}>
                      — {g.conflicts.length} conflict
                      {g.conflicts.length === 1 ? "" : "s"}
                    </span>
                    {skillErrors && (
                      <ul
                        style={{
                          margin: "4px 0 0 12px",
                          padding: 0,
                          listStyle: "none",
                          color: "var(--danger, #d04444)",
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {skillErrors.map((m, i) => (
                          <li key={i} style={{ padding: "1px 0" }}>
                            · {m}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <button
                className="btn"
                onClick={() => {
                  setResolveAllTarget(null);
                  setResolveAllErrors(null);
                }}
                disabled={resolveAllRunning}
              >
                Cancel
              </button>
              <button
                className="btn warn"
                disabled={resolveAllRunning}
                onClick={() => {
                  void (async () => {
                    setResolveAllRunning(true);
                    setResolveAllErrors(null);
                    let okCount = 0;
                    let failCount = 0;
                    const errs: Record<string, string[]> = {};
                    for (const g of resolveAllTarget) {
                      const decisions = g.conflicts.map((c) => ({
                        agent: c.agent,
                        action: "replace-with-symlink" as const,
                      }));
                      try {
                        const r = await window.skillsBank.resolveSkillConflicts(
                          g.name,
                          decisions,
                        );
                        okCount += r.applied.length;
                        failCount += r.errors.length;
                        if (r.errors.length > 0) {
                          errs[g.name] = r.errors.map(
                            (e) => `${e.agent}: ${e.message}`,
                          );
                        }
                      } catch (err) {
                        failCount += 1;
                        errs[g.name] = [(err as Error).message];
                      }
                    }
                    setResolveAllRunning(false);
                    if (failCount === 0) {
                      setResolveAllTarget(null);
                      flash(
                        `Resolved ${okCount} conflict${okCount === 1 ? "" : "s"} across ${resolveAllTarget.length} skill${resolveAllTarget.length === 1 ? "" : "s"}.`,
                      );
                      await refresh();
                    } else {
                      setResolveAllErrors(errs);
                      flash(
                        okCount === 0
                          ? `Couldn't resolve ${failCount} conflict${failCount === 1 ? "" : "s"} (see details)`
                          : `Resolved ${okCount}; ${failCount} failed (see details)`,
                      );
                      await refresh();
                    }
                  })();
                }}
              >
                {resolveAllRunning ? (
                  <>
                    <span className="spinner inline" /> Resolving
                  </>
                ) : resolveAllErrors ? (
                  "Retry"
                ) : (
                  `Resolve ${resolveAllTarget.length} skill${resolveAllTarget.length === 1 ? "" : "s"}`
                )}
              </button>
            </div>
          </div>
        </div>
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
            const conflicts = installed.filter(
              (i) =>
                i.name === modal.target.name &&
                i.kind !== "ours" &&
                i.kind !== "broken-symlink",
            );
            openModal({
              kind: "conflict",
              target: {
                name: modal.target.name,
                conflicts,
                allowReplaceWithSymlink: true,
              },
            });
          }}
        />
      )}

      {modal?.kind === "mergeConflict" && (
        <ConflictResolutionModal
          conflicts={modal.target.conflicts}
          onClose={() => {
            const prior = modal.target.priorReport;
            closeModal();
            const parts: string[] = [];
            if (prior.imported.length > 0)
              parts.push(`${prior.imported.length} imported`);
            if (prior.renamed.length > 0)
              parts.push(`${prior.renamed.length} renamed`);
            if (prior.keptMine.length > 0)
              parts.push(`${prior.keptMine.length} kept yours`);
            flash(
              `Merge cancelled${parts.length > 0 ? ` (${parts.join(", ")})` : ""}.`,
            );
            void refresh();
          }}
          onResolve={async (decisions) => {
            const target = modal.target;
            closeModal();
            const r = await window.skillsBank.importRegistryMergeApply(
              target.sourcePath,
              decisions,
            );
            flash(r.message);
            await refresh();
          }}
        />
      )}

      {modal?.kind === "delete" && (
        <DeleteUnregisteredConfirm
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
          onOpenInstallFromGithub={() =>
            openModal({ kind: "installFromGithub" })
          }
          hiddenCanon={registry.filter((e) => e.hidden).map((e) => e.name)}
          onUnhide={async (name) => {
            const r = await window.skillsBank.unhide(name);
            flash(r.message);
            await refresh();
          }}
          isAuthed={Boolean(authStatus?.user)}
        />
      )}

      {modal?.kind === "installFromGithub" && (
        <InstallFromGithubModal
          onClose={() => closeModal()}
          onInstalled={() => {
            closeModal();
            void refresh();
          }}
        />
      )}

      {modal?.kind === "shortcuts" && (
        <KeyboardShortcutsOverlay onClose={() => closeModal()} />
      )}

      {modal?.kind === "account" && (
        <AccountModal
          authStatus={authStatus}
          appVersion={"dev"}
          onClose={() => closeModal()}
          onChangeRegistry={async () => {
            closeModal();
            await changeRegistry();
          }}
          onRefreshRegistry={async () => {
            closeModal();
            await refreshLinkedRepo();
          }}
          onImportRegistry={async () => {
            closeModal();
            await importRegistryFromDisk();
          }}
          onMergeRegistry={async () => {
            closeModal();
            await mergeRegistry();
          }}
          onExportRegistry={async () => {
            closeModal();
            await exportRegistry();
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
          onCheckForUpdates={checkForUpdates}
          onConnectGithub={() => openModal({ kind: "connectGithub" })}
        />
      )}

      {manifestImportHints !== null && (
        <ManifestImportConfirmModal
          result={manifestImportHints}
          onClose={() => setManifestImportHints(null)}
          onDone={(msg) => {
            setManifestImportHints(null);
            if (msg) flash(msg);
          }}
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
            if (result.installHints.length > 0) {
              setManifestImportHints(result);
            }
          }}
          onExportComplete={(msg) => {
            closeModal();
            flash(msg);
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
        <UpdatesModal
          entries={pendingSkillUpdates}
          onClose={() => closeModal()}
          onUpdate={async (name) => {
            const r = await window.skillsBank.originUpdate(name);
            handleUpdateResult(r);
            await refresh();
            return r;
          }}
          onView={(entry) => {
            closeModal();
            setSelected(entry);
          }}
          onRefresh={async () => {
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
            <p style={{ margin: 0 }}>
              A folder already exists at <code>{overwriteTarget?.destDir}</code>
              . Continuing will permanently delete it and move{" "}
              <code>{overwriteTarget?.name}</code> in its place.
            </p>
            <p
              style={{
                marginTop: 10,
                marginBottom: 0,
                fontSize: 12,
                color: "var(--text-3)",
              }}
            >
              This cannot be undone.
            </p>
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
              <p style={{ margin: 0 }}>
                Repaired {repaired} skill{repaired === 1 ? "" : "s"}.{" "}
                {unrepairable.length} skill
                {unrepairable.length === 1 ? "" : "s"} couldn't be repaired
                because the registry copy is gone.
              </p>
              <p
                style={{
                  margin: "10px 0 6px 0",
                  fontSize: 12,
                  color: "var(--text-3)",
                }}
              >
                Remove the {totalLinks} dead symlink
                {totalLinks === 1 ? "" : "s"}? The agent dirs lose the symlink.
                Because the registry copy is already gone, these skills will
                also disappear from the registry — there are no source files
                left to back them.
              </p>
              <ul
                style={{
                  margin: "8px 0 0 0",
                  paddingLeft: 18,
                  fontSize: 12,
                  color: "var(--text-2)",
                  maxHeight: 160,
                  overflowY: "auto",
                }}
              >
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
        latestUpdateStatus &&
        (latestUpdateStatus.kind === "available" ||
          latestUpdateStatus.kind === "downloading" ||
          latestUpdateStatus.kind === "downloaded") && (
          <UpdateNotesModal
            status={latestUpdateStatus}
            onClose={() => closeModal()}
            onSkip={(version) => {
              setDismissedUpdateVersion(version);
              void window.skillsBank.setDismissedUpdateVersion(version);
              closeModal();
            }}
            onDownload={() => {
              void window.skillsBank.downloadUpdate().then((r) => {
                if (!r.ok) flash(r.message);
              });
            }}
            onRestart={() => {
              closeModal();
              void window.skillsBank.quitAndInstallUpdate();
            }}
          />
        )}

      {conflictModalEntries && (
        <ConflictResolutionModal
          conflicts={conflictModalEntries}
          onClose={() => setConflictModalEntries(null)}
          onResolve={resolveConflicts}
        />
      )}

      {modal?.kind === "repoPicker" && (
        <RepoPickerModal
          onClose={() => closeModal()}
          onPicked={pickRepo}
          onSignOut={signOut}
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
      />
    </>
  );
}
