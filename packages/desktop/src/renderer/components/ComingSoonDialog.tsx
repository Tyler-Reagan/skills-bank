import React from "react";
import { Icon } from "./Icon.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";

/**
 * Small reusable explainer for features that have UI entry-points
 * staged but aren't wired up yet. Each call site supplies its own
 * title, body, and "read the plan" link target (a docs/plans/*.md
 * path inside the repo).
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
  useEscapeToClose(onClose);

  if (!open) return null;

  const openPlanInBrowser = () => {
    void window.skillsBank.openExternal(
      `https://github.com/Tyler-Reagan/skills-bank/blob/main/${planDocPath}`,
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal coming-soon-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="coming-soon-title"
      >
        <header className="modal-header">
          <h2 id="coming-soon-title">
            <Icon name="info" size="md" /> {title}
          </h2>
          <button
            className="modal-close"
            type="button"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="x" size="md" />
          </button>
        </header>
        <div className="modal-body">
          <p>
            <strong>Coming soon.</strong> {summary}
          </p>
          <ul>
            {bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <p className="coming-soon-plan-link">
            Full plan:{" "}
            <button
              type="button"
              className="link-btn"
              onClick={openPlanInBrowser}
            >
              {planDocPath}
            </button>
          </p>
        </div>
        <footer className="modal-footer">
          <button className="btn primary" type="button" onClick={onClose}>
            Got it
          </button>
        </footer>
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
      title="Link a GitHub repo (coming soon)"
      summary="A future release will let you back your registry with a GitHub repo. Until it ships, this app stores your registry locally — Export Registry is the path to back it up or move it."
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
