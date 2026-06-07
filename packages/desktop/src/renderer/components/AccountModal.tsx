import React from "react";
import { BUNDLED_REPO, type AuthStatus } from "../../shared/ipc.js";
import { InfoTooltip } from "./primitives.js";
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
  onClose: () => void;
  onChangeRegistry: () => void | Promise<void>;
  onRefreshRegistry: () => void | Promise<void>;
  onImportRegistry: () => void | Promise<void>;
  onMergeRegistry: () => void | Promise<void>;
  /**
   * Manifest-shaped moves. Open the ManifestModal for the appropriate
   * mode — the modal owns the full transport flow (repo or disk).
   */
  onOpenImportManifest: () => void;
  onOpenExportManifest: () => void;
  onSignOut: () => void | Promise<void>;
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
  onClose,
  onChangeRegistry,
  onRefreshRegistry,
  onImportRegistry,
  onMergeRegistry,
  onOpenImportManifest,
  onOpenExportManifest,
  onSignOut,
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

      <div className="prefs-group">
        <p className="prefs-group-label">GitHub</p>
        <div className="prefs-card account-kv-table">
          <div className="account-kv-row">
            <span className="account-kv-key">Account</span>
            <div className="account-kv-val">
              {isAuthed ? (
                <span>@{user!.login}</span>
              ) : (
                <span className="account-hint">Not signed in</span>
              )}
            </div>
            <div className="account-kv-action">
              {isAuthed ? (
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => void onSignOut()}
                  disabled={importingManifest}
                >
                  Sign out
                </button>
              ) : (
                <button
                  className="btn ghost"
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
              )}
            </div>
          </div>

          <div className="account-kv-row">
            <span className="account-kv-key">Repository</span>
            <div className="account-kv-val">
              <span className="account-source-chip">{linkedLabel}</span>
              <div className="account-kv-meta">
                {linkedRepo
                  ? `Last fetched: ${formatRelativeTime(linkedRepo.lastFetchedAt)} · ${linkedRepo.syncedFromCommit.slice(0, 7)}`
                  : "Last fetched: never"}
              </div>
            </div>
            <div className="account-kv-action">
              <button
                className="btn ghost"
                type="button"
                onClick={() => void onChangeRegistry()}
                disabled={!isAuthed || importingManifest}
                title={
                  isAuthed
                    ? "Pick a different GitHub repo to mirror."
                    : "Sign in with GitHub to pick a different repo."
                }
              >
                Change
              </button>
            </div>
          </div>
        </div>

        {!isAuthed && !authStatus?.isAuthConfigured && (
          <div className="account-hint mt-6 text-11">
            GitHub OAuth Client ID not set. See <code>auth-config.ts</code>.
          </div>
        )}
      </div>

      <div className="prefs-group">
        <p className="prefs-group-label">Manage your registry</p>
        <div className="prefs-card">
          <div className="prefs-row">
            <span className="prefs-row-label">
              Manifest
              <InfoTooltip
                label="About manifest transfers"
                text="A manifest moves a JSON snapshot of metadata for each skill. On import, each skill is re-fetched from its origin, so transfers are tiny but require the origins to still be reachable."
              />
            </span>
            <span className="prefs-row-control account-subgroup-hint">
              Origin pointers, JSON
            </span>
          </div>
          <div className="prefs-row">
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
              <button
                className="btn"
                type="button"
                onClick={onOpenExportManifest}
              >
                Export manifest
              </button>
            </div>
          </div>
        </div>
      </div>

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
