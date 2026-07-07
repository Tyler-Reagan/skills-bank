import React, { useRef, useState } from "react";
import type {
  AgentId,
  DrawerStateClassification,
  InstalledSkill,
  RegistryEntry,
} from "@skills-bank/core";
import { parseOwnerRepo } from "@skills-bank/core/origin-url";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { Icon } from "./Icon.js";
import { RestoreOriginModal } from "./RestoreOriginModal.js";

type ActionState =
  | null
  | "installing"
  | "exporting"
  | "registering"
  | "moving-into-bank"
  | "unregistering"
  | "updating"
  | "forgetting"
  | "repointing"
  | "detaching";

interface Props {
  entry: RegistryEntry;
  installed: InstalledSkill[];
  isRegistered: boolean;
  absPath: string | null;
  defaultInstallAgents?: AgentId[];
  classification: DrawerStateClassification;
  drawerRef: React.RefObject<HTMLElement | null>;
  onInstallConflict?: (payload: {
    name: string;
    errors: Array<{ agent: AgentId; message: string }>;
  }) => void;
  onChanged: (msg: string) => void | Promise<void>;
  onClose: () => void;
  onManageLinks?: () => void;
  onResolveConflicts?: () => void;
  onRegister?: () => Promise<void> | void;
  onMoveIntoBank?: () => Promise<void> | void;
  onUnregister?: () => Promise<void> | void;
  onUpdate?: () => Promise<void> | void;
  onForgetMissing?: () => Promise<void> | void;
  onRepoint?: () => Promise<void> | void;
}

/**
 * Renders the action panel at the bottom of SkillDetailDrawer, including
 * the confirm-delete sub-dialog for unrepairable broken links. Owns
 * `action` (in-flight indicator) and `repairState` (two-step repair
 * flow), and calls both focus-trap hooks since it's the authority on
 * whether the confirm-delete dialog is open.
 */
export function DrawerActions({
  entry,
  absPath,
  defaultInstallAgents,
  classification,
  drawerRef,
  onInstallConflict,
  onChanged,
  onClose,
  onManageLinks,
  onResolveConflicts,
  onRegister,
  onMoveIntoBank,
  onUnregister,
  onUpdate,
  onForgetMissing,
  onRepoint,
}: Props): React.ReactElement {
  const [action, setAction] = useState<ActionState>(null);
  const [repairState, setRepairState] = useState<
    | { kind: "idle" }
    | { kind: "running" }
    | {
        kind: "confirm-delete";
        agents: AgentId[];
        reasons: string[];
      }
  >({ kind: "idle" });
  const confirmDeleteRef = useRef<HTMLDivElement | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

  // Suspend the drawer trap while a sub-dialog is open — focus belongs to
  // the inner dialog (confirm-delete or restore-origin) until dismissed.
  useFocusTrap(
    drawerRef,
    repairState.kind !== "confirm-delete" && !restoreOpen,
  );
  useFocusTrap(confirmDeleteRef, repairState.kind === "confirm-delete");

  const caps = classification.capabilities;
  const originRepo = parseOwnerRepo(entry.origin.url);

  const install = async () => {
    setAction("installing");
    try {
      const r = await window.skillsBank.install(
        entry.name,
        false,
        defaultInstallAgents,
      );
      const forceErrors = (r.errors ?? [])
        .filter((e) => /refusing to overwrite without force/i.test(e.message))
        .map((e) => {
          const agentDetail = e.copyableDetails?.["agent"];
          const agent =
            typeof agentDetail === "string"
              ? (agentDetail as AgentId)
              : ("claude" as AgentId);
          return { agent, message: e.message };
        });
      if (!r.ok && forceErrors.length > 0 && onInstallConflict) {
        onInstallConflict({ name: entry.name, errors: forceErrors });
        return;
      }
      await onChanged(r.message);
    } finally {
      setAction(null);
    }
  };

  const exportSkill = async () => {
    setAction("exporting");
    try {
      const r = await window.skillsBank.exportSkill(entry.name);
      await onChanged(r.message);
    } finally {
      setAction(null);
    }
  };

  const reveal = () => {
    if (absPath) void window.skillsBank.openInFinder(absPath);
  };

  const repairOrRemoveBroken = async () => {
    setRepairState({ kind: "running" });
    const report = await window.skillsBank.repairBrokenLinks(entry.name);
    if (report.unrepairable.length === 0) {
      setRepairState({ kind: "idle" });
      await onChanged(
        report.repaired.length > 0
          ? `Repaired ${report.repaired.length} broken link(s) for ${entry.name}`
          : `No broken links for ${entry.name}`,
      );
      return;
    }
    setRepairState({
      kind: "confirm-delete",
      agents: report.unrepairable.map((u) => u.agent),
      reasons: report.unrepairable.map((u) => `${u.linkPath}: ${u.reason}`),
    });
  };

  const confirmDeleteBroken = async () => {
    if (repairState.kind !== "confirm-delete") return;
    setRepairState({ kind: "running" });
    const report = await window.skillsBank.removeBrokenLinks(
      entry.name,
      repairState.agents,
    );
    setRepairState({ kind: "idle" });
    if (report.errors.length > 0) {
      await onChanged(
        `Removed ${report.removed.length}; ${report.errors.length} failed`,
      );
    } else {
      await onChanged(`Deleted ${report.removed.length} broken link(s)`);
    }
  };

  return (
    <>
      <div className="drawer-actions">
        {/* Action block is gated by classifyDrawerState. Each button
        has both a capability flag (should it appear?) and a
        primary marker (should it be styled as the primary call to
        action?). The primary action renders first, regardless of
        category, so the user's eye lands on the right move for
        the current state. See skillState.ts for the table. */}

        {/* Register — primary for unregistered states with adoptable
        source. The registry-source hint stays with this affordance. */}
        {caps.canRegister && onRegister && (
          <>
            <button
              className="btn primary"
              disabled={action !== null}
              onClick={() => {
                setAction("registering");
                void Promise.resolve(onRegister()).finally(() =>
                  setAction(null),
                );
              }}
            >
              {action === "registering" ? (
                <>
                  <span className="spinner inline" /> Registering
                </>
              ) : (
                "Register in registry"
              )}
            </button>
            <p className="drawer-action-hint">
              Records this skill in your registry while leaving its files where
              they live. Cross-agent linkable. Files move into the bank only if
              you turn on auto-adopt in Settings — or later, explicitly, via
              Move into bank.
            </p>
          </>
        )}

        {/* Move into bank — explicit opt-in adopt for a skill that was
        registered in place (e.g. from a custom directory). Relocates its
        files into the registry's skills/ tree. */}
        {caps.canMoveIntoBank && onMoveIntoBank && (
          <>
            <button
              className="btn"
              disabled={action !== null}
              onClick={() => {
                setAction("moving-into-bank");
                void Promise.resolve(onMoveIntoBank()).finally(() =>
                  setAction(null),
                );
              }}
            >
              {action === "moving-into-bank" ? (
                <>
                  <span className="spinner inline" /> Moving into bank
                </>
              ) : (
                "Move into bank"
              )}
            </button>
            <p className="drawer-action-hint">
              Relocates this skill's files into your registry's skills/
              directory and links the agents to the in-bank copy. Do this only
              if the source can be moved — leave keep-in-place skills (like a
              non-egressable work repo) registered where they are.
            </p>
          </>
        )}

        {caps.canUpdate && onUpdate && (
          <>
            <button
              className="btn primary"
              disabled={action !== null}
              onClick={() => {
                setAction("updating");
                void Promise.resolve(onUpdate()).finally(() => setAction(null));
              }}
              title={`Fetch the latest content from ${
                originRepo ?? "the Origin"
              } and mirror it into this skill.`}
            >
              {action === "updating" ? (
                <>
                  <span className="spinner inline" /> Updating{" "}
                </>
              ) : (
                "Update"
              )}
            </button>
            <p className="drawer-action-hint">
              A newer version is available from{" "}
              <code>{originRepo ?? "Origin"}</code>. Local content is unchanged
              since the last fetch, so the update applies cleanly.
            </p>
          </>
        )}

        {caps.canRepoint && onRepoint && (
          <button
            className="btn primary"
            disabled={action !== null}
            onClick={() => {
              setAction("repointing");
              void Promise.resolve(onRepoint()).finally(() => setAction(null));
            }}
            title="Pick the folder the skill moved to. Updates the registry entry's target path."
          >
            {action === "repointing" ? (
              <>
                <span className="spinner inline" /> Picking{" "}
              </>
            ) : (
              "Pick new location"
            )}
          </button>
        )}

        {/* Restore unreachable origin (ADR-0012) — opens the modal
        offering repoint / adopt / detach. */}
        {caps.canRestoreOrigin && (
          <>
            <button
              className="btn primary"
              disabled={action !== null}
              onClick={() => setRestoreOpen(true)}
              title="The upstream is unreachable. Repoint it at a new location, or keep the skill by moving it into your linked repo."
            >
              Restore origin
            </button>
            <p className="drawer-action-hint">
              The source <code>{originRepo ?? "origin"}</code> can't be reached.
              Point it at the new location, or re-home the skill.
            </p>
          </>
        )}

        {/* Drift "keep my edits" — detach is offered directly only when
        the restore modal (which also offers detach) isn't present. */}
        {caps.canDetachLocal && !caps.canRestoreOrigin && (
          <>
            <button
              className="btn"
              disabled={action !== null}
              onClick={() => {
                setAction("detaching");
                void window.skillsBank
                  .detachLocal(entry.name)
                  .then((r) => {
                    if (r.ok) return onChanged(r.message);
                  })
                  .finally(() => setAction(null));
              }}
              title="Stop tracking the origin and keep your local edits. The skill becomes a local skill in personal."
            >
              {action === "detaching" ? (
                <>
                  <span className="spinner inline" /> Detaching{" "}
                </>
              ) : (
                "Keep my edits (detach)"
              )}
            </button>
            <p className="drawer-action-hint">
              Severs the origin and keeps your local copy. It stops receiving
              updates and won't sync until you adopt it into your linked repo.
            </p>
          </>
        )}

        {caps.canForgetMissing && onForgetMissing && (
          <>
            <button
              className={caps.canRepoint ? "btn" : "btn primary"}
              disabled={action !== null}
              onClick={() => {
                setAction("forgetting");
                void Promise.resolve(onForgetMissing()).finally(() =>
                  setAction(null),
                );
              }}
              title="Remove the registry entry for this skill. Files are already gone — nothing else to do."
            >
              {action === "forgetting" ? (
                <>
                  <span className="spinner inline" /> Forgetting{" "}
                </>
              ) : (
                "Forget this skill"
              )}
            </button>
            <p className="drawer-action-hint">
              {caps.canRepoint
                ? "If the skill just moved on disk, pick its new location. Otherwise forget it to stop tracking."
                : "The files for this skill are gone. Forgetting drops the registry record so the skill stops appearing."}
            </p>
          </>
        )}

        {/* Repair broken — primary in *-broken states. Two-step:
        first try repair, then prompt delete for unrepairable. */}
        {caps.canRepairBroken && caps.primary === "repair-broken" && (
          <button
            className="btn warn inline-center-6"
            disabled={action !== null || repairState.kind === "running"}
            onClick={() => void repairOrRemoveBroken()}
            title="Try to repoint broken symlinks at a usable source. Unrepairable links can be deleted in the next step."
          >
            {repairState.kind === "running" ? (
              <>
                <span className="spinner inline" /> Repairing
              </>
            ) : (
              <>
                <Icon name="alert-triangle" size="sm" />
                Fix broken link
                {classification.brokenCount === 1 ? "" : "s"} (
                {classification.brokenCount})
              </>
            )}
          </button>
        )}

        {/* Resolve registration conflicts — primary for unregistered
        skills with multiple non-ours installations. Routes through
        InstallCollisionModal in its level-pure mode (delete/keep
        only) so this Needs-attention action does not silently
        also register the skill. After resolution the card lands
        in Unregistered for the separate Register step. */}
        {caps.canResolveRegistrationConflicts &&
          caps.primary === "resolve-registration-conflicts" &&
          onResolveConflicts && (
            <button
              className="btn warn inline-center-6"
              disabled={action !== null}
              onClick={onResolveConflicts}
              title={`This skill name appears in ${classification.conflictCount + classification.brokenCount} agent dir(s) with different sources. Pick which copy to keep; the rest will be deleted.`}
            >
              <Icon name="alert-triangle" size="sm" />
              Resolve{" "}
              {classification.conflictCount + classification.brokenCount}{" "}
              conflict
              {classification.conflictCount + classification.brokenCount === 1
                ? ""
                : "s"}
            </button>
          )}

        {/* Resolve conflicts — primary when stragglers exist alongside
        a registered skill. The InstallConflictModal handles the
        gate-time variant; this one handles already-installed +
        stragglers. */}
        {caps.canResolveConflicts &&
          caps.primary === "resolve-conflicts" &&
          onResolveConflicts && (
            <button
              className="btn warn inline-center-6"
              disabled={action !== null}
              onClick={onResolveConflicts}
              title={`${classification.conflictCount} agent dir(s) have duplicate or stale entries for this skill`}
            >
              <Icon name="alert-triangle" size="sm" />
              Resolve {classification.conflictCount} conflict
              {classification.conflictCount === 1 ? "" : "s"}
            </button>
          )}

        {/* Attention/management separator — renders only when the
        primary is an in-flight attention action AND at least one
        management button is visible. Makes the drawer read
        fix → manage → destroy. For unregistered-conflicts /
        unregistered-broken the management group is empty (only
        Reveal alongside the primary), so this is suppressed. */}
        {[
          "repair-broken",
          "resolve-conflicts",
          "resolve-registration-conflicts",
        ].includes(caps.primary) &&
          (caps.canManageLinks || caps.canExport) && (
            <div
              role="separator"
              aria-hidden="true"
              className="drawer-section-sep"
            />
          )}

        {/* Install — primary in registered-available; also the only
        path to a "reinstall fixes broken links" in registered-broken.
        In registered-conflicts it appears as a secondary and routes
        through InstallConflictModal. */}
        {caps.canInstall && (
          <button
            className={caps.primary === "install" ? "btn primary" : "btn"}
            disabled={action !== null}
            onClick={() => void install()}
            title={
              classification.state === "registered-broken"
                ? "Recreates the agent-dir symlinks, replacing any broken ones with fresh links to the Skills Bank copy."
                : classification.state === "registered-conflicts"
                  ? "Install where possible; agents with conflicting entries will prompt you to resolve."
                  : "Link this skill into your agent directories."
            }
          >
            {action === "installing" ? (
              <>
                <span className="spinner inline" /> Installing{" "}
              </>
            ) : classification.state === "registered-broken" ? (
              "Reinstall (fixes broken links)"
            ) : classification.state === "registered-conflicts" ? (
              "Install (will prompt for conflicts)"
            ) : (
              "Install"
            )}
          </button>
        )}

        {/* Manage agent links — the single entry point for any
        agent-link change. Subsumes the prior "Remove from
        agents" and "Choose agents" buttons: the modal lets
        the user tick or untick each agent dir individually, and
        unticking all is equivalent to a bulk uninstall. */}
        {caps.canManageLinks && onManageLinks && (
          <button
            className="btn"
            disabled={action !== null}
            onClick={onManageLinks}
            title="Add or remove agent-dir symlinks for this skill. Unchecking all is equivalent to removing the skill from every agent."
          >
            Manage agent links
          </button>
        )}

        {/* Secondary repair button — appears only in mixed-broken
        where Repair is primary but Install was hidden; this
        keeps the action discoverable alongside Remove. */}
        {caps.canRepairBroken && caps.primary !== "repair-broken" && (
          <button
            className="btn warn"
            disabled={action !== null || repairState.kind === "running"}
            onClick={() => void repairOrRemoveBroken()}
            title={`${classification.brokenCount} broken symlink(s) for this skill`}
          >
            {repairState.kind === "running" ? (
              <>
                <span className="spinner inline" /> Repairing
              </>
            ) : (
              `Fix broken link${classification.brokenCount === 1 ? "" : "s"}`
            )}
          </button>
        )}

        {/* Secondary resolve button — placeholder; today every state
        that allows Resolve also has it as the primary, so this
        branch is unreachable. Kept for future symmetry. */}
        {caps.canResolveConflicts &&
          caps.primary !== "resolve-conflicts" &&
          onResolveConflicts && (
            <button
              className="btn warn"
              disabled={action !== null}
              onClick={onResolveConflicts}
            >
              Resolve conflicts ({classification.conflictCount})
            </button>
          )}

        {caps.canExport && (
          <button
            className="btn"
            disabled={action !== null}
            onClick={() => void exportSkill()}
          >
            {action === "exporting" ? (
              <>
                <span className="spinner inline" /> Exporting{" "}
              </>
            ) : (
              "Export"
            )}
          </button>
        )}

        {caps.canRevealInFinder && (
          <button className="btn ghost" onClick={reveal} disabled={!absPath}>
            Reveal in Finder
          </button>
        )}

        {caps.canUnregister && onUnregister && (
          <>
            <button
              className="btn"
              disabled={action !== null}
              onClick={() => {
                setAction("unregistering");
                void Promise.resolve(onUnregister()).finally(() =>
                  setAction(null),
                );
              }}
              title="Drop the registry entry. Adopted files move to your shared agents directory; non-adopted entries just drop the index entry. Use Delete from this machine to destroy files."
            >
              {action === "unregistering" ? (
                <>
                  <span className="spinner inline" /> Unregistering{" "}
                </>
              ) : (
                "Unregister"
              )}
            </button>
            <p className="drawer-action-hint">
              {entry.adopted === false
                ? "Drops the registry entry. Your external files stay where they are."
                : "Files move to your shared agents directory. You can then choose Delete from this machine in the Unregistered section to remove them."}
            </p>
          </>
        )}
      </div>

      {restoreOpen && (
        <RestoreOriginModal
          entry={entry}
          onClose={() => setRestoreOpen(false)}
          onDone={async (msg) => {
            setRestoreOpen(false);
            await onChanged(msg);
          }}
        />
      )}

      {repairState.kind === "confirm-delete" && (
        <div role="dialog" aria-modal="true" className="modal-overlay">
          <div ref={confirmDeleteRef} tabIndex={-1} className="modal-body">
            <h3 className="mt-0">
              Couldn't repair broken link
              {repairState.agents.length === 1 ? "" : "s"}
            </h3>
            <p className="text-muted text-13">
              No usable source found for these broken symlink
              {repairState.agents.length === 1 ? "" : "s"}. Delete{" "}
              {repairState.agents.length === 1 ? "it" : "them"}?
            </p>
            <ul className="confirm-delete-list">
              {repairState.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <div className="row-end">
              <button
                className="btn"
                onClick={() => setRepairState({ kind: "idle" })}
              >
                Keep as-is
              </button>
              <button
                className="btn danger"
                onClick={() => void confirmDeleteBroken()}
              >
                Delete broken link{repairState.agents.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
