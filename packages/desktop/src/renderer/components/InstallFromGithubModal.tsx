import React, { useState } from "react";
import { rateLimitReached } from "../ghRateLimit.js";
import { useRegistryHost } from "../RegistryHostContext.js";
import { Modal, ModalCloseButton, modalHeader } from "./modalStyles.js";

interface Props {
  onClose: () => void;
  /**
   * Called after a successful install so the host can refresh the
   * registry list + close the surrounding Settings flow.
   */
  onInstalled: () => void;
}

/**
 * Phase 4 (v1.5): paste a GitHub URL, fetch the skill into the
 * bank in one click. Surfaces structured errors from the
 * `installSkillFromGithub` IPC keyed on `reason`, with hint copy
 * tailored to each failure mode (parse, collision, no-SKILL.md,
 * mirror, rate-limit).
 */
export function InstallFromGithubModal({
  onClose,
  onInstalled,
}: Props): React.ReactElement {
  const { flash, flashError } = useRegistryHost();

  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await window.skillsBank.installSkillFromGithub(url);
      if (r.ok) {
        flash(`Installed ${r.name} into your bank`);
        onInstalled();
        return;
      }
      switch (r.reason) {
        case "url-parse-error":
          setError(r.message);
          break;
        case "no-registry-root":
          setError(r.message);
          break;
        case "name-collision":
          setError(
            `A skill named "${r.name}" is already in your bank (${r.existingBucket}). Uninstall the existing one or rename it before installing this one.`,
          );
          break;
        case "no-skill-md":
          setError(r.message);
          break;
        case "mirror-failed":
          if (r.rateLimit) {
            flashError(
              `${rateLimitReached(r.rateLimit)}. Sign in via Account for 5000/hr.`,
            );
            setError("Rate-limited. Sign in for a higher ceiling.");
          } else {
            setError(`Couldn't fetch from GitHub: ${r.message}`);
          }
          break;
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      label="Install a skill from GitHub"
      onClose={onClose}
      width={540}
      bodyStyle={{ maxHeight: undefined, overflowY: undefined }}
    >
      <div style={modalHeader}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Install a skill from GitHub</h2>
        <ModalCloseButton onClose={onClose} />
      </div>
      <p style={hint}>
        Paste a GitHub URL pointing at a skill folder (or its SKILL.md file).
        The app fetches the folder, registers the skill in your bank, and stamps
        the origin so future Updates work.
      </p>
      <p style={{ ...hint, fontSize: 11, color: "var(--text-3)" }}>
        Examples:
        <br />
        <code>https://github.com/owner/repo/tree/main/skills/find-skills</code>
        <br />
        <code>
          https://github.com/owner/repo/blob/main/skills/find-skills/SKILL.md
        </code>
      </p>
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://github.com/owner/repo/tree/main/path"
        disabled={busy}
        style={input}
        onKeyDown={(e) => {
          if (e.key === "Enter" && url.trim().length > 0) {
            void submit();
          }
        }}
      />
      {error && (
        <p
          role="alert"
          style={{
            ...hint,
            marginTop: 8,
            color: "var(--danger)",
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </p>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 16,
        }}
      >
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="primary"
          onClick={() => void submit()}
          disabled={busy || url.trim().length === 0}
        >
          {busy ? (
            <>
              <span className="spinner inline" /> Installing
            </>
          ) : (
            "Install"
          )}
        </button>
      </div>
    </Modal>
  );
}

const hint: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-2)",
  margin: "8px 0",
};
const input: React.CSSProperties = {
  width: "100%",
  marginTop: 8,
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "var(--font-mono, monospace)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  background: "var(--surface-hi)",
  color: "var(--text)",
};
