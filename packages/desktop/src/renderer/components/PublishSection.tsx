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
          r.updated ? `Updated PR #${r.prNumber}` : `Opened PR #${r.prNumber}`,
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

  const flowKind = flow?.flow;
  const targetPath = flow && "targetPath" in flow ? flow.targetPath : null;
  const flowLabel =
    flowKind === "safekeeping"
      ? "Safekeeping"
      : flowKind === "fork"
        ? "Fork"
        : flowKind === "new"
          ? "New skill"
          : null;
  // Tighter copy for the narrow rail. Full prose lives in tooltips
  // (title=) where the user can dwell to read more, keeping the
  // visible surface scannable.
  const flowExplain =
    flowKind === "safekeeping"
      ? "Deposits the vendored copy so it survives if the origin disappears."
      : flowKind === "fork"
        ? "Severs the origin link and moves the skill to personal/."
        : flowKind === "new"
          ? "Lands this skill on the linked repo as a new entry."
          : null;
  const isFork = flowKind === "fork";

  return (
    <div style={section}>
      <div style={headingRow}>
        <h3 style={sectionHeading}>Linked repo</h3>
        <PublishChip state={publishState} />
      </div>
      <div style={repoLine} title={`Connected to github.com/${linkedRepoName}`}>
        <Icon name="check" size="sm" />
        <span>{linkedRepoName}</span>
      </div>
      {flowLabel && targetPath && (
        <div style={flowBlock}>
          <span style={isFork ? flowLabelTextWarn : flowLabelText}>
            {isFork && <Icon name="alert-triangle" size="sm" />}
            {flowLabel}
          </span>
          <code style={pathLine} title={`${linkedRepoName}/${targetPath}/`}>
            {targetPath}/
          </code>
        </div>
      )}
      {flowExplain && <p style={hint}>{flowExplain}</p>}
      <div style={actionRow}>
        <button
          className="btn primary"
          type="button"
          disabled={busy || !flow || flow.flow === "not-publishable"}
          onClick={() => void onClickPublish()}
          title={
            isFork
              ? "Fork and open a pull request on the linked repo. Severs the origin pointer."
              : "Open a pull request on the linked repo with this skill"
          }
          style={{ width: "100%" }}
        >
          {busy ? (
            <>
              <span className="spinner inline" /> Publishing
            </>
          ) : (
            "Publish"
          )}
        </button>
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
  // `unknown` means the publish-state probe couldn't reach a verdict
  // (token expired, GitHub tree truncated, transient network error,
  // etc.) — that's a system limitation, not a state worth labeling.
  // Showing "Unknown" reads as "this skill is in an unknown state"
  // which is misleading. Surface a small status hint via title=
  // instead, no chip body.
  if (state === "unknown") {
    return (
      <span
        className="publish-chip unknown"
        title="Couldn't reach a verdict on publish state — token expired, tree probe truncated, or transient network error. Try Rescan."
        aria-label="Publish state unknown"
      >
        ?
      </span>
    );
  }
  const labels: Record<
    Exclude<PublishState, "unknown">,
    { label: string; cls: string }
  > = {
    pushed: { label: "Pushed", cls: "pushed" },
    draft: { label: "Draft", cls: "draft" },
    untracked: { label: "Untracked", cls: "untracked" },
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
    <div style={overlay} onClick={onCancel} role="presentation">
      <div
        style={modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Confirm fork"
      >
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
          <code>{originRepo}</code> stop surfacing. This is irreversible without
          re-vendoring.
        </p>
        {willCollide && (
          <p style={{ ...hint, color: "var(--danger)" }}>
            ⚠️ A skill named <code>{name}</code> already exists in{" "}
            <code>skills/personal/</code>. The fork will refuse until you
            resolve the collision (revert your edits, rename the existing skill,
            or delete it).
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
  // No top border. The rail's surface + the section's own spacing
  // are enough separation; the divider was creating visual noise in
  // a column that already segments via empty space.
  marginTop: 12,
};
const sectionHeading: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-3)",
  margin: 0,
};
const headingRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  margin: "0 0 var(--s2, 8px) 0",
};
const repoLine: React.CSSProperties = {
  // Explicit "you're linked to X" acknowledgement. The check icon
  // confirms the connection visually; the repo name reads as the
  // destination. Sits just under the section heading so the eye
  // anchors on context before scanning the action affordances.
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 12,
  fontFamily: "var(--font-mono)",
  color: "var(--text-2)",
  margin: "0 0 var(--s3, 12px) 0",
  overflowWrap: "anywhere",
};
const flowBlock: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  margin: "0 0 var(--s2, 8px) 0",
};
const flowLabelText: React.CSSProperties = {
  // Editorial label: small, weighted, no chrome box. Pairs visually
  // with the section heading rather than competing with the
  // PublishChip.
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--text-2)",
};
const flowLabelTextWarn: React.CSSProperties = {
  ...({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  } as React.CSSProperties),
  // Fork is irreversible — surface the cost in the label color
  // rather than as a duplicate badge next to the button.
  color: "var(--warn, var(--text-2))",
};
const pathLine: React.CSSProperties = {
  // Inside-repo path only; the linked-repo owner/name is already in
  // the dialog/header context. Full path lives in the title tooltip
  // for users who want it.
  color: "var(--text-2)",
  fontSize: 11,
  overflowWrap: "anywhere",
  lineHeight: 1.5,
};
const actionRow: React.CSSProperties = {
  marginTop: 12,
};
const hint: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-3)",
  lineHeight: 1.5,
  margin: "0 0 var(--s2, 8px) 0",
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
