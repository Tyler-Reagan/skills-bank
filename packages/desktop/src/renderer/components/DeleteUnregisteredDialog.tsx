import React, { useState } from "react";
import type { InstalledSkill } from "@skills-bank/core";
import { AGENT_LABELS } from "../agentDisplay.js";
import { Icon } from "./Icon.js";
import { Modal } from "./modalStyles.js";

interface Props {
  name: string;
  installations: InstalledSkill[];
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}

/**
 * Confirmation modal for "Delete from this machine" on Unregistered
 * cards — the file-destroying bottom rung. Previews exactly what
 * will happen: real-directory copies deleted, symlinks unlinked,
 * external targets explicitly preserved.
 *
 * The conservative semantic (leave external targets alone) is
 * deliberate — symlink targets are user-owned and often belong to
 * other git repos. This modal makes that contract visible.
 */
export function DeleteUnregisteredDialog({
  name,
  installations,
  onCancel,
  onConfirm,
}: Props): React.ReactElement {
  const [submitting, setSubmitting] = useState(false);

  const realDirs = installations.filter((i) => i.kind === "real-directory");
  const symlinks = installations.filter((i) => i.kind !== "real-directory");

  const confirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      label={`Delete ${name} from this machine?`}
      onClose={onCancel}
      width={560}
      bodyClass="modal-body--no-scroll"
    >
      <h2 className="mt-0">
        <Icon name="alert-triangle" size="sm" /> Delete <code>{name}</code> from
        this machine?
      </h2>
      <p className="text-muted text-13 mt-4">
        This permanently deletes the files listed below. This cannot be undone.
        The skill must already be unregistered.
      </p>

      {realDirs.length > 0 && (
        <section className="del-unreg-section">
          <h3 className="del-unreg-section-title">Will delete</h3>
          <ul className="del-unreg-list">
            {realDirs.map((i) => (
              <li key={i.linkPath}>
                <strong>{AGENT_LABELS[i.agent]}</strong>{" "}
                <code>{i.linkPath}</code>{" "}
                <span className="del-unreg-badge">folder</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {symlinks.length > 0 && (
        <section className="del-unreg-section">
          <h3 className="del-unreg-section-title">
            Will unlink (target preserved)
          </h3>
          <ul className="del-unreg-list">
            {symlinks.map((i) => (
              <li key={i.linkPath}>
                <strong>{AGENT_LABELS[i.agent]}</strong>{" "}
                <code>{i.linkPath}</code>
                {i.target && (
                  <>
                    {" "}
                    <span className="del-unreg-target">→ {i.target}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className="del-unreg-hint">
            Symlink targets are user-owned (often your own git repos) and are{" "}
            <strong>not</strong> deleted.
          </p>
        </section>
      )}

      {realDirs.length === 0 && symlinks.length === 0 && (
        <p className="del-unreg-empty">
          Nothing to delete — {name} has no on-disk presence in any agent
          directory.
        </p>
      )}

      <div className="row-end mt-16">
        <button className="btn" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button
          className="btn danger"
          onClick={() => void confirm()}
          disabled={submitting || installations.length === 0}
        >
          {submitting ? (
            <>
              <span className="spinner inline" /> Deleting
            </>
          ) : installations.length === 0 ? (
            "Nothing to delete"
          ) : (
            `Delete ${realDirs.length + symlinks.length} item${
              realDirs.length + symlinks.length === 1 ? "" : "s"
            }`
          )}
        </button>
      </div>
    </Modal>
  );
}
