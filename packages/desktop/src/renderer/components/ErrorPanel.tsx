import React, { useState } from "react";
import type { AppError } from "@skills-bank/core";
import { Icon } from "./Icon.js";

/**
 * Persistent error surface. Replaces the toast-only error flow with a
 * dismissable panel that supports copyable details, an expandable
 * `Show details` view, and an optional `suggestedAction` button.
 *
 * The toast surface stays for success-confirmation; failures route
 * here.
 */
interface Props {
  error: AppError;
  /** Click handler for the `suggestedAction.kind`. Caller decides. */
  onSuggestedAction?: (kind: string) => void | Promise<void>;
  onDismiss: () => void;
}

export function ErrorPanel({
  error,
  onSuggestedAction,
  onDismiss,
}: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasDetails =
    !!error.copyableDetails && Object.keys(error.copyableDetails).length > 0;

  const onCopy = async () => {
    const md = formatMarkdown(error);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — copy is best-effort
    }
  };

  return (
    <div
      className="error-panel"
      role="alert"
      aria-live="polite"
    >
      <div className="error-panel-row">
        <span className="error-panel-icon" aria-hidden="true">
          <Icon name="alert-triangle" size="sm" />
        </span>
        <span className="error-panel-message">{error.message}</span>
        <button
          type="button"
          className="error-panel-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss"
        >
          <Icon name="x" size="sm" />
        </button>
      </div>

      <div className="error-panel-actions">
        {error.suggestedAction && onSuggestedAction && (
          <button
            type="button"
            className="btn primary"
            onClick={() =>
              void onSuggestedAction(error.suggestedAction!.kind)
            }
          >
            {error.suggestedAction.label}
          </button>
        )}
        <button
          type="button"
          className="btn"
          onClick={() => void onCopy()}
          aria-live="polite"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {hasDetails && (
          <button
            type="button"
            className="link-btn"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "Hide details" : "Show details"}
          </button>
        )}
      </div>

      {open && hasDetails && (
        <dl className="error-panel-details">
          <div className="error-panel-detail-row">
            <dt>code</dt>
            <dd><code>{error.code}</code></dd>
          </div>
          {Object.entries(error.copyableDetails ?? {}).map(([k, v]) => (
            <div key={k} className="error-panel-detail-row">
              <dt>{k}</dt>
              <dd>
                <code>
                  {Array.isArray(v) ? v.join(", ") : v}
                </code>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * Format an AppError as a Markdown block suitable for chat/issue
 * paste. Used by the Copy affordance.
 */
function formatMarkdown(error: AppError): string {
  const lines: string[] = [`**${error.code}**`, "", error.message];
  if (error.copyableDetails) {
    const entries = Object.entries(error.copyableDetails);
    if (entries.length > 0) {
      lines.push("");
      for (const [k, v] of entries) {
        const value = Array.isArray(v) ? v.join(", ") : v;
        lines.push(`- ${k}: ${value}`);
      }
    }
  }
  return lines.join("\n");
}
