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
export function DeleteUnregisteredConfirm({
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
      bodyStyle={{ maxHeight: undefined, overflowY: undefined }}
    >
      <h2 style={{ marginTop: 0 }}>
        <Icon name="alert-triangle" size="sm" /> Delete <code>{name}</code> from
        this machine?
      </h2>
      <p style={{ color: "var(--text-2)", fontSize: 13, marginTop: 4 }}>
        This permanently deletes the files listed below. This cannot be undone.
        The skill must already be unregistered.
      </p>

      {realDirs.length > 0 && (
        <section style={{ marginTop: 12 }}>
          <h3 style={sectionTitle}>Will delete</h3>
          <ul style={list}>
            {realDirs.map((i) => (
              <li key={i.linkPath}>
                <strong>{AGENT_LABELS[i.agent]}</strong>{" "}
                <code>{i.linkPath}</code> <span style={badge}>folder</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {symlinks.length > 0 && (
        <section style={{ marginTop: 12 }}>
          <h3 style={sectionTitle}>Will unlink (target preserved)</h3>
          <ul style={list}>
            {symlinks.map((i) => (
              <li key={i.linkPath}>
                <strong>{AGENT_LABELS[i.agent]}</strong>{" "}
                <code>{i.linkPath}</code>
                {i.target && (
                  <>
                    {" "}
                    <span style={{ color: "var(--text-3)" }}>→ {i.target}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
          <p style={hint}>
            Symlink targets are user-owned (often your own git repos) and are{" "}
            <strong>not</strong> deleted.
          </p>
        </section>
      )}

      {realDirs.length === 0 && symlinks.length === 0 && (
        <p style={{ color: "var(--text-3)", fontStyle: "italic" }}>
          Nothing to delete — {name} has no on-disk presence in any agent
          directory.
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

const sectionTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--text-2)",
  margin: "0 0 6px 0",
};
const list: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  fontSize: 12,
  fontFamily: "var(--font-mono)",
};
const hint: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-3)",
  marginTop: 6,
};
const badge: React.CSSProperties = {
  display: "inline-block",
  padding: "1px 6px",
  fontSize: 10,
  fontWeight: 600,
  background: "var(--danger-dim, rgba(208, 68, 68, 0.18))",
  color: "var(--danger, #d04444)",
  borderRadius: 3,
  marginLeft: 4,
};
