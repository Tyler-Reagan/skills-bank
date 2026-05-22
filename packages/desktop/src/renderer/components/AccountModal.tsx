import React, { useRef } from "react";
import { BUNDLED_REPO, type AuthStatus } from "../../shared/ipc.js";
import { useFocusReturn, useInitialFocus } from "../hooks/useFocusReturn.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { Icon } from "./Icon.js";

/**
 * Account-domain modal. Owns identity, registry source, and the
 * operations that swap or move the registry as a whole — every
 * setting that asks "who am I and where does my registry live?"
 *
 * No more local-vs-github mode branching: every user sees one
 * Registry-source section (linked repo label, last-fetched chrome,
 * Refresh primary, Change linked repo secondary) and one Identity row
 * (authed → @login + Sign out, unauth → Sign in with GitHub).
 * (See `docs/plans/github-first-onboarding.md`.)
 */
interface Props {
  authStatus: AuthStatus | null;
  appVersion: string;
  onClose: () => void;
  onChangeRegistry: () => void | Promise<void>;
  onRefreshRegistry: () => void | Promise<void>;
  onImportRegistry: () => void | Promise<void>;
  onMergeRegistry: () => void | Promise<void>;
  onExportRegistry: () => void | Promise<void>;
  /**
   * Manifest-shaped moves. Pointer-only — origin pointers per skill,
   * not content. Importing re-fetches each skill from its origin.
   * Merged into the Account surface (was split across Settings pre-
   * v1.6) so registry ops have one home and the seam is clear:
   * Account = "move my registry / sign in", Settings = "app
   * preferences."
   */
  onImportManifest: () => void | Promise<void>;
  onExportManifest: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
  onCheckForUpdates: () => void | Promise<void>;
  onConnectGithub: () => void;
  /**
   * Tier 1 v2 manifest-import affordance. When `true`:
   *   - Import manifest swaps to a busy state + disables.
   *   - Cancel import becomes visible next to Import manifest.
   *   - Corruption-risking siblings (Import folder, Refresh from
   *     repo, Merge registry, Sign out, repo affordances) disable.
   *   - Read-only siblings (Export folder, Export manifest, Check
   *     for updates) stay enabled.
   */
  importingManifest: boolean;
  onCancelImport: () => void;
}

export function AccountModal({
  authStatus,
  appVersion,
  onClose,
  onChangeRegistry,
  onRefreshRegistry,
  onImportRegistry,
  onMergeRegistry,
  onExportRegistry,
  onImportManifest,
  onExportManifest,
  onSignOut,
  onCheckForUpdates,
  onConnectGithub,
  importingManifest,
  onCancelImport,
}: Props): React.ReactElement {
  useFocusReturn();
  useEscapeToClose(onClose);
  const modalRef = useRef<HTMLDivElement | null>(null);
  useInitialFocus(modalRef);

  const user = authStatus?.user ?? null;
  const linkedRepo = authStatus?.linkedRepo ?? null;
  const isAuthed = Boolean(user);
  const isBundledDefault = !linkedRepo || linkedRepo.fullName === BUNDLED_REPO;
  const linkedLabel = isBundledDefault
    ? `Bundled (${BUNDLED_REPO})`
    : `github.com/${linkedRepo!.fullName}`;

  return (
    <div style={overlay} onClick={onClose} role="presentation">
      <div
        ref={modalRef}
        style={modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Account"
        tabIndex={-1}
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
            The GitHub repo your registry mirrors. Refresh re-fetches its
            contents; your local edits and added skills are preserved through
            the diff-before-apply flow.
          </p>
          <div style={sourceRow}>
            <span style={sourceChip}>{linkedLabel}</span>
          </div>
          {linkedRepo && (
            <div style={{ ...hint, marginTop: 8 }}>
              Last fetched: {formatRelativeTime(linkedRepo.lastFetchedAt)} ·{" "}
              <code>{linkedRepo.syncedFromCommit.slice(0, 7)}</code>
            </div>
          )}
          {!linkedRepo && (
            <div style={{ ...hint, marginTop: 8 }}>
              Last fetched: never — click <strong>Refresh</strong> to pull the
              latest.
            </div>
          )}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              marginTop: 10,
            }}
          >
            <button
              className="btn primary"
              type="button"
              onClick={() => void onRefreshRegistry()}
              disabled={importingManifest}
            >
              Refresh from{" "}
              {isBundledDefault ? BUNDLED_REPO : linkedRepo!.fullName}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => void onChangeRegistry()}
              disabled={!isAuthed || importingManifest}
              title={
                isAuthed
                  ? "Pick a different GitHub repo to mirror."
                  : "Sign in with GitHub to pick a different repo."
              }
            >
              {linkedRepo && !isBundledDefault
                ? "Choose a different repo"
                : "Change linked repo"}
            </button>
          </div>
        </section>

        <section style={section}>
          <h3 style={sectionTitle}>Identity</h3>
          {isAuthed ? (
            <>
              <div style={hint}>
                Signed in as <strong>@{user!.login}</strong> · 5000 GitHub API
                requests/hour available for Refresh.
              </div>
              <div style={{ marginTop: 8 }}>
                <button
                  className="btn danger"
                  type="button"
                  onClick={() => void onSignOut()}
                  disabled={importingManifest}
                >
                  Sign out of GitHub
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={hint}>
                Not signed in — Refresh uses the unauthenticated GitHub limit
                (60 requests/hour). Sign in for 5000/hr and access to private
                repos.
              </div>
              <div style={{ marginTop: 8 }}>
                <button
                  className="btn"
                  type="button"
                  onClick={onConnectGithub}
                  disabled={!authStatus?.isAuthConfigured || importingManifest}
                  title={
                    authStatus?.isAuthConfigured
                      ? "Authenticate with GitHub via Device Flow."
                      : "GitHub OAuth isn't configured for this build."
                  }
                >
                  Sign in with GitHub
                </button>
                {!authStatus?.isAuthConfigured && (
                  <div style={{ ...hint, marginTop: 6, fontSize: 11 }}>
                    GitHub OAuth Client ID not set. See{" "}
                    <code>auth-config.ts</code>.
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        <section style={section}>
          <h3 style={sectionTitle}>Move my registry</h3>
          <p style={hint}>
            Two shapes you can move between machines. <strong>Content</strong>{" "}
            moves the entire skills tree — drop-in restore, no network needed.{" "}
            <strong>Manifest</strong> moves a JSON snapshot of origin pointers;
            on import each skill is re-fetched from its origin, so transfers are
            tiny but require the origins to still be reachable.
          </p>

          <div style={subGroupHeader}>
            <span style={subGroupLabel}>Content</span>
            <span style={subGroupHint}>The skills tree itself</span>
          </div>
          <div style={btnStack}>
            <button
              className="btn"
              type="button"
              onClick={() => void onImportRegistry()}
              disabled={importingManifest}
            >
              Import from disk (replace)
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => void onMergeRegistry()}
              disabled={importingManifest}
            >
              Merge from disk
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => void onExportRegistry()}
            >
              Export as folder
            </button>
          </div>

          <div style={subGroupHeader}>
            <span style={subGroupLabel}>Manifest</span>
            <span style={subGroupHint}>Origin pointers, JSON</span>
          </div>
          <div style={btnStack}>
            <button
              className="btn"
              type="button"
              onClick={() => void onImportManifest()}
              disabled={importingManifest}
            >
              {importingManifest ? (
                <>
                  <span className="spinner inline" /> Importing
                </>
              ) : (
                "Import manifest"
              )}
            </button>
            {importingManifest && (
              <button className="btn" type="button" onClick={onCancelImport}>
                Cancel import
              </button>
            )}
            <button
              className="btn"
              type="button"
              onClick={() => void onExportManifest()}
            >
              Export manifest
            </button>
          </div>
        </section>

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

const subGroupHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  marginTop: 16,
  marginBottom: 6,
};

const subGroupLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-2)",
};

const subGroupHint: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-3)",
};

const btnStack: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
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

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "unknown";
  const diffMs = Date.now() - then;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}
