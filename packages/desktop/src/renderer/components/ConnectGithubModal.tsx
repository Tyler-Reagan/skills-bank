import React, { useEffect, useState } from "react";
import type {
  AuthStatus,
  DeviceFlowResumePayload,
  DeviceFlowStartPayload,
} from "../../shared/ipc.js";
import { Icon } from "./Icon.js";
import { Modal } from "./modalStyles.js";

interface Props {
  isAuthConfigured: boolean;
  onConnected: (status: AuthStatus) => void;
  onClose: () => void;
}

/**
 * Mid-app entry point to GitHub Device Flow. Mirrors the LoginScreen
 * flow-active card but lives as a regular modal so an unlinked user
 * can connect from AccountModal without resetting userData. On mount,
 * probes for a persisted in-flight flow (Plan 02 recovery surface) and
 * offers Resume / Start over if one exists; otherwise starts a fresh
 * flow.
 */
export function ConnectGithubModal({
  isAuthConfigured,
  onConnected,
  onClose,
}: Props): React.ReactElement {
  const [resumable, setResumable] = useState<DeviceFlowResumePayload | null>(
    null,
  );
  const [flow, setFlow] = useState<DeviceFlowStartPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [busy, setBusy] = useState(false);

  // On mount: probe for a persisted flow first. If none, auto-start fresh.
  // Only fires when auth is configured — otherwise we render the
  // not-configured state immediately.
  useEffect(() => {
    if (!isAuthConfigured) return;
    let cancelled = false;
    void (async () => {
      try {
        const persisted = await window.skillsBank.authResumeDeviceFlow();
        if (cancelled) return;
        if (persisted) {
          setResumable(persisted);
          return;
        }
        await beginFresh();
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // beginFresh is stable across renders; intentionally omitted from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthConfigured]);

  const beginFresh = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const f = await window.skillsBank.authStartDeviceFlow();
      setFlow(f);
      setPolling(true);
      try {
        const status = await window.skillsBank.authPollDeviceFlow(f.flowId);
        onConnected(status);
      } catch (err) {
        setError(prettyDeviceFlowError((err as Error).message));
      } finally {
        setPolling(false);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resumeFlow = async () => {
    if (!resumable) return;
    setError(null);
    setBusy(true);
    setPolling(true);
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
      onConnected(status);
    } catch (err) {
      setError(prettyDeviceFlowError((err as Error).message));
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
    await beginFresh();
  };

  const cancel = async () => {
    if (flow) await window.skillsBank.authCancelDeviceFlow(flow.flowId);
    if (resumable)
      await window.skillsBank.authCancelDeviceFlow(resumable.flowId);
    onClose();
  };

  if (!isAuthConfigured) {
    return (
      <Modal
        label="Connect to GitHub"
        onClose={() => void cancel()}
        width={520}
      >
        <h2 className="connect-github-title">Connect to GitHub</h2>
        <p className="connect-github-hint">
          GitHub OAuth isn't configured for this build. See{" "}
          <code>packages/desktop/src/main/auth-config.ts</code>.
        </p>
        <div className="connect-github-footer">
          <button className="btn" type="button" onClick={() => void cancel()}>
            Close
          </button>
        </div>
      </Modal>
    );
  }

  if (resumable && !flow) {
    const minutesLeft = Math.max(
      0,
      Math.floor((resumable.expiresAt - Date.now()) / 60000),
    );
    return (
      <Modal
        label="Resume GitHub authentication"
        onClose={() => void cancel()}
        width={520}
      >
        <h2 className="connect-github-title">Resume GitHub authentication?</h2>
        <p className="connect-github-hint">
          An in-progress authentication is still valid (about {minutesLeft}{" "}
          minute{minutesLeft === 1 ? "" : "s"} remaining). If you completed the
          GitHub side, Resume will pick up the token. Otherwise pick Start over.
        </p>
        <div className="device-code-box">
          <code className="device-code">{resumable.userCode}</code>
        </div>
        <div className="connect-github-footer">
          <button
            className="btn primary"
            type="button"
            disabled={busy}
            onClick={() => void resumeFlow()}
          >
            <Icon name="check" size="sm" /> Resume
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() => void startOver()}
          >
            Start over
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() => void cancel()}
          >
            Cancel
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal label="Connect to GitHub" onClose={() => void cancel()} width={520}>
      <h2 className="connect-github-title">Connect to GitHub</h2>
      <p className="connect-github-hint">
        Authenticate, then pick a repo to back your registry with. Your current
        registry isn't touched until you choose a repo on the next screen.
      </p>
      {!flow && !error && busy && (
        <p className="connect-github-hint">
          <span className="spinner inline" /> Starting Device Flow
        </p>
      )}
      {flow && (
        <>
          <p className="connect-github-hint">
            Open the link below and enter this code:
          </p>
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
            className="btn primary mt-8"
            onClick={() =>
              void window.skillsBank.openExternal(flow.verificationUri)
            }
          >
            <Icon name="external-link" size="sm" /> Open {flow.verificationUri}
          </button>
          {polling && (
            <p className="connect-github-hint" role="status" aria-live="polite">
              <span className="spinner inline" /> Waiting for you to authorize
              the app
            </p>
          )}
        </>
      )}
      {error && (
        <p
          className="connect-github-hint connect-github-hint--danger"
          role="alert"
        >
          <Icon name="alert-triangle" size="sm" /> {error}
        </p>
      )}
      <div className="connect-github-footer">
        <button className="btn" type="button" onClick={() => void cancel()}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function prettyDeviceFlowError(raw: string): string {
  const m = /^device-flow:([^:]+):(.*)$/.exec(raw);
  if (!m) return raw;
  const [, code, msg] = m;
  switch (code) {
    case "denied":
      return "You denied the authorization. Try again or cancel.";
    case "expired":
      return "The code expired. Cancel and try again.";
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
