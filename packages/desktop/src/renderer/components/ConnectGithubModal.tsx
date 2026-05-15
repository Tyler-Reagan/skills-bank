import React, { useEffect, useRef, useState } from "react";
import type {
  AuthStatus,
  DeviceFlowResumePayload,
  DeviceFlowStartPayload,
} from "../../shared/ipc.js";
import { useFocusReturn, useInitialFocus } from "../hooks/useFocusReturn.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { Icon } from "./Icon.js";
import { modal as modalStyle, overlay } from "./modalStyles.js";

interface Props {
  isAuthConfigured: boolean;
  onConnected: (status: AuthStatus) => void;
  onClose: () => void;
}

/**
 * Mid-app entry point to GitHub Device Flow. Mirrors the LoginScreen
 * flow-active card but lives as a regular modal so a local-bundled
 * user can opt into github-linked from AccountModal without resetting
 * userData. On mount, probes for a persisted in-flight flow (Plan 02
 * recovery surface) and offers Resume / Start over if one exists;
 * otherwise starts a fresh flow.
 */
export function ConnectGithubModal({
  isAuthConfigured,
  onConnected,
  onClose,
}: Props): React.ReactElement {
  useFocusReturn();
  const modalRef = useRef<HTMLDivElement | null>(null);
  useInitialFocus(modalRef);

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

  useEscapeToClose(() => void cancel());

  if (!isAuthConfigured) {
    return (
      <div style={overlay}>
        <div
          ref={modalRef}
          style={modalStyle(520)}
          role="dialog"
          aria-modal="true"
          aria-label="Connect to GitHub"
          tabIndex={-1}
        >
          <h2 style={titleStyle}>Connect to GitHub</h2>
          <p style={hint}>
            GitHub OAuth isn't configured for this build. See{" "}
            <code>packages/desktop/src/main/auth-config.ts</code>.
          </p>
          <div style={btnRow}>
            <button className="btn" type="button" onClick={() => void cancel()}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (resumable && !flow) {
    const minutesLeft = Math.max(
      0,
      Math.floor((resumable.expiresAt - Date.now()) / 60000),
    );
    return (
      <div style={overlay}>
        <div
          ref={modalRef}
          style={modalStyle(520)}
          role="dialog"
          aria-modal="true"
          aria-label="Resume GitHub authentication"
          tabIndex={-1}
        >
          <h2 style={titleStyle}>Resume GitHub authentication?</h2>
          <p style={hint}>
            An in-progress authentication is still valid (about {minutesLeft}{" "}
            minute{minutesLeft === 1 ? "" : "s"} remaining). If you completed
            the GitHub side, Resume will pick up the token. Otherwise pick Start
            over.
          </p>
          <div className="device-code-box">
            <code className="device-code">{resumable.userCode}</code>
          </div>
          <div style={btnRow}>
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
        </div>
      </div>
    );
  }

  return (
    <div style={overlay}>
      <div
        ref={modalRef}
        style={modalStyle(520)}
        role="dialog"
        aria-modal="true"
        aria-label="Connect to GitHub"
        tabIndex={-1}
      >
        <h2 style={titleStyle}>Connect to GitHub</h2>
        <p style={hint}>
          Authenticate, then pick a repo to back your registry with. Your
          current local-bundled set isn't touched until you choose a repo on the
          next screen.
        </p>
        {!flow && !error && busy && (
          <p style={hint}>
            <span className="spinner inline" /> Starting Device Flow
          </p>
        )}
        {flow && (
          <>
            <p style={hint}>Open the link below and enter this code:</p>
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
              className="btn primary"
              style={{ marginTop: 8 }}
              onClick={() =>
                void window.skillsBank.openExternal(flow.verificationUri)
              }
            >
              <Icon name="external-link" size="sm" /> Open{" "}
              {flow.verificationUri}
            </button>
            {polling && (
              <p style={hint} role="status" aria-live="polite">
                <span className="spinner inline" /> Waiting for you to authorize
                the app
              </p>
            )}
          </>
        )}
        {error && (
          <p style={{ ...hint, color: "var(--danger)" }} role="alert">
            <Icon name="alert-triangle" size="sm" /> {error}
          </p>
        )}
        <div style={btnRow}>
          <button className="btn" type="button" onClick={() => void cancel()}>
            Cancel
          </button>
        </div>
      </div>
    </div>
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

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 600,
};

const hint: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-2)",
  margin: "8px 0",
  lineHeight: 1.5,
};

const btnRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 16,
  paddingTop: 12,
  borderTop: "1px solid var(--border)",
};
