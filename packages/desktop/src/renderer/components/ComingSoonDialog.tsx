import React, { useRef } from "react";
import { Icon } from "./Icon.js";
import { useFocusReturn, useInitialFocus } from "../hooks/useFocusReturn.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";

/**
 * Small reusable explainer for features that have UI entry-points
 * staged but aren't wired up yet. Each call site supplies its own
 * title, body, and "read the plan" link target (a docs/plans/*.md
 * path inside the repo).
 *
 * Matches the inline-CSSProperties modal pattern used by SettingsModal,
 * ConflictResolveModal, and DeleteUnregisteredConfirm — the codebase
 * has no global modal CSS class hierarchy, so each modal carries its
 * own overlay/modal style objects.
 */

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  /** One- or two-sentence summary of what's coming. */
  summary: string;
  /** Bulleted list of concrete capabilities the future PR will land. */
  bullets: string[];
  /** Repo-relative path to the persisted plan doc. */
  planDocPath: string;
}

export function ComingSoonDialog({
  open,
  onClose,
  title,
  summary,
  bullets,
  planDocPath,
}: Props): React.ReactElement | null {
  useFocusReturn();
  useEscapeToClose(onClose);
  const modalRef = useRef<HTMLDivElement | null>(null);
  useInitialFocus(modalRef);

  if (!open) return null;

  // See SettingsModal — local onKeyDown is the belt-and-suspenders
  // fallback when focus lives inside the modal.
  const onModalKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const openPlanInBrowser = () => {
    void window.skillsBank.openExternal(
      `https://github.com/Tyler-Reagan/skills-bank/blob/main/${planDocPath}`,
    );
  };

  return (
    <div
      style={overlay}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={modalRef}
        style={modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="coming-soon-title"
        tabIndex={-1}
        onKeyDown={onModalKeyDown}
      >
        <h2 id="coming-soon-title" style={titleStyle}>
          <span style={titleIcon} aria-hidden="true">
            <Icon name="info" size="md" />
          </span>
          {title}
        </h2>

        <p style={summaryStyle}>
          <span style={leadBadge}>Coming soon</span> {summary}
        </p>

        <ul style={bulletList}>
          {bullets.map((b) => (
            <li key={b} style={bulletItem}>
              {b}
            </li>
          ))}
        </ul>

        <p style={planLinkRow}>
          Full plan:{" "}
          <button
            type="button"
            className="link-btn"
            onClick={openPlanInBrowser}
            style={planLinkButton}
          >
            <code style={planLinkCode}>{planDocPath}</code>
          </button>
        </p>

        <div style={footer}>
          <button className="btn primary" type="button" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

/** Convenience preset for the GitHub-backed mode entry-points. */
export function GitHubLinkComingSoon({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.ReactElement | null {
  return (
    <ComingSoonDialog
      open={open}
      onClose={onClose}
      title="Link a GitHub repo"
      summary="A future release will let you back your registry with a GitHub repo. Until it ships, this app stores your registry locally — Export registry is the path to back it up or move it."
      bullets={[
        "Publish-state chip on every card (Local / Committed / Pushed)",
        "Refresh from git replaces Sync for github-linked registries",
        "Commit & push prompt after Register / Unregister / direct edits",
        "Track-vs-Adopt choice per-skill at Register time",
        "Repoint a tracked-externally skill when its folder moves",
      ]}
      planDocPath="docs/plans/03-github-backed-mode.md"
    />
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--scrim)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const modal: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border-hi)",
  borderRadius: 8,
  padding: 24,
  width: 520,
  maxWidth: "90vw",
  maxHeight: "85vh",
  overflowY: "auto",
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 16,
  fontWeight: 600,
};

const titleIcon: React.CSSProperties = {
  display: "inline-flex",
  color: "var(--accent)",
};

const summaryStyle: React.CSSProperties = {
  margin: "12px 0 0 0",
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--text-2)",
};

const leadBadge: React.CSSProperties = {
  display: "inline-block",
  padding: "1px 8px",
  marginRight: 6,
  borderRadius: 4,
  background: "var(--surface-hi)",
  border: "1px solid var(--border)",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--text-2)",
  verticalAlign: "1px",
};

const bulletList: React.CSSProperties = {
  margin: "14px 0 0 0",
  paddingLeft: 18,
  fontSize: 13,
  lineHeight: 1.6,
  color: "var(--text-1)",
};

const bulletItem: React.CSSProperties = {
  marginBottom: 4,
};

const planLinkRow: React.CSSProperties = {
  margin: "16px 0 0 0",
  paddingTop: 12,
  borderTop: "1px solid var(--border)",
  fontSize: 12,
  color: "var(--text-3)",
};

const planLinkButton: React.CSSProperties = {
  padding: 0,
  fontSize: 12,
};

const planLinkCode: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
};

const footer: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 16,
};
