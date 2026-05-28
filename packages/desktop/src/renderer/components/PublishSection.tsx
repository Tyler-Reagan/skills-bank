import React, { useState } from "react";
import type { PublishState, RegistryEntry } from "@skills-bank/core";
import type { PublishSkillResult } from "../../shared/ipc.js";
import { rateLimitReached } from "../ghRateLimit.js";
import { useIpcQuery } from "../hooks/useIpcQuery.js";
import { useRegistryHost } from "../RegistryHostContext.js";
import { Icon } from "./Icon.js";
import { Modal, ModalCloseButton } from "./modalStyles.js";

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
  const [busy, setBusy] = useState(false);
  const [forkConfirmOpen, setForkConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: flow } = useIpcQuery(
    () =>
      window.skillsBank
        .classifySkillForPublish(entry.name)
        .then((r) => (r.ok ? r.flow : null)),
    [entry.name],
  );
  const { data: publishState } = useIpcQuery(
    () => window.skillsBank.getPublishState(entry.name),
    [entry.name],
  );

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
          `${rateLimitReached(r.rateLimit)}. Try again at ${new Date(r.rateLimit.resetAt).toLocaleTimeString()}.`,
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
    <div className="publish-section">
      <div className="publish-heading-row">
        <h3 className="publish-section-heading">Linked repo</h3>
        <PublishChip state={publishState} />
      </div>
      <div
        className="publish-repo-line"
        title={`Connected to github.com/${linkedRepoName}`}
      >
        <Icon name="check" size="sm" />
        <span>{linkedRepoName}</span>
      </div>
      {flowLabel && targetPath && (
        <div className="publish-flow-block">
          <span
            className={`publish-flow-label${isFork ? " publish-flow-label--warn" : ""}`}
          >
            {isFork && <Icon name="alert-triangle" size="sm" />}
            {flowLabel}
          </span>
          <code
            className="publish-path-line"
            title={`${linkedRepoName}/${targetPath}/`}
          >
            {targetPath}/
          </code>
        </div>
      )}
      {flowExplain && <p className="publish-hint">{flowExplain}</p>}
      <div className="publish-action-row">
        <button
          className="btn primary publish-btn-full"
          type="button"
          disabled={busy || !flow || flow.flow === "not-publishable"}
          onClick={() => void onClickPublish()}
          title={
            isFork
              ? "Fork and open a pull request on the linked repo. Severs the origin pointer."
              : "Open a pull request on the linked repo with this skill"
          }
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
        <p role="alert" className="publish-hint publish-hint--danger mt-8">
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
    <Modal
      label={`Fork ${name}?`}
      onClose={onCancel}
      width={540}
      bodyClass="modal-body--no-scroll"
    >
      <div className="modal-header">
        <h2 className="mt-0 mb-0 text-13">
          Fork <code>{name}</code>?
        </h2>
        <ModalCloseButton onClose={onCancel} />
      </div>
      <p className="fork-confirm-hint">
        Publishing your edits to <code>{name}</code> forks it from{" "}
        <code>{originRepo}</code>. The local copy moves from{" "}
        <code>skills/vendored/</code> to <code>skills/personal/</code>, the
        origin pointer clears, and future updates from <code>{originRepo}</code>{" "}
        stop surfacing. This is irreversible without re-vendoring.
      </p>
      {willCollide && (
        <p className="fork-confirm-hint fork-confirm-hint--danger">
          ⚠️ A skill named <code>{name}</code> already exists in{" "}
          <code>skills/personal/</code>. The fork will refuse until you resolve
          the collision (revert your edits, rename the existing skill, or delete
          it).
        </p>
      )}
      <div className="row-end mt-16">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" onClick={onConfirm} disabled={willCollide}>
          Fork and publish
        </button>
      </div>
    </Modal>
  );
}
