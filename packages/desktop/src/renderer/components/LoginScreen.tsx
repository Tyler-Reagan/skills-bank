import React, { useState } from "react";
import type { AuthStatus, DeviceFlowStartPayload } from "../../shared/ipc.js";
import { Icon } from "./Icon.js";

interface Props {
  isAuthConfigured: boolean;
  onStatusChanged: (status: AuthStatus) => void;
}

/**
 * First-launch persona decision. Three paths:
 *   1. Authenticate with GitHub (Device Flow) → power persona
 *   2. Continue without → convenience persona
 *   3. Self-host → opens fork-and-build docs in browser; user is expected
 *      to fork and run their own build, so we don't change persona here.
 */
export function LoginScreen({
  isAuthConfigured,
  onStatusChanged,
}: Props): React.ReactElement {
  const [flow, setFlow] = useState<DeviceFlowStartPayload | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [busy, setBusy] = useState(false);

  const skip = async () => {
    setBusy(true);
    try {
      const status = await window.skillsBank.authSetPersonaConvenience();
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

  const openSelfHost = async () => {
    const r = await window.skillsBank.openSelfHostDocs();
    if (!r.ok) {
      setPollError(r.message ?? "could not open self-host docs");
    }
  };

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
              the app…
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
        <h1>How do you want to use skills-bank?</h1>
        <p>Pick a path below. You can change your mind later in Settings.</p>

        <div className="login-options">
          <button
            type="button"
            className="login-option"
            disabled={!isAuthConfigured || busy}
            onClick={() => void beginAuth()}
          >
            <strong>Authenticate with GitHub</strong>
            <span>
              Power user. Replace the registry with one of your own GitHub
              repos. You maintain it yourself; auto-sync is off.
            </span>
            {!isAuthConfigured && (
              <em className="login-disabled-note">
                Not configured — see <code>auth-config.ts</code>.
              </em>
            )}
          </button>

          <button
            type="button"
            className="login-option"
            disabled={busy}
            onClick={() => void skip()}
          >
            <strong>Continue without</strong>
            <span>
              Convenience user. Use this repo's curated registry, sync updates
              with one click, and add your own skills alongside.
            </span>
          </button>

          <button
            type="button"
            className="login-option"
            disabled={busy}
            onClick={() => void openSelfHost()}
          >
            <strong>Self-host</strong>
            <span>
              Fork the app + registry and ship your own build. Opens
              instructions in your browser.
            </span>
          </button>
        </div>
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
