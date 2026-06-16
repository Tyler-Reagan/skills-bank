import React, { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";
import { useFocusReturn, useInitialFocus } from "../hooks/useFocusReturn.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { useIpcQuery } from "../hooks/useIpcQuery.js";
import { useRegisterModal } from "../ModalRegistryContext.js";
import { Icon } from "./Icon.js";
import { classifyDrawerState } from "./skillState.js";
import { DrawerLabelSection } from "./DrawerLabelSection.js";
import { DrawerOriginSection } from "./DrawerOriginSection.js";
import { DrawerActions } from "./DrawerActions.js";

export interface ReviewContext {
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
}

const DESCRIPTION_SOFT_CAP = 400;

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
   * entry. Records the skill in place (files stay at their origin); the
   * host's shared hook chains a move-into-bank afterward only when the
   * global auto-move toggle is on and the skill isn't a keep-in-place
   * custom-dir source.
   */
  onRegister?: () => Promise<void> | void;
  /**
   * Relocate an already-registered in-place skill into the bank. Only
   * surfaced when `caps.canMoveIntoBank` is set (a registered,
   * non-adopted entry) — the explicit opt-in adopt for a skill that was
   * recorded in place.
   */
  onMoveIntoBank?: () => Promise<void> | void;
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
  /** Apply an available upstream update in place. */
  onUpdate?: () => Promise<void> | void;
  /**
   * Settings → "Show upstream activity" toggle. When true and the
   * skill has a GitHub upstream, the drawer fetches and displays
   * the latest commit touching the skill's folder. Costs 1 GitHub
   * API call per skill (no repo dedup); gated to opt-in to keep
   * heavy registries from pressuring the rate-limit budget.
   */
  showOriginActivity?: boolean;
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
  /** When set, the drawer shows review navigation (prev/next/exit). */
  reviewContext?: ReviewContext | null;
  /** Elevates the overlay above an open modal (z-index: 1200). */
  elevated?: boolean;
}

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
  onMoveIntoBank,
  defaultInstallAgents,
  onUnregister,
  onHide,
  onUnhide,
  onUpdate,
  onForgetMissing,
  onRepoint,
  showOriginActivity,
  onSetManualUpstream,
  reviewContext,
  elevated,
}: Props): React.ReactElement {
  const drawerRef = useRef<HTMLElement | null>(null);
  // The drawer slides in from the right (~280ms). Until it lands,
  // its hit area is offscreen — a click on the eventual drawer position
  // would land on the overlay underneath and dismiss the drawer the
  // user just opened. Guard the overlay's close handler until the
  // entrance animation settles.
  const [overlayReady, setOverlayReady] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);

  useFocusReturn();
  useInitialFocus(drawerRef);
  // Drawer participates in the open-modal count so the Discover-tab
  // WebContentsView yields while the drawer is up. The drawer renders
  // its own slide-in chrome (not <Modal>), so it registers directly.
  useRegisterModal();

  // SKILL.md fetch keys purely on the skill name. Splitting this off
  // from the tag-reset effect prevents a re-fetch every time the parent
  // hands us a refreshed `entry` reference with the same `name` (e.g.
  // after a registry refresh that only bumped a sibling skill).
  const { data: skillMd, loading: skillMdLoading } = useIpcQuery(
    () => window.skillsBank.readSkillMd(entry.name),
    [entry.name],
  );

  // Reset drawer-local UI state when the selected skill changes.
  // Cheap synchronous reset; runs independently of the SKILL.md fetch above.
  useEffect(() => {
    setDescExpanded(false);
  }, [entry.name]);

  useEscapeToClose(onClose);

  useEffect(() => {
    const id = window.setTimeout(() => setOverlayReady(true), 300);
    return () => window.clearTimeout(id);
  }, []);

  // Single source of truth for which actions are valid in this state.
  const classification = classifyDrawerState(entry, installed, isRegistered);

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

  return (
    <div
      className={`drawer-overlay${elevated ? " drawer-overlay--elevated" : ""}`}
      // Backdrop click closes; click-on-dialog bubbles up here but
      // the currentTarget check filters those out so the dialog body
      // doesn't dismiss on every interaction.
      onClick={(e) => {
        if (!overlayReady) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${entry.name} details`}
      >
        <div className="drawer-header">
          <div className="flex-1-min0">
            <h2 className="mono text-18 break-word">{entry.name}</h2>
            {entry.version && (
              <p className="text-12 text-subtle mono mt-2">v{entry.version}</p>
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
        {reviewContext && (
          <div className="drawer-review-bar">
            <span className="drawer-review-label">
              Reviewing{" "}
              <span className="drawer-review-count">
                {reviewContext.index + 1} / {reviewContext.total}
              </span>
            </span>
            <button
              type="button"
              className="drawer-review-exit"
              onClick={reviewContext.onExit}
            >
              Exit <Icon name="x" size="sm" />
            </button>
          </div>
        )}

        <div className="drawer-main">
          <div className="drawer-body">
            {entry.warnings && entry.warnings.length > 0 && (
              <div className="drawer-warnings">
                <strong>
                  <Icon name="alert-triangle" size="sm" />{" "}
                  {entry.warnings.length}{" "}
                  {entry.warnings.length === 1 ? "warning" : "warnings"}
                </strong>
                <ul>
                  {entry.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="drawer-section lede">
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
                <p className="text-subtle italic">(no description)</p>
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
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="skeleton skeleton-line" />
                  ))}
                </div>
              ) : renderedMd ? (
                <div
                  className="skill-md-preview md"
                  dangerouslySetInnerHTML={{ __html: renderedMd }}
                />
              ) : (
                <div className="empty-inline">
                  <p className="text-subtle italic">
                    No <code>SKILL.md</code> in this folder.
                  </p>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() =>
                      absPath
                        ? void window.skillsBank.openInFinder(absPath)
                        : undefined
                    }
                    disabled={!registryRoot}
                    aria-label="Open the registry folder so you can create a SKILL.md"
                  >
                    <Icon name="folder" size="sm" /> Open folder to create one
                  </button>
                </div>
              )}
            </div>

            <DrawerOriginSection
              entry={entry}
              isRegistered={isRegistered}
              showOriginActivity={showOriginActivity}
              onSetManualUpstream={onSetManualUpstream}
            />

            <DrawerLabelSection entry={entry} />

            {reviewContext && (
              <div className="drawer-review-nav">
                <button
                  type="button"
                  className="btn"
                  onClick={reviewContext.onPrev}
                  disabled={reviewContext.index === 0}
                >
                  ← Prev
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={reviewContext.onNext}
                  disabled={reviewContext.index === reviewContext.total - 1}
                >
                  Next →
                </button>
              </div>
            )}

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
          </div>

          <DrawerActions
            entry={entry}
            installed={installed}
            isRegistered={isRegistered}
            absPath={absPath}
            defaultInstallAgents={defaultInstallAgents}
            classification={classification}
            drawerRef={drawerRef}
            onInstallConflict={onInstallConflict}
            onChanged={onChanged}
            onClose={onClose}
            onManageLinks={onManageLinks}
            onResolveConflicts={onResolveConflicts}
            onRegister={onRegister}
            onMoveIntoBank={onMoveIntoBank}
            onUnregister={onUnregister}
            onHide={onHide}
            onUnhide={onUnhide}
            onUpdate={onUpdate}
            onForgetMissing={onForgetMissing}
            onRepoint={onRepoint}
          />
        </div>
      </aside>
    </div>
  );
}
