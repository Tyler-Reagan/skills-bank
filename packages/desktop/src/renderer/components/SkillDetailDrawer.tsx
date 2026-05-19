import React, { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { AgentId, InstalledSkill, RegistryEntry } from "@skills-bank/core";
import { useFocusReturn, useInitialFocus } from "../hooks/useFocusReturn.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { Icon } from "./Icon.js";
import { classifyDrawerState } from "./skillState.js";

const DESCRIPTION_SOFT_CAP = 400;

function formatStarCount(stars: number): string {
  if (stars >= 1000) return `${(stars / 1000).toFixed(stars >= 10000 ? 0 : 1)}k`;
  return String(stars);
}

interface Props {
  entry: RegistryEntry;
  installed: InstalledSkill[];
  registryRoot: string | null;
  onClose: () => void;
  onChanged: (msg: string) => void | Promise<void>;
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
   * Canon-drift heal — keep-mine arm. Clears the canonical marker
   * so future syncs leave the skill alone. Only meaningful in the
   * canon-drift state.
   */
  onAcceptDrift?: () => Promise<void> | void;
  /**
   * Canon-drift heal — take-canonical arm. Re-snapshots the current
   * on-disk hash as the canonical baseline; drift clears, source
   * stays canonical, Sync still owns the skill. Use when drift
   * surfaced spuriously and the current state is acceptable.
   */
  onTakeCanonical?: () => Promise<void> | void;
  /**
   * Upstream-drift heal — revert arm. Re-fetches from the linked
   * upstream via `npx skills update`, discarding local edits.
   * Companion to `onAcceptDrift` in the
   * `user-edited-with-upstream` heal flow.
   */
  onTakeUpstream?: () => Promise<void> | void;
  /**
   * Apply an available upstream update in place. Same backend as
   * `onTakeUpstream` but surfaced in the
   * `upstream-update-available` state where there's no local
   * drift to clobber.
   */
  onUpdate?: () => Promise<void> | void;
  /**
   * Settings → "Show upstream activity" toggle. When true and the
   * skill has a GitHub upstream, the drawer fetches and displays
   * the latest commit touching the skill's folder. Costs 1 GitHub
   * API call per skill (no repo dedup); gated to opt-in to keep
   * heavy registries from pressuring the rate-limit budget.
   */
  showUpstreamActivity?: boolean;
  /**
   * Stamp a manual upstream pointer onto a skill the scanner
   * couldn't classify automatically (no matching CLI lock entry,
   * name collision, or hand-authored skill the user wants to tag).
   * `null` choice means user clicked "this is mine" → kind: "none".
   * Renderer refreshes after the call resolves.
   */
  onSetManualUpstream?: (
    choice:
      | { kind: "github"; repo: string; skillPath: string }
      | { kind: "none" },
  ) => Promise<{ ok: boolean; message: string }>;
  /**
   * M6: missing-entry heal. Forget the registry/external record.
   * Only meaningful in registry-folder-missing and
   * external-target-missing.
   */
  onForgetMissing?: () => Promise<void> | void;
  /**
   * Repoint a non-adopted entry whose target moved on disk. Opens a
   * directory picker in main, validates SKILL.md, rewrites the
   * external.json target. Only granted in external-target-missing.
   */
  onRepoint?: () => Promise<void> | void;
}

type ActionState =
  | null
  | "installing"
  | "exporting"
  | "registering"
  | "unregistering"
  | "hiding"
  | "unhiding"
  | "accepting-drift"
  | "taking-canonical"
  | "taking-upstream"
  | "updating"
  | "forgetting"
  | "repointing";

export function SkillDetailDrawer({
  entry,
  installed,
  registryRoot,
  onClose,
  onChanged,
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
  onTakeCanonical,
  onTakeUpstream,
  onUpdate,
  onForgetMissing,
  onRepoint,
  showUpstreamActivity,
  onSetManualUpstream,
}: Props): React.ReactElement {
  const [skillMd, setSkillMd] = useState<string | null>(null);
  const [skillMdLoading, setSkillMdLoading] = useState(true);
  const [action, setAction] = useState<ActionState>(null);
  const [repoMeta, setRepoMeta] = useState<
    import("../../shared/ipc.js").OriginRepoMetadata | null
  >(null);
  const [lastCommit, setLastCommit] = useState<
    import("../../shared/ipc.js").OriginLastCommit | null
  >(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerRepo, setPickerRepo] = useState("");
  const [pickerPath, setPickerPath] = useState("");
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const pickerRepoRef = useRef<HTMLInputElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (pickerOpen) pickerRepoRef.current?.focus();
  }, [pickerOpen]);
  // The drawer slides in from the right (~280ms). Until it lands,
  // its hit area is offscreen — a click on the eventual drawer position
  // would land on the overlay underneath and dismiss the drawer the
  // user just opened. Guard the overlay's close handler until the
  // entrance animation settles.
  const [overlayReady, setOverlayReady] = useState(false);

  useFocusReturn();
  useInitialFocus(drawerRef);
  const confirmDeleteRef = useRef<HTMLDivElement | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  const [tagDraft, setTagDraft] = useState<string[]>(entry.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [tagInputError, setTagInputError] = useState<string | null>(null);
  const [savingTags, setSavingTags] = useState(false);

  // SKILL.md fetch keys purely on the skill name. Splitting this off
  // from the tag-reset effect prevents a re-fetch every time the parent
  // hands us a refreshed `entry` reference with the same `name` (e.g.
  // after a registry refresh that only bumped a sibling skill).
  useEffect(() => {
    let cancelled = false;
    setSkillMd(null);
    setSkillMdLoading(true);
    void window.skillsBank.readSkillMd(entry.name).then((md) => {
      if (!cancelled) {
        setSkillMd(md);
        setSkillMdLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entry.name]);

  // Reset drawer-local UI state when the selected entry changes
  // identity (a different skill, or the same skill with a refreshed
  // tag list). Cheap synchronous resets; runs independently of the
  // SKILL.md fetch above.
  useEffect(() => {
    setDescExpanded(false);
    setEditingTags(false);
    setTagDraft(entry.tags ?? []);
    setTagInput("");
  }, [entry.name, entry.tags]);

  useEscapeToClose(onClose);

  useEffect(() => {
    const id = window.setTimeout(() => setOverlayReady(true), 300);
    return () => window.clearTimeout(id);
  }, []);

  // Fetch source-repo metadata (stars, description) when an Origin
  // section is visible. Main process caches per-repo with a 15-min
  // TTL so consecutive drawer opens for skills from the same repo
  // don't re-hit GitHub. Result `null` until the fetch resolves;
  // the drawer omits the stars chip and description when fields
  // are null.
  const upstreamRepo = entry.source.upstream?.repo;
  const upstreamSkillPath = entry.source.upstream?.skillPath;
  useEffect(() => {
    setRepoMeta(null);
    if (!upstreamRepo) return;
    let cancelled = false;
    void window.skillsBank
      .originRepoMetadata(upstreamRepo)
      .then((m) => {
        if (!cancelled) setRepoMeta(m);
      })
      .catch(() => {
        // Errors degrade to no enrichment.
      });
    return () => {
      cancelled = true;
    };
  }, [upstreamRepo]);

  // Per-skill last-commit fetch, opt-in via Settings. Costs 1 GitHub
  // API call per skill (no repo dedup) so it stays off by default.
  useEffect(() => {
    setLastCommit(null);
    if (!showUpstreamActivity) return;
    if (!upstreamRepo || !upstreamSkillPath) return;
    let cancelled = false;
    void window.skillsBank
      .originLastCommit(upstreamRepo, upstreamSkillPath)
      .then((c) => {
        if (!cancelled) setLastCommit(c);
      })
      .catch(() => {
        // Silent degrade.
      });
    return () => {
      cancelled = true;
    };
  }, [upstreamRepo, upstreamSkillPath, showUpstreamActivity]);

  const [repairState, setRepairState] = useState<
    | { kind: "idle" }
    | { kind: "running" }
    | {
        kind: "confirm-delete";
        agents: import("@skills-bank/core").AgentId[];
        reasons: string[];
      }
  >({ kind: "idle" });
  // Drawer trap is suspended while the confirm-delete sub-dialog is
  // mounted — focus belongs to the inner dialog, not the drawer.
  useFocusTrap(drawerRef, repairState.kind !== "confirm-delete");
  useFocusTrap(confirmDeleteRef, repairState.kind === "confirm-delete");
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
      ? description.slice(0, DESCRIPTION_SOFT_CAP).trimEnd()
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
          <button
            type="button"
            className="drawer-close"
            onClick={onClose}
            aria-label="Close skill details"
            title="Close skill details (Esc)"
          >
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
                        type="button"
                        className="tag-remove"
                        aria-label={`Remove tag ${t}`}
                        title={`Remove tag ${t}`}
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

          {isRegistered &&
            entry.adopted !== false &&
            !entry.source.upstream &&
            onSetManualUpstream && (
              <div className="drawer-section">
                <h3>Origin</h3>
                {!pickerOpen ? (
                  <div
                    style={{
                      display: "flex",
                      gap: "var(--s3)",
                      alignItems: "center",
                    }}
                  >
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        setPickerOpen(true);
                        setPickerError(null);
                      }}
                    >
                      Link origin
                    </button>
                    <span style={{ color: "var(--text-3)", fontSize: 12 }}>
                      ·
                    </span>
                    <button
                      type="button"
                      className="link-btn"
                      disabled={pickerBusy}
                      onClick={async () => {
                        setPickerBusy(true);
                        await onSetManualUpstream({ kind: "none" });
                        setPickerBusy(false);
                      }}
                    >
                      Mark as local
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="form-field">
                      <label htmlFor="picker-repo">Repo</label>
                      <input
                        id="picker-repo"
                        ref={pickerRepoRef}
                        type="text"
                        className="input"
                        placeholder="owner/name"
                        value={pickerRepo}
                        onChange={(e) => setPickerRepo(e.target.value)}
                        disabled={pickerBusy}
                      />
                      <p className="form-field-hint">e.g. vercel-labs/skills</p>
                    </div>
                    <div className="form-field">
                      <label htmlFor="picker-path">Path</label>
                      <input
                        id="picker-path"
                        type="text"
                        className="input"
                        placeholder="skills/my-skill/SKILL.md"
                        value={pickerPath}
                        onChange={(e) => setPickerPath(e.target.value)}
                        disabled={pickerBusy}
                      />
                      <p className="form-field-hint">
                        Path to SKILL.md within the repo
                      </p>
                    </div>
                    {pickerError && (
                      <p
                        style={{
                          color: "var(--danger)",
                          fontSize: 12,
                          margin: "var(--s2) 0",
                        }}
                        role="alert"
                      >
                        {pickerError}
                      </p>
                    )}
                    <div
                      style={{
                        display: "flex",
                        gap: "var(--s3)",
                        alignItems: "center",
                        marginTop: "var(--s3)",
                      }}
                    >
                      <button
                        type="button"
                        className="btn primary"
                        disabled={
                          pickerBusy || !pickerRepo.trim() || !pickerPath.trim()
                        }
                        onClick={async () => {
                          setPickerBusy(true);
                          setPickerError(null);
                          const r = await onSetManualUpstream({
                            kind: "github",
                            repo: pickerRepo.trim(),
                            skillPath: pickerPath.trim(),
                          });
                          if (!r.ok) {
                            setPickerError(r.message);
                            setPickerBusy(false);
                          } else {
                            setPickerOpen(false);
                            setPickerBusy(false);
                          }
                        }}
                      >
                        {pickerBusy ? (
                          <>
                            <span className="spinner inline" /> Validating…
                          </>
                        ) : (
                          "Link"
                        )}
                      </button>
                      <button
                        type="button"
                        className="link-btn"
                        disabled={pickerBusy}
                        onClick={() => {
                          setPickerOpen(false);
                          setPickerError(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          {entry.source.upstream?.kind === "github" &&
            entry.source.upstream.repo && (
              <div className="drawer-section">
                <h3>Origin</h3>
                <div className="drawer-meta-row">
                  <span className="drawer-meta-key">from</span>
                  <span className="drawer-meta-value">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() =>
                        void window.skillsBank.openExternal(
                          `https://github.com/${entry.source.upstream!.repo!}`,
                        )
                      }
                      title="Open the source repo on GitHub"
                    >
                      github.com/{entry.source.upstream.repo}
                    </button>
                    {repoMeta?.stars !== null &&
                      repoMeta?.stars !== undefined && (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 11,
                            color: "var(--text-3)",
                          }}
                          title={`${repoMeta.stars} stars on GitHub`}
                        >
                          ★ {formatStarCount(repoMeta.stars)}
                        </span>
                      )}
                  </span>
                </div>
                {repoMeta?.description && (
                  <div className="drawer-meta-row">
                    <span className="drawer-meta-key">about</span>
                    <span
                      className="drawer-meta-value"
                      style={{ fontStyle: "italic" }}
                    >
                      {repoMeta.description}
                    </span>
                  </div>
                )}
                {entry.source.upstream.skillPath && (
                  <div className="drawer-meta-row">
                    <span className="drawer-meta-key">path in repo</span>
                    <span className="drawer-meta-value">
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => {
                          const repo = entry.source.upstream!.repo!;
                          const skillPath = entry.source.upstream!.skillPath!;
                          // Strip the trailing /SKILL.md so the link
                          // opens the folder view rather than the file.
                          const folder = skillPath.replace(/\/SKILL\.md$/, "");
                          void window.skillsBank.openExternal(
                            `https://github.com/${repo}/tree/HEAD/${folder}`,
                          );
                        }}
                        title="Open the skill's folder on GitHub"
                      >
                        {entry.source.upstream.skillPath.replace(
                          /\/SKILL\.md$/,
                          "/",
                        )}
                      </button>
                    </span>
                  </div>
                )}
                {entry.source.upstream.skillFolderHash && (
                  <div className="drawer-meta-row">
                    <span className="drawer-meta-key">fetched hash</span>
                    <span className="drawer-meta-value">
                      <code>
                        {entry.source.upstream.skillFolderHash.slice(0, 7)}
                      </code>
                    </span>
                  </div>
                )}
                {entry.source.upstream.fetchedAt && (
                  <div className="drawer-meta-row">
                    <span className="drawer-meta-key">last fetched</span>
                    <span className="drawer-meta-value">
                      {new Date(
                        entry.source.upstream.fetchedAt,
                      ).toLocaleDateString()}
                    </span>
                  </div>
                )}
                {showUpstreamActivity &&
                  lastCommit?.sha &&
                  lastCommit?.date && (
                    <div className="drawer-meta-row">
                      <span className="drawer-meta-key">last Origin commit</span>
                      <span className="drawer-meta-value">
                        {new Date(lastCommit.date).toLocaleDateString()} ·{" "}
                        <code>{lastCommit.sha.slice(0, 7)}</code>
                        {lastCommit.message && (
                          <span
                            style={{
                              marginLeft: 6,
                              color: "var(--text-3)",
                              fontSize: 11,
                            }}
                            title={lastCommit.message}
                          >
                            {lastCommit.message.length > 60
                              ? lastCommit.message.slice(0, 60) + "…"
                              : lastCommit.message}
                          </span>
                        )}
                      </span>
                    </div>
                  )}
              </div>
            )}

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
                    <span className="spinner inline" /> Registering…
                  </>
                ) : (
                  "Register in registry"
                )}
              </button>
              <p className="drawer-action-hint">
                Files move into your registry's skills/ directory unless you
                turn off adoption in Settings. Preserved through Refresh via
                diff-before-apply; cross-agent linkable. If your registry
                mirrors a GitHub repo, commit to persist across machines.
              </p>
            </>
          )}

          {/* Drift heal — fan-out by source axis. The classifier emits
              `canAcceptDrift` for both bundled-sync drift and upstream-
              pointer drift; render the sub-arm and hint copy that
              matches the actual axis on this entry.

              Copy migrated to the canonical glossary verbs:
                user-edited-with-upstream:  [Reset to origin] (primary, danger)  [Unlink origin]
                bundled-skill-edited:       [Re-baseline]     (primary)          [Accept drift] */}
          {caps.canAcceptDrift && onAcceptDrift && (
            <>
              {caps.canTakeUpstream && onTakeUpstream && (
                <button
                  className="btn danger"
                  disabled={action !== null}
                  onClick={() => {
                    setAction("taking-upstream");
                    void Promise.resolve(onTakeUpstream()).finally(() =>
                      setAction(null),
                    );
                  }}
                  title={`Discard local edits and re-fetch from ${entry.source.upstream?.repo ?? "Origin"}. Your changes are lost.`}
                >
                  {action === "taking-upstream" ? (
                    <>
                      <span className="spinner inline" /> Resetting…
                    </>
                  ) : (
                    "Reset to origin"
                  )}
                </button>
              )}
              {caps.canTakeCanonical && onTakeCanonical && (
                <button
                  className="btn primary"
                  disabled={action !== null}
                  onClick={() => {
                    setAction("taking-canonical");
                    void Promise.resolve(onTakeCanonical()).finally(() =>
                      setAction(null),
                    );
                  }}
                  title="Re-baseline the current on-disk state as canonical. Drift clears; the skill stays under Sync, which can still overwrite on the next pull."
                >
                  {action === "taking-canonical" ? (
                    <>
                      <span className="spinner inline" /> Re-baselining…
                    </>
                  ) : (
                    "Re-baseline"
                  )}
                </button>
              )}
              <button
                className="btn"
                disabled={action !== null}
                onClick={() => {
                  setAction("accepting-drift");
                  void Promise.resolve(onAcceptDrift()).finally(() =>
                    setAction(null),
                  );
                }}
                title={
                  caps.canTakeUpstream
                    ? "Keep your local edits and clear the Origin pointer. Future probes won't surface this skill as having an update available."
                    : "Keep your local edits and stop treating this skill as canonical. Future syncs won't overwrite it."
                }
              >
                {action === "accepting-drift" ? (
                  <>
                    <span className="spinner inline" />{" "}
                    {caps.canTakeUpstream ? "Unlinking…" : "Accepting…"}
                  </>
                ) : caps.canTakeUpstream ? (
                  "Unlink origin"
                ) : (
                  "Accept drift"
                )}
              </button>
              <p className="drawer-action-hint">
                {caps.canTakeUpstream ? (
                  <>
                    Your local copy diverges from{" "}
                    {entry.source.upstream?.repo ?? "its Origin"}.
                    <strong> Reset to origin</strong> discards your edits and
                    refetches.
                    <strong> Unlink origin</strong> keeps your edits and clears
                    the Origin pointer.
                  </>
                ) : (
                  <>
                    This canonical skill differs from its synced baseline.
                    <strong> Re-baseline</strong> re-snaps the current state as
                    the new synced version; Sync still owns the skill.
                    <strong> Accept drift</strong> detaches from Sync — your
                    edits stay, Sync stops overwriting.
                  </>
                )}
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
                  void Promise.resolve(onUpdate()).finally(() =>
                    setAction(null),
                  );
                }}
                title={`Fetch the latest content from ${
                  entry.source.upstream?.repo ?? "the Origin"
                } and mirror it into this skill.`}
              >
                {action === "updating" ? (
                  <>
                    <span className="spinner inline" /> Updating…
                  </>
                ) : (
                  "Update"
                )}
              </button>
              <p className="drawer-action-hint">
                A newer version is available from{" "}
                <code>{entry.source.upstream?.repo ?? "Origin"}</code>. Local
                content is unchanged since the last fetch, so the update applies
                cleanly.
              </p>
            </>
          )}
          {caps.canRepoint && onRepoint && (
            <button
              className="btn primary"
              disabled={action !== null}
              onClick={() => {
                setAction("repointing");
                void Promise.resolve(onRepoint()).finally(() =>
                  setAction(null),
                );
              }}
              title="Pick the folder the skill moved to. Updates the registry entry's target path."
            >
              {action === "repointing" ? (
                <>
                  <span className="spinner inline" /> Picking…
                </>
              ) : (
                "Pick new location"
              )}
            </button>
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
                    <span className="spinner inline" /> Forgetting…
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
            (caps.canManageLinks || caps.canExport) && (
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
            <>
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
                title="Drop the registry entry. Adopted files move to your shared agents directory; non-adopted entries just drop the index entry. Use Delete from this machine to destroy files."
              >
                {action === "unregistering" ? (
                  <>
                    <span className="spinner inline" /> Removing…
                  </>
                ) : (
                  "Remove from registry"
                )}
              </button>
              <p className="drawer-action-hint">
                {entry.adopted === false
                  ? "Drops the registry entry. Your external files stay where they are."
                  : "Files move to your shared agents directory. You can then choose Delete from this machine in the Unregistered section to remove them."}
              </p>
            </>
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
                "Dismiss from registry view"
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
                void Promise.resolve(onUnhide()).finally(() => setAction(null));
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
            ref={confirmDeleteRef}
            tabIndex={-1}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border-hi)",
              borderRadius: 8,
              padding: 24,
              width: 480,
              maxWidth: "90vw",
              outline: "none",
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
    </>
  );
}
