import React, { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";
import { useFocusReturn, useInitialFocus } from "../hooks/useFocusReturn.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { Icon } from "./Icon.js";
import { usePersona } from "../PersonaContext.js";
import { classifyDrawerState } from "./skillState.js";

const DESCRIPTION_SOFT_CAP = 400;

interface Props {
  entry: RegistryEntry;
  installed: InstalledSkill[];
  registryRoot: string | null;
  onClose: () => void;
  onChanged: (msg: string) => void | Promise<void>;
  /** Called specifically after a successful uninstall so the host can offer Undo. */
  onUninstalled?: (
    name: string,
    agentsBefore: import("@skills-bank/core").AgentId[],
  ) => void;
  /** Open the dedicated "Manage agent links" modal for this skill. */
  onManageLinks?: () => void;
  /**
   * Open the conflict-resolve modal for non-ours, non-broken
   * installations of a registered skill (e.g. leftover real-dir
   * duplicates after CLI installs). Only relevant when isRegistered.
   */
  onResolveConflicts?: () => void;
  /**
   * Surfaces an install-time conflict (foreign symlink blocking the
   * install). Host opens the InstallConflictModal so the user can pick
   * Force / Resolve / Cancel.
   */
  onInstallConflict?: (payload: {
    name: string;
    errors: Array<{
      agent: import("@skills-bank/core").AgentId;
      message: string;
    }>;
  }) => void;
  /**
   * When true, the entry is a real registry-managed skill: tag editing,
   * install/uninstall, and Markdown loading from the registry path all
   * apply. When false, the entry is a synthetic stand-in for a skill
   * that lives only in some agent dir(s); the drawer offers a "Register
   * in registry" action instead, and hides registry-only chrome.
   */
  isRegistered: boolean;
  /**
   * Trigger registration into the registry for a not-yet-registered
   * entry. Required when isRegistered is false; ignored otherwise.
   * Whether files move into the bank or stay at their origin is
   * controlled by `settings.registerAdopts` (M3 collapsed the prior
   * adopt vs. register-as-external split into one action).
   */
  onRegister?: () => Promise<void> | void;
  /**
   * Optional override of which agent dirs to install into. When omitted,
   * install broadcasts to every existing agent dir (legacy behavior).
   */
  defaultInstallAgents?: import("@skills-bank/core").AgentId[];
  /**
   * M4: mid-tier destructive action. For adopted skills, moves files
   * to the configured agents dir. For non-adopted, drops the entry
   * with origin files untouched. Distinct from Delete from Skills
   * Bank (which destroys files) and Remove from agents (which only
   * severs symlinks).
   */
  onUnregister?: () => Promise<void> | void;
  /**
   * M5: canon-only. Tuck the skill out of the default views. Replaces
   * Unregister/Delete on canon skills (those are prohibited since
   * canon is upstream-owned).
   */
  onHide?: () => Promise<void> | void;
  /** M5: undo Hide. Only meaningful in the canon-hidden state. */
  onUnhide?: () => Promise<void> | void;
  /**
   * M6: canon-drift heal. Accept local edits — clears the canonical
   * marker so future syncs leave the skill alone. Only meaningful in
   * the canon-drift state.
   */
  onAcceptDrift?: () => Promise<void> | void;
  /**
   * M6: missing-entry heal. Forget the registry/external record.
   * Only meaningful in registry-folder-missing and
   * external-target-missing.
   */
  onForgetMissing?: () => Promise<void> | void;
  /**
   * M7: open the per-agent picker so the user can uninstall from a
   * subset of agent dirs instead of all of them. Default Remove
   * from agents still hits everything.
   */
  onChooseAgentsToUninstall?: () => void;
}

type ActionState =
  | null
  | "installing"
  | "uninstalling"
  | "exporting"
  | "registering"
  | "unregistering"
  | "hiding"
  | "unhiding"
  | "accepting-drift"
  | "forgetting"
  | "deleting";

export function SkillDetailDrawer({
  entry,
  installed,
  registryRoot,
  onClose,
  onChanged,
  onUninstalled,
  onManageLinks,
  onResolveConflicts,
  onInstallConflict,
  isRegistered,
  onRegister,
  defaultInstallAgents,
  onUnregister,
  onHide,
  onUnhide,
  onAcceptDrift,
  onForgetMissing,
  onChooseAgentsToUninstall,
}: Props): React.ReactElement {
  const persona = usePersona();
  const [skillMd, setSkillMd] = useState<string | null>(null);
  const [skillMdLoading, setSkillMdLoading] = useState(true);
  const [action, setAction] = useState<ActionState>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  // The drawer slides in from the right (~280ms). Until it lands,
  // its hit area is offscreen — a click on the eventual drawer position
  // would land on the overlay underneath and dismiss the drawer the
  // user just opened. Guard the overlay's close handler until the
  // entrance animation settles.
  const [overlayReady, setOverlayReady] = useState(false);

  useFocusReturn();
  useInitialFocus(drawerRef);
  const [descExpanded, setDescExpanded] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  const [tagDraft, setTagDraft] = useState<string[]>(entry.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [tagInputError, setTagInputError] = useState<string | null>(null);
  const [savingTags, setSavingTags] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSkillMd(null);
    setSkillMdLoading(true);
    setDescExpanded(false);
    setEditingTags(false);
    setTagDraft(entry.tags ?? []);
    setTagInput("");
    void window.skillsBank.readSkillMd(entry.name).then((md) => {
      if (!cancelled) {
        setSkillMd(md);
        setSkillMdLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entry.name, entry.tags]);

  useEscapeToClose(onClose);

  useEffect(() => {
    const id = window.setTimeout(() => setOverlayReady(true), 300);
    return () => window.clearTimeout(id);
  }, []);

  const [repairState, setRepairState] = useState<
    | { kind: "idle" }
    | { kind: "running" }
    | {
        kind: "confirm-delete";
        agents: import("@skills-bank/core").AgentId[];
        reasons: string[];
      }
  >({ kind: "idle" });
  const [showDeleteFromBankConfirm, setShowDeleteFromBankConfirm] =
    useState(false);
  const linkedAgentCount = installed.filter(
    (i) => i.name === entry.name && i.kind === "ours",
  ).length;
  // Single source of truth for which actions are valid in this state.
  // Replaces the previous scatter of isRegistered/isInstalled/hasConflicts
  // /hasBrokenLinks conditionals across the action block. See plan §7b.
  const classification = classifyDrawerState(entry, installed, isRegistered);
  const caps = classification.capabilities;

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
  // Synthetic entries (not-registered skills) carry an absolute linkPath
  // as `entry.path`; registered entries carry a relative `skills/<name>`.
  // Compose vs. use-as-is so Reveal in Finder works in both cases.
  const absPath = entry.path.startsWith("/")
    ? entry.path
    : registryRoot
      ? `${registryRoot}/${entry.path}`
      : entry.path;

  const renderedMd = useMemo(() => {
    if (!skillMd) return null;
    const html = marked.parse(skillMd, { breaks: true, async: false });
    return DOMPurify.sanitize(html as string);
  }, [skillMd]);

  const description = entry.description;
  const isLongDescription = description.length > DESCRIPTION_SOFT_CAP;
  const visibleDescription =
    !descExpanded && isLongDescription
      ? description.slice(0, DESCRIPTION_SOFT_CAP).trimEnd() + "…"
      : description;

  const install = async () => {
    setAction("installing");
    try {
      const r = await window.skillsBank.install(
        entry.name,
        false,
        defaultInstallAgents,
      );
      // "refusing to overwrite without force" comes from installSkill
      // when a non-symlink or foreign symlink blocks the target path.
      // Surface the structured errors so the host can open the
      // InstallConflictModal instead of dropping a vague toast.
      const forceErrors = (r.errors ?? []).filter((e) =>
        /refusing to overwrite without force/i.test(e.message),
      );
      if (!r.ok && forceErrors.length > 0 && onInstallConflict) {
        onInstallConflict({ name: entry.name, errors: forceErrors });
        return;
      }
      await onChanged(r.message);
    } finally {
      setAction(null);
    }
  };
  const uninstall = async () => {
    // Capture the agents this skill is currently linked into BEFORE the
    // IPC fires, so the undo toast can re-install to the same set
    // rather than the default broadcast.
    const agentsBefore = installed
      .filter((i) => i.name === entry.name && i.kind === "ours")
      .map((i) => i.agent);
    setAction("uninstalling");
    try {
      const r = await window.skillsBank.uninstall(entry.name);
      if (r.ok && onUninstalled) {
        await onChanged(r.message);
        onUninstalled(entry.name, agentsBefore);
      } else {
        await onChanged(r.message);
      }
    } finally {
      setAction(null);
    }
  };
  const deleteFromBank = async () => {
    setAction("deleting");
    try {
      // Close the drawer BEFORE the IPC resolves so React never renders
      // a frame where `entry` references a deleted registry name.
      const name = entry.name;
      onClose();
      const r = await window.skillsBank.deregister(name);
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

  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    if (t.length > 64) {
      setTagInputError(`tag is ${t.length} chars; 64 max`);
      return;
    }
    if (tagDraft.includes(t)) {
      setTagInputError(`"${t}" is already in the list`);
      return;
    }
    setTagDraft([...tagDraft, t]);
    setTagInput("");
    setTagInputError(null);
  };
  const removeTag = (t: string) => {
    setTagDraft(tagDraft.filter((x) => x !== t));
  };
  const cancelTagEdit = () => {
    setEditingTags(false);
    setTagDraft(entry.tags ?? []);
    setTagInput("");
    setTagInputError(null);
  };
  const saveTags = async () => {
    setSavingTags(true);
    try {
      const r = await window.skillsBank.editTags(entry.name, tagDraft);
      if (r.ok) {
        setEditingTags(false);
        await onChanged(r.message);
      } else {
        await onChanged(`tag save failed: ${r.message}`);
      }
    } finally {
      setSavingTags(false);
    }
  };

  return (
    <>
      <div
        className="drawer-overlay"
        onClick={overlayReady ? onClose : undefined}
        aria-hidden="true"
      />
      <aside
        ref={drawerRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${entry.name} details`}
      >
        <div className="drawer-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 18,
                wordBreak: "break-word",
              }}
            >
              {entry.name}
            </h2>
            {entry.version && (
              <p
                style={{
                  fontSize: 12,
                  color: "var(--text-3)",
                  fontFamily: "var(--font-mono)",
                  marginTop: 2,
                }}
              >
                v{entry.version}
              </p>
            )}
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size="lg" />
          </button>
        </div>

        <div className="drawer-body">
          {entry.warnings && entry.warnings.length > 0 && (
            <div className="drawer-warnings">
              <strong>
                <Icon name="alert-triangle" size="sm" /> {entry.warnings.length}{" "}
                {entry.warnings.length === 1 ? "warning" : "warnings"}
              </strong>
              <ul>
                {entry.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="drawer-section">
            <h3>Description</h3>
            {description ? (
              <>
                <p>{visibleDescription}</p>
                {isLongDescription && (
                  <button
                    className="link-btn"
                    onClick={() => setDescExpanded((v) => !v)}
                  >
                    {descExpanded ? "Show less" : "Show more"}
                  </button>
                )}
              </>
            ) : (
              <p style={{ color: "var(--text-3)", fontStyle: "italic" }}>
                (no description)
              </p>
            )}
          </div>

          <div className="drawer-section">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <h3 style={{ margin: 0 }}>Tags</h3>
              {!editingTags ? (
                <button
                  className="link-btn"
                  onClick={() => setEditingTags(true)}
                >
                  Edit
                </button>
              ) : (
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="link-btn"
                    onClick={cancelTagEdit}
                    disabled={savingTags}
                  >
                    Cancel
                  </button>
                  <button
                    className="link-btn"
                    style={{ color: "var(--accent)" }}
                    onClick={() => void saveTags()}
                    disabled={savingTags}
                  >
                    {savingTags ? "Saving…" : "Save"}
                  </button>
                </div>
              )}
            </div>
            {editingTags ? (
              <div>
                <div className="skill-tags" style={{ marginBottom: 8 }}>
                  {tagDraft.map((t) => (
                    <span key={t} className="skill-tag editable">
                      #{t}
                      <button
                        className="tag-remove"
                        aria-label={`remove ${t}`}
                        onClick={() => removeTag(t)}
                      >
                        <Icon name="x" size="sm" />
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => {
                    setTagInput(e.target.value);
                    if (tagInputError) setTagInputError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="add a tag, press Enter"
                  className={`tag-input ${tagInputError ? "invalid" : ""}`}
                  aria-invalid={tagInputError ? true : undefined}
                  aria-describedby={
                    tagInputError ? "tag-input-error" : undefined
                  }
                />
                {tagInputError && (
                  <p id="tag-input-error" className="form-error" role="alert">
                    {tagInputError}
                  </p>
                )}
              </div>
            ) : entry.tags && entry.tags.length > 0 ? (
              <div className="skill-tags">
                {entry.tags.map((t) => (
                  <span key={t} className="skill-tag">
                    #{t}
                  </span>
                ))}
              </div>
            ) : (
              <p
                style={{
                  color: "var(--text-3)",
                  fontStyle: "italic",
                  fontSize: 12,
                }}
              >
                (no tags)
              </p>
            )}
          </div>

          <div className="drawer-section">
            <h3>Metadata</h3>
            {entry.author && (
              <div className="drawer-meta-row">
                <span className="drawer-meta-key">author</span>
                <span className="drawer-meta-value">{entry.author}</span>
              </div>
            )}
            <div className="drawer-meta-row">
              <span className="drawer-meta-key">path</span>
              <span className="drawer-meta-value">{entry.path}</span>
            </div>
            {entry.lastCommit && (
              <div className="drawer-meta-row">
                <span className="drawer-meta-key">last commit</span>
                <span className="drawer-meta-value">
                  {new Date(entry.lastCommit.date).toLocaleDateString()} ·{" "}
                  {entry.lastCommit.sha.slice(0, 7)}
                </span>
              </div>
            )}
          </div>

          <div className="drawer-section">
            <h3>SKILL.md preview</h3>
            {skillMdLoading ? (
              <div
                aria-label="Loading SKILL.md preview"
                aria-busy="true"
                role="status"
              >
                {[100, 86, 92, 70, 96, 64].map((width, i) => (
                  <div
                    key={i}
                    className="skeleton skeleton-line"
                    style={{
                      width: `${width}%`,
                      animationDelay: `${i * 60}ms`,
                    }}
                  />
                ))}
              </div>
            ) : renderedMd ? (
              <div
                className="skill-md-preview md"
                dangerouslySetInnerHTML={{ __html: renderedMd }}
              />
            ) : (
              <div className="empty-inline">
                <p style={{ color: "var(--text-3)", fontStyle: "italic" }}>
                  No <code>SKILL.md</code> in this folder.
                </p>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={reveal}
                  disabled={!registryRoot}
                >
                  <Icon name="folder" size="sm" /> Open folder to create one
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="drawer-actions">
          {/* Action block is gated by classifyDrawerState. Each button
              has both a capability flag (should it appear?) and a
              primary marker (should it be styled as the primary call to
              action?). The primary action renders first, regardless of
              category, so the user's eye lands on the right move for
              the current state. See skillState.ts for the table. */}

          {/* Register — primary for unregistered states with adoptable
              source. The persona hint stays with this affordance. */}
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
                    <span className="spinner inline" /> Registering…
                  </>
                ) : (
                  "Register in registry"
                )}
              </button>
              <p className="drawer-action-hint">
                {persona === "power"
                  ? "Files move into your repo's skills/ directory unless you turn off adoption in Settings. Commit to persist."
                  : "Files move to the app's local registry unless you turn off adoption in Settings. Safe from Pull updates; linkable across agents."}
              </p>
            </>
          )}

          {/* M6 heal primaries — accept-drift / forget-missing.
              Single-option flows: present one action with explanatory
              copy rather than burying the choice. */}
          {caps.canAcceptDrift && onAcceptDrift && (
            <>
              <button
                className="btn warn"
                disabled={action !== null}
                onClick={() => {
                  setAction("accepting-drift");
                  void Promise.resolve(onAcceptDrift()).finally(() =>
                    setAction(null),
                  );
                }}
                title="Keep your local edits and stop treating this skill as canonical. Future syncs won't overwrite it."
              >
                {action === "accepting-drift" ? (
                  <>
                    <span className="spinner inline" /> Accepting…
                  </>
                ) : (
                  "Accept local changes"
                )}
              </button>
              <p className="drawer-action-hint">
                This canonical skill has been edited locally. Accepting
                clears the canonical marker — sync will leave it alone
                going forward.
              </p>
            </>
          )}
          {caps.canForgetMissing && onForgetMissing && (
            <>
              <button
                className="btn warn"
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
                    <span className="spinner inline" /> Forgetting…
                  </>
                ) : (
                  "Forget this entry"
                )}
              </button>
              <p className="drawer-action-hint">
                The files for this skill are gone. Forgetting drops the
                registry record so the skill stops appearing.
              </p>
            </>
          )}

          {/* Repair broken — primary in *-broken states. Two-step:
              first try repair, then prompt delete for unrepairable. */}
          {caps.canRepairBroken && caps.primary === "repair-broken" && (
            <button
              className="btn warn"
              disabled={action !== null || repairState.kind === "running"}
              onClick={() => void repairOrRemoveBroken()}
              title="Try to repoint broken symlinks at a usable source. Unrepairable links can be deleted in the next step."
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              {repairState.kind === "running" ? (
                <>
                  <span className="spinner inline" /> Repairing…
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
              ConflictResolveModal in its level-pure mode (delete/keep
              only) so this Needs-attention action does not silently
              also register the skill. After resolution the card lands
              in Unregistered for the separate Register step. */}
          {caps.canResolveRegistrationConflicts &&
            caps.primary === "resolve-registration-conflicts" &&
            onResolveConflicts && (
              <button
                className="btn warn"
                disabled={action !== null}
                onClick={onResolveConflicts}
                title={`This skill name appears in ${classification.conflictCount + classification.brokenCount} agent dir(s) with different sources. Pick which copy to keep; the rest will be deleted.`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <Icon name="alert-triangle" size="sm" />
                Resolve{" "}
                {classification.conflictCount + classification.brokenCount}{" "}
                conflict
                {classification.conflictCount + classification.brokenCount ===
                1
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
                className="btn warn"
                disabled={action !== null}
                onClick={onResolveConflicts}
                title={`${classification.conflictCount} agent dir(s) have duplicate or stale entries for this skill`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
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
            (caps.canRemoveFromAgents ||
              caps.canManageLinks ||
              caps.canExport) && (
              <div
                role="separator"
                aria-hidden="true"
                style={{
                  gridColumn: "1 / -1",
                  height: 1,
                  background: "var(--border)",
                  margin: "8px 0 4px",
                }}
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
                  <span className="spinner inline" /> Installing…
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

          {/* Remove from agents — primary in registered-healthy,
              secondary in registered-conflicts / registered-mixed-broken.
              M7: when the skill is linked into more than one agent,
              expose a per-agent picker next to the bulk-remove button
              so the user can target a subset. */}
          {caps.canRemoveFromAgents && (
            <button
              className="btn"
              disabled={action !== null}
              onClick={() => void uninstall()}
              title="Stop linking this skill into your agent directories. The skill stays in Skills Bank — re-add it any time."
            >
              {action === "uninstalling" ? (
                <>
                  <span className="spinner inline" /> Removing…
                </>
              ) : (
                "Remove from agents"
              )}
            </button>
          )}
          {caps.canRemoveFromAgents &&
            linkedAgentCount > 1 &&
            onChooseAgentsToUninstall && (
              <button
                className="btn ghost"
                disabled={action !== null}
                onClick={onChooseAgentsToUninstall}
                title="Pick specific agent dirs to remove from. The skill stays in the others."
              >
                Choose agents…
              </button>
            )}

          {/* Manage agent links — only meaningful when there's a
              registry target to link to. Hidden for unregistered skills
              and for registered-broken (no working source to relink). */}
          {caps.canManageLinks && onManageLinks && (
            <button
              className="btn"
              disabled={action !== null}
              onClick={onManageLinks}
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
                  <span className="spinner inline" /> Repairing…
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
                  <span className="spinner inline" /> Exporting…
                </>
              ) : (
                "Export"
              )}
            </button>
          )}

          {caps.canRevealInFinder && (
            <button
              className="btn ghost"
              style={{ gridColumn: "1 / -1" }}
              onClick={reveal}
              disabled={!absPath}
            >
              Reveal in Finder
            </button>
          )}
          {caps.canUnregister && onUnregister && (
            <button
              className="btn"
              style={{ gridColumn: "1 / -1" }}
              disabled={action !== null}
              onClick={() => {
                setAction("unregistering");
                void Promise.resolve(onUnregister()).finally(() =>
                  setAction(null),
                );
              }}
              title="Remove from the registry. Adopted files move to your shared agents directory; non-adopted entries just drop the index entry."
            >
              {action === "unregistering" ? (
                <>
                  <span className="spinner inline" /> Unregistering…
                </>
              ) : (
                "Unregister"
              )}
            </button>
          )}
          {caps.canHide && onHide && (
            <button
              className="btn"
              style={{ gridColumn: "1 / -1" }}
              disabled={action !== null}
              onClick={() => {
                setAction("hiding");
                void Promise.resolve(onHide()).finally(() => setAction(null));
              }}
              title="Tuck this canon skill out of the default views. Installations and metadata are kept; you can unhide from Settings."
            >
              {action === "hiding" ? (
                <>
                  <span className="spinner inline" /> Hiding…
                </>
              ) : (
                "Hide"
              )}
            </button>
          )}
          {caps.canUnhide && onUnhide && (
            <button
              className="btn primary"
              style={{ gridColumn: "1 / -1" }}
              disabled={action !== null}
              onClick={() => {
                setAction("unhiding");
                void Promise.resolve(onUnhide()).finally(() =>
                  setAction(null),
                );
              }}
            >
              {action === "unhiding" ? (
                <>
                  <span className="spinner inline" /> Unhiding…
                </>
              ) : (
                "Unhide"
              )}
            </button>
          )}
          {caps.canDeleteFromBank && (
            <>
              {/* Separator carries the "danger zone" boundary so the button
                  itself can stay visually consistent with the others (no
                  double border, no off-center label). 12px above / 4px
                  below tracks the 8dp rhythm used elsewhere in the drawer
                  while giving the danger button room to breathe. */}
              <div
                role="separator"
                aria-hidden="true"
                style={{
                  gridColumn: "1 / -1",
                  height: 1,
                  background: "var(--border)",
                  margin: "12px 0 4px",
                }}
              />
              <button
                className="btn danger"
                style={{
                  gridColumn: "1 / -1",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
                disabled={action !== null}
                onClick={() => setShowDeleteFromBankConfirm(true)}
                title="Permanently delete the skill's files from Skills Bank. Symlinks in agent directories are removed too. Re-importing is the only way back."
              >
                {action === "deleting" ? (
                  <>
                    <span className="spinner inline" /> Deleting…
                  </>
                ) : (
                  <>
                    <Icon name="alert-triangle" size="sm" /> Delete from Skills
                    Bank
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </aside>
      {repairState.kind === "confirm-delete" && (
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
              width: 480,
              maxWidth: "90vw",
            }}
          >
            <h3 style={{ marginTop: 0 }}>
              Couldn't repair broken link
              {repairState.agents.length === 1 ? "" : "s"}
            </h3>
            <p style={{ color: "var(--text-2)", fontSize: 13 }}>
              No usable source found for these broken symlink
              {repairState.agents.length === 1 ? "" : "s"}. Delete{" "}
              {repairState.agents.length === 1 ? "it" : "them"}?
            </p>
            <ul
              style={{
                margin: "8px 0",
                padding: "8px 12px",
                background: "var(--surface-hi)",
                borderRadius: 4,
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: "var(--text-3)",
                listStyle: "none",
                maxHeight: 160,
                overflowY: "auto",
              }}
            >
              {repairState.reasons.map((r) => (
                <li key={r} style={{ padding: "2px 0" }}>
                  {r}
                </li>
              ))}
            </ul>
            <div
              style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}
            >
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
      {showDeleteFromBankConfirm && (
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
              width: 480,
              maxWidth: "90vw",
            }}
          >
            <h3 style={{ marginTop: 0 }}>
              Delete {entry.name} from Skills Bank?
            </h3>
            <p style={{ color: "var(--text-2)", fontSize: 13, margin: 0 }}>
              The skill's files will be deleted from Skills Bank.
            </p>
            <p
              style={{
                color: "var(--text-2)",
                fontSize: 13,
                marginTop: 4,
                marginBottom: 0,
              }}
            >
              {linkedAgentCount} symlink
              {linkedAgentCount === 1 ? "" : "s"} in agent director
              {linkedAgentCount === 1 ? "y" : "ies"} will also be removed.
            </p>
            <p
              style={{
                color: "var(--text-3)",
                fontSize: 12,
                marginTop: 8,
                fontStyle: "italic",
              }}
            >
              You'll need to re-import the skill from GitHub or your source to
              get it back.
            </p>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 16,
              }}
            >
              <button
                className="btn"
                onClick={() => setShowDeleteFromBankConfirm(false)}
                disabled={action === "deleting"}
              >
                Cancel
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  setShowDeleteFromBankConfirm(false);
                  void deleteFromBank();
                }}
                disabled={action === "deleting"}
              >
                Delete skill
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
