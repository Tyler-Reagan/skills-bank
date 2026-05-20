import React, { useEffect, useState } from "react";
import type {
  PublishState,
  RegistryEntry,
  SkillPublishFlow,
} from "@skills-bank/core";
import type { PublishSkillResult } from "../../shared/ipc.js";
import { useRegistryHost } from "../RegistryHostContext.js";
import { Icon } from "./Icon.js";

interface Props {
  entry: RegistryEntry;
  /** Linked-repo full name (`owner/name`) or null. Drives visibility. */
  linkedRepoName: string | null;
  /** Called after a successful publish so the host can refresh. */
  onPublished: () => void;
}

/**
 * Phase 5 (v1.5) M3 — Publish UI for the drawer. Self-contained:
 * fetches publish-state on mount, renders the Publish button + chip,
 * routes through a Fork confirmation modal for Flow 3, otherwise
 * publishes immediately with classifier defaults.
 *
 * MVP scope: PR-meta-edit modal + collision-resolve modal are
 * follow-ups (M4 polish). Inline error renderings cover those
 * cases meanwhile.
 */
export function PublishSection({
  entry,
  linkedRepoName,
  onPublished,
}: Props): React.ReactElement | null {
  const { flash, flashError } = useRegistryHost();
  const [publishState, setPublishState] = useState<PublishState | null>(null);
  const [flow, setFlow] = useState<SkillPublishFlow | null>(null);
  const [busy, setBusy] = useState(false);
  const [forkConfirmOpen, setForkConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.skillsBank.classifySkillForPublish(entry.name).then((r) => {
      if (cancelled) return;
      if (r.ok) setFlow(r.flow);
    });
    void window.skillsBank.getPublishState(entry.name).then((s) => {
      if (cancelled) return;
      setPublishState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [entry.name]);

  if (!linkedRepoName) return null;

  const fireFinalPublish = async (confirmFork: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r: PublishSkillResult = await window.skillsBank.publishSkill(
        entry.name,
        { confirmFork },
      );
      if (r.ok) {
        flash(
          r.updated
            ? `Updated PR #${r.prNumber}`
            : `Opened PR #${r.prNumber}`,
        );
        onPublished();
        return;
      }
      handlePublishError(r);
    } finally {
      setBusy(false);
    }
  };

  const handlePublishError = (r: PublishSkillResult) => {
    if (r.ok) return;
    switch (r.reason) {
      case "fork-confirmation-required":
        setForkConfirmOpen(true);
        break;
      case "fork-collision":
        setError(
          `A skill named "${entry.name}" already exists in skills/personal/. Resolve the conflict (revert your edits, rename the existing skill, or delete it) before forking.`,
        );
        break;
      case "rate-limit":
        flashError(
          `GitHub rate limit reached (${r.rateLimit.limit}/hr). Try again at ${new Date(r.rateLimit.resetAt).toLocaleTimeString()}.`,
        );
        setError("Rate-limited. Retry after the reset window.");
        break;
      case "push-failed":
        if (r.branchUrl) {
          setError(
            `Branch was created on the remote (step 5 succeeded) but PR creation failed. Open the PR manually: ${r.branchUrl}`,
          );
        } else {
          setError(`Publish failed at step ${r.step}: ${r.message}`);
        }
        break;
      default:
        setError(r.message);
    }
  };

  const onClickPublish = async () => {
    if (!flow) return;
    if (flow.flow === "not-publishable") {
      setError(
        flow.reason === "no-linked-repo"
          ? "No linked repository. Sign in via Account."
          : "This skill is missing meta.json description. Add one before publishing.",
      );
      return;
    }
    if (flow.flow === "fork") {
      setForkConfirmOpen(true);
      return;
    }
    await fireFinalPublish(false);
  };

  return (
    <div style={section}>
      <h3 style={sectionHeading}>Linked repo</h3>
      <p style={hint}>
        Push this skill to <code>{linkedRepoName}</code> as a pull
        request. {flow?.flow === "safekeeping"
          ? "Safekeeping: the vendored copy gets deposited at vendored/ on the linked repo."
          : flow?.flow === "fork"
            ? "Forking: your edits sever this skill from its origin and convert it to a user-owned skill in personal/."
            : "New skill: lands at personal/ on the linked repo."}
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <button
          className="btn primary"
          type="button"
          disabled={busy || !flow || flow.flow === "not-publishable"}
          onClick={() => void onClickPublish()}
          title="Open a pull request on the linked repo with this skill"
        >
          {busy ? (
            <>
              <span className="spinner inline" /> Publishing
            </>
          ) : (
            "Publish"
          )}
        </button>
        <PublishChip state={publishState} />
        {flow?.flow === "fork" && (
          <span style={forkBadge} title="Publishing this skill forks it from its origin">
            <Icon name="alert-triangle" size="sm" /> Fork
          </span>
        )}
      </div>
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
      {forkConfirmOpen && flow?.flow === "fork" && (
        <ForkConfirmModal
          name={entry.name}
          originRepo={entry.source.origin?.repo ?? "the origin"}
          willCollide={flow.willCollide}
          onCancel={() => setForkConfirmOpen(false)}
          onConfirm={async () => {
            setForkConfirmOpen(false);
            await fireFinalPublish(true);
          }}
        />
      )}
    </div>
  );
}

function PublishChip({
  state,
}: {
  state: PublishState | null;
}): React.ReactElement | null {
  if (!state) return null;
  const labels: Record<PublishState, { label: string; cls: string }> = {
    pushed: { label: "Pushed", cls: "pushed" },
    draft: { label: "Draft", cls: "draft" },
    untracked: { label: "Untracked", cls: "untracked" },
    unknown: { label: "Unknown", cls: "unknown" },
  };
  const { label, cls } = labels[state];
  return (
    <span className={`publish-chip ${cls}`} title={`Publish state: ${label}`}>
      {label}
    </span>
  );
}

interface ForkConfirmModalProps {
  name: string;
  originRepo: string;
  willCollide: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function ForkConfirmModal({
  name,
  originRepo,
  willCollide,
  onCancel,
  onConfirm,
}: ForkConfirmModalProps): React.ReactElement {
  return (
    <div style={overlay}>
      <div style={modal} role="dialog" aria-modal="true" aria-label="Confirm fork">
        <div style={modalHeader}>
          <h2 style={{ margin: 0, fontSize: 16 }}>
            Fork <code>{name}</code>?
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            title="Close"
            style={closeBtn}
          >
            <Icon name="x" size="md" />
          </button>
        </div>
        <p style={hint}>
          Publishing your edits to <code>{name}</code> forks it from{" "}
          <code>{originRepo}</code>. The local copy moves from{" "}
          <code>skills/vendored/</code> to <code>skills/personal/</code>, the
          origin pointer clears, and future updates from{" "}
          <code>{originRepo}</code> stop surfacing. This is irreversible
          without re-vendoring.
        </p>
        {willCollide && (
          <p style={{ ...hint, color: "var(--danger)" }}>
            ⚠️ A skill named <code>{name}</code> already exists in{" "}
            <code>skills/personal/</code>. The fork will refuse until you
            resolve the collision (revert your edits, rename the existing
            skill, or delete it).
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
          <button onClick={onCancel}>Cancel</button>
          <button
            className="primary"
            onClick={onConfirm}
            disabled={willCollide}
          >
            Fork and publish
          </button>
        </div>
      </div>
    </div>
  );
}

const section: React.CSSProperties = {
  marginTop: 16,
  paddingTop: 12,
  borderTop: "1px solid var(--border)",
};
const sectionHeading: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--text-3)",
  margin: "0 0 6px 0",
};
const hint: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-2)",
  margin: "4px 0",
};
const forkBadge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 6px",
  borderRadius: 4,
  background: "var(--surface-hi)",
  color: "var(--warning, var(--text-2))",
  border: "1px solid var(--border)",
  fontSize: 11,
};
const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--scrim)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1100,
};
const modal: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border-hi)",
  borderRadius: 8,
  padding: 24,
  width: 540,
  maxWidth: "90vw",
};
const modalHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};
const closeBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "var(--text-3)",
  padding: 4,
  borderRadius: 4,
  display: "inline-flex",
};
