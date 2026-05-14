import React, { useRef } from "react";
import type { AuthStatus } from "../../shared/ipc.js";
import { useFocusReturn, useInitialFocus } from "../hooks/useFocusReturn.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { Icon } from "./Icon.js";

/**
 * Account-domain modal. Owns identity, registry source, and the
 * operations that swap or move the registry as a whole — every
 * setting that asks "who am I and where does my registry live?"
 *
 * Distinct from SettingsModal, which owns "how the app behaves
 * day-to-day" preferences. The two surfaces are reachable from two
 * separate header triggers; there is no longer a native dropdown
 * intermediating between them.
 */
interface Props {
  authStatus: AuthStatus | null;
  appVersion: string;
  onClose: () => void;
  onChangeRegistry: () => void | Promise<void>;
  onMergeRegistry: () => void | Promise<void>;
  onExportRegistry: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
  onCheckForUpdates: () => void | Promise<void>;
  onOpenGitHubLinkComingSoon: () => void;
  onOpenPromoteToGitHubComingSoon: () => void;
}

export function AccountModal({
  authStatus,
  appVersion,
  onClose,
  onChangeRegistry,
  onMergeRegistry,
  onExportRegistry,
  onSignOut,
  onCheckForUpdates,
  onOpenGitHubLinkComingSoon,
  onOpenPromoteToGitHubComingSoon,
}: Props): React.ReactElement {
  useFocusReturn();
  useEscapeToClose(onClose);
  const modalRef = useRef<HTMLDivElement | null>(null);
  useInitialFocus(modalRef);

  const onModalKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const isGithub = authStatus?.registrySource === "github";
  const sourceChipLabel = isGithub
    ? `@${authStatus?.user?.login ?? "you"}`
    : "Local bundled";

  return (
    <div style={overlay}>
      <div
        ref={modalRef}
        style={modal}
        role="dialog"
        aria-modal="true"
        aria-label="Account"
        tabIndex={-1}
        onKeyDown={onModalKeyDown}
      >
        <div style={modalHeader}>
          <h2 style={{ margin: 0 }}>Account</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            style={closeBtn}
          >
            <Icon name="x" size="md" />
          </button>
        </div>

        <section style={section}>
          <h3 style={sectionTitle}>Registry source</h3>
          <p style={hint}>
            Where your registry lives. Linking a GitHub repo is on the way —
            see the persisted plan for details.
          </p>
          <div style={sourceRow}>
            <span style={sourceChip}>{sourceChipLabel}</span>
            <span style={{ ...hint, marginLeft: 8 }}>
              {isGithub
                ? "Linked to a GitHub repo."
                : "Bundled set shipped with the app."}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 8,
            }}
          >
            <button
              className="btn"
              type="button"
              onClick={onOpenGitHubLinkComingSoon}
            >
              Link a GitHub repo… (Coming soon)
            </button>
            {!isGithub && (
              <button
                className="btn"
                type="button"
                onClick={onOpenPromoteToGitHubComingSoon}
              >
                Promote to a GitHub repo… (Coming soon)
              </button>
            )}
          </div>
        </section>

        <section style={section}>
          <h3 style={sectionTitle}>Registry operations</h3>
          <p style={hint}>
            Move your registry to another machine or bring in skills from
            another bank.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {isGithub ? (
              <button
                className="btn"
                type="button"
                onClick={() => void onChangeRegistry()}
              >
                Choose registry repo…
              </button>
            ) : (
              <button
                className="btn"
                type="button"
                onClick={() => void onChangeRegistry()}
              >
                Import a registry (replace)…
              </button>
            )}
            {!isGithub && (
              <button
                className="btn"
                type="button"
                onClick={() => void onMergeRegistry()}
              >
                Merge a registry into mine…
              </button>
            )}
            <button
              className="btn"
              type="button"
              onClick={() => void onExportRegistry()}
            >
              Export registry…
            </button>
          </div>
        </section>

        {isGithub && (
          <section style={section}>
            <h3 style={sectionTitle}>Identity</h3>
            <div style={hint}>
              Signed in as <strong>@{authStatus?.user?.login ?? "you"}</strong>
            </div>
            <div style={{ marginTop: 8 }}>
              <button
                className="btn danger"
                type="button"
                onClick={() => void onSignOut()}
              >
                Sign out of GitHub
              </button>
            </div>
          </section>
        )}

        <section style={{ ...section, marginTop: 12 }}>
          <h3 style={sectionTitle}>About this app</h3>
          <div style={hint}>
            Version <code>{appVersion}</code>
          </div>
          <div style={{ marginTop: 8 }}>
            <button
              className="btn"
              type="button"
              onClick={() => void onCheckForUpdates()}
            >
              <Icon name="refresh" size="sm" /> Check for app updates
            </button>
          </div>
        </section>

        <div style={footer}>
          <button className="btn primary" type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
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
  width: 560,
  maxWidth: "90vw",
  maxHeight: "85vh",
  overflowY: "auto",
  outline: "none",
};

const modalHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  marginBottom: 4,
};

const closeBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "var(--text-3)",
  padding: 4,
  borderRadius: 4,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const section: React.CSSProperties = {
  marginTop: 16,
  paddingTop: 12,
  borderTop: "1px solid var(--border)",
};

const sectionTitle: React.CSSProperties = {
  margin: "0 0 6px 0",
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-2)",
};

const hint: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-3)",
  margin: "4px 0",
  lineHeight: 1.5,
};

const sourceRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  marginTop: 8,
};

const sourceChip: React.CSSProperties = {
  display: "inline-block",
  padding: "3px 10px",
  borderRadius: 12,
  background: "var(--surface-hi)",
  border: "1px solid var(--border)",
  fontSize: 12,
  fontWeight: 600,
};

const footer: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 16,
  paddingTop: 12,
  borderTop: "1px solid var(--border)",
};
