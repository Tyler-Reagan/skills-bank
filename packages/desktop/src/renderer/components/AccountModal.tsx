import React from "react";
import { BUNDLED_REPO, type AuthStatus } from "../../shared/ipc.js";
import { Icon } from "./Icon.js";
import { Modal, ModalCloseButton, modalHeader } from "./modalStyles.js";

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
   * Manifest-shaped moves. Open the ManifestModal for the appropriate
   * mode — the modal owns the full transport flow (repo or disk).
   */
  onOpenImportManifest: () => void;
  onOpenExportManifest: () => void;
  onSignOut: () => void | Promise<void>;
  onCheckForUpdates: () => void | Promise<void>;
  onConnectGithub: () => void;
  /**
   * Tier 1 v2 manifest-import affordance. When `true`, corruption-
   * risking siblings disable. The cancel button lives inside
   * ManifestModal now.
   */
  importingManifest: boolean;
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
  onOpenImportManifest,
  onOpenExportManifest,
  onSignOut,
  onCheckForUpdates,
  onConnectGithub,
  importingManifest,
}: Props): React.ReactElement {
  const user = authStatus?.user ?? null;
  const linkedRepo = authStatus?.linkedRepo ?? null;
  const isAuthed = Boolean(user);
  const isBundledDefault = !linkedRepo || linkedRepo.fullName === BUNDLED_REPO;
  const linkedLabel = isBundledDefault
    ? `Bundled (${BUNDLED_REPO})`
    : `github.com/${linkedRepo!.fullName}`;

  return (
    <Modal label="Account" onClose={onClose} width={560}>
      <div className={modalHeader}>
        <h2 className="mt-0 mb-0">Account</h2>
        <ModalCloseButton onClose={onClose} />
      </div>

      <section className="account-section">
        <h3 className="account-section-title">Registry source</h3>
        <p className="account-hint">
          The GitHub repo your registry mirrors. Refresh re-fetches its
          contents; your local edits and added skills are preserved through the
          diff-before-apply flow.
        </p>
        <div className="account-source-row">
          <span className="account-source-chip">{linkedLabel}</span>
        </div>
        {linkedRepo && (
          <div className="account-hint mt-8">
            Last fetched: {formatRelativeTime(linkedRepo.lastFetchedAt)} ·{" "}
            <code>{linkedRepo.syncedFromCommit.slice(0, 7)}</code>
          </div>
        )}
        {!linkedRepo && (
          <div className="account-hint mt-8">
            Last fetched: never — click <strong>Refresh</strong> to pull the
            latest.
          </div>
        )}
        <div className="account-btn-stack mt-10">
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

      <section className="account-section">
        <h3 className="account-section-title">Identity</h3>
        {isAuthed ? (
          <>
            <div className="account-hint">
              Signed in as <strong>@{user!.login}</strong> · 5000 GitHub API
              requests/hour available for Refresh.
            </div>
            <div className="mt-8">
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
            <div className="account-hint">
              Not signed in — Refresh uses the unauthenticated GitHub limit (60
              requests/hour). Sign in for 5000/hr and access to private repos.
            </div>
            <div className="mt-8">
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
                <div className="account-hint mt-6 text-11">
                  GitHub OAuth Client ID not set. See{" "}
                  <code>auth-config.ts</code>.
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <section className="account-section">
        <h3 className="account-section-title">Move my registry</h3>
        <p className="account-hint">
          Two shapes you can move between machines. <strong>Content</strong>{" "}
          moves the entire skills tree — drop-in restore, no network needed.{" "}
          <strong>Manifest</strong> moves a JSON snapshot of origin pointers; on
          import each skill is re-fetched from its origin, so transfers are tiny
          but require the origins to still be reachable.
        </p>

        <div className="account-subgroup-header">
          <span className="account-subgroup-label">Content</span>
          <span className="account-subgroup-hint">The skills tree itself</span>
        </div>
        <div className="account-btn-stack">
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

        <div className="account-subgroup-header">
          <span className="account-subgroup-label">Manifest</span>
          <span className="account-subgroup-hint">Origin pointers, JSON</span>
        </div>
        <div className="account-btn-stack">
          <button
            className="btn"
            type="button"
            onClick={onOpenImportManifest}
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
          <button className="btn" type="button" onClick={onOpenExportManifest}>
            Export manifest
          </button>
        </div>
      </section>

      <section className="account-section mt-12">
        <h3 className="account-section-title">About this app</h3>
        <div className="account-hint">
          Version <code>{appVersion}</code>
        </div>
        <div className="mt-8">
          <button
            className="btn"
            type="button"
            onClick={() => void onCheckForUpdates()}
          >
            <Icon name="refresh" size="sm" /> Check for app updates
          </button>
        </div>
      </section>

      <div className="account-footer">
        <button className="btn primary" type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

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
