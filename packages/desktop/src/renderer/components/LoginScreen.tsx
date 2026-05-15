import React, { useEffect, useState } from "react";
import type {
  AuthStatus,
  DeviceFlowResumePayload,
  DeviceFlowStartPayload,
} from "../../shared/ipc.js";
import { Icon } from "./Icon.js";

interface Props {
  isAuthConfigured: boolean;
  onStatusChanged: (status: AuthStatus) => void;
}

/**
 * First-launch onboarding card. Two equal options — no "mode picker"
 * framing, since there are no separate local-vs-github modes:
 *
 *   1. **Use the public skills bank** (default) — sets linkedRepo=null
 *      and parks the user in the bundled-default state. No auth needed;
 *      Refresh pulls from `Tyler-Reagan/skills-bank` at the unauth
 *      GitHub rate limit (60/hr).
 *   2. **Connect with GitHub** — Device Flow → RepoPickerModal, with
 *      `Tyler-Reagan/skills-bank` pre-listed as the Recommended row.
 *      Pick the bundled repo (same content, 5000/hr) or pick a custom
 *      repo to host your own registry.
 *   3. **Self-host** (footnote) — opens fork-and-build docs in the
 *      browser; doesn't change app state.
 *
 * On mount we probe for a persisted in-progress flow from a prior
 * session (the app quit / crashed mid-poll). If present and not yet
 * expired, the user sees a Resume / Start over recovery card instead
 * of the path-picker. (See `docs/plans/github-first-onboarding.md`.)
 */
export function LoginScreen({
  isAuthConfigured,
  onStatusChanged,
}: Props): React.ReactElement {
  const [flow, setFlow] = useState<DeviceFlowStartPayload | null>(null);
  const [resumable, setResumable] = useState<DeviceFlowResumePayload | null>(
    null,
  );
  const [pollError, setPollError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.skillsBank.authResumeDeviceFlow().then((r) => {
      if (r) setResumable(r);
    });
  }, []);

  const skip = async () => {
    setBusy(true);
    try {
      const status = await window.skillsBank.authSetRegistrySourceLocal();
      onStatusChanged(status);
    } finally {
      setBusy(false);
    }
  };

  const beginAuth = async () => {
    setPollError(null);
    setBusy(true);
    try {
      const f = await window.skillsBank.authStartDeviceFlow();
      setFlow(f);
      setPolling(true);
      try {
        const status = await window.skillsBank.authPollDeviceFlow(f.flowId);
        onStatusChanged(status);
      } catch (err) {
        const msg = (err as Error).message;
        setPollError(prettyDeviceFlowError(msg));
      } finally {
        setPolling(false);
      }
    } catch (err) {
      setPollError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancelFlow = async () => {
    if (flow) {
      await window.skillsBank.authCancelDeviceFlow(flow.flowId);
    }
    setFlow(null);
    setPolling(false);
    setPollError(null);
  };

  const resumeFlow = async () => {
    if (!resumable) return;
    setPollError(null);
    setBusy(true);
    setPolling(true);
    // Promote the resumable payload into the same shape the flow-active
    // branch renders. expiresIn/interval aren't used by the renderer
    // after the initial render — they're only relayed back to GitHub
    // by the main-process poll loop.
    setFlow({
      flowId: resumable.flowId,
      userCode: resumable.userCode,
      verificationUri: resumable.verificationUri,
      expiresIn: Math.max(
        0,
        Math.floor((resumable.expiresAt - Date.now()) / 1000),
      ),
      interval: 5,
    });
    setResumable(null);
    try {
      const status = await window.skillsBank.authPollDeviceFlow(
        resumable.flowId,
      );
      onStatusChanged(status);
    } catch (err) {
      const msg = (err as Error).message;
      setPollError(prettyDeviceFlowError(msg));
    } finally {
      setPolling(false);
      setBusy(false);
    }
  };

  const startOver = async () => {
    if (resumable) {
      await window.skillsBank.authCancelDeviceFlow(resumable.flowId);
    }
    setResumable(null);
  };

  const openSelfHost = async () => {
    const r = await window.skillsBank.openSelfHostDocs();
    if (!r.ok) {
      setPollError(r.message ?? "could not open self-host docs");
    }
  };

  if (resumable && !flow) {
    const minutesLeft = Math.max(
      0,
      Math.floor((resumable.expiresAt - Date.now()) / 60000),
    );
    return (
      <div className="setup-screen">
        <div className="setup-card">
          <div className="setup-brand">
            skills<span>-</span>bank
          </div>
          <h1>Resume GitHub authentication?</h1>
          <p>
            An in-progress authentication from a previous session is still valid
            (about {minutesLeft} minute{minutesLeft === 1 ? "" : "s"}{" "}
            remaining). If you completed the GitHub side, Resume will pick up
            the token. Otherwise pick Start over.
          </p>
          <div className="device-code-box">
            <code className="device-code">{resumable.userCode}</code>
          </div>
          <button
            type="button"
            className="btn primary setup-cta"
            disabled={busy}
            onClick={() => void resumeFlow()}
          >
            <Icon name="check" size="sm" /> Resume GitHub authentication
          </button>
          <p className="setup-footnote">
            <button
              type="button"
              className="link-btn"
              disabled={busy}
              onClick={() => void startOver()}
            >
              Start over
            </button>
          </p>
        </div>
      </div>
    );
  }

  if (flow) {
    return (
      <div className="setup-screen">
        <div className="setup-card">
          <div className="setup-brand">
            skills<span>-</span>bank
          </div>
          <h1>Authenticate with GitHub</h1>
          <p>Open the link below and enter this code:</p>
          <div className="device-code-box">
            <code className="device-code">{flow.userCode}</code>
            <button
              type="button"
              className="btn"
              onClick={() => {
                void navigator.clipboard.writeText(flow.userCode);
              }}
            >
              <Icon name="check" size="sm" /> Copy code
            </button>
          </div>
          <button
            type="button"
            className="btn primary setup-cta"
            onClick={() =>
              void window.skillsBank.openExternal(flow.verificationUri)
            }
          >
            <Icon name="external-link" size="sm" /> Open {flow.verificationUri}
          </button>
          {polling && (
            <p className="setup-hint" role="status" aria-live="polite">
              <span className="spinner inline" /> Waiting for you to authorize
              the app
            </p>
          )}
          {pollError && (
            <p className="setup-error" role="alert">
              <Icon name="alert-triangle" size="sm" /> {pollError}
            </p>
          )}
          <p className="setup-footnote">
            <button
              type="button"
              className="link-btn"
              onClick={() => void cancelFlow()}
            >
              Cancel and go back
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-brand">
          skills<span>-</span>bank
        </div>
        <h1>Welcome to skills-bank</h1>
        <p>
          Pick a starting point. You can change your mind later from Account.
        </p>

        <div className="login-options">
          <button
            type="button"
            className="login-option"
            disabled={busy}
            onClick={() => void skip()}
          >
            <strong>Use the public skills bank</strong>
            <span>
              Browse and install from the curated{" "}
              <code>Tyler-Reagan/skills-bank</code> repo. No GitHub account
              needed. Refresh pulls the latest at the unauthenticated GitHub
              rate limit (60/hr) — sign in later for 5000/hr.
            </span>
          </button>

          <button
            type="button"
            className="login-option"
            disabled={!isAuthConfigured || busy}
            onClick={() => void beginAuth()}
          >
            <strong>Connect with GitHub</strong>
            <span>
              Sign in to keep the curated set with higher rate limits, or link
              a GitHub repo you own as your registry. You'll pick a repo after
              signing in — the curated bank is pre-listed as Recommended.
            </span>
            {!isAuthConfigured && (
              <em className="login-disabled-note">
                Not configured — see <code>auth-config.ts</code>.
              </em>
            )}
          </button>
        </div>

        <p className="setup-footnote">
          Want to fork this app and ship your own build?{" "}
          <button
            type="button"
            className="link-btn"
            disabled={busy}
            onClick={() => void openSelfHost()}
          >
            Self-host instructions →
          </button>
        </p>
      </div>
    </div>
  );
}

function prettyDeviceFlowError(raw: string): string {
  // Errors thrown from main are stringified `device-flow:<code>:<msg>`.
  const m = /^device-flow:([^:]+):(.*)$/.exec(raw);
  if (!m) return raw;
  const [, code, msg] = m;
  switch (code) {
    case "denied":
      return "You denied the authorization. Try again or pick another option.";
    case "expired":
      return "The code expired. Click Authenticate again to get a new one.";
    case "cancelled":
      return "Cancelled.";
    case "not-configured":
      return msg ?? "OAuth Client ID not configured.";
    case "transport":
      return `Network error: ${msg ?? "unknown"}`;
    default:
      return msg ?? code ?? "unknown error";
  }
}
