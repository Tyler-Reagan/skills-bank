import React, { useState } from "react";
import type { AgentId, InstalledSkill } from "@skills-bank/core";
import { useFocusReturn } from "../hooks/useFocusReturn.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { Icon } from "./Icon.js";

const AGENT_LABELS: Record<AgentId, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  gemini: "Gemini",
  copilot: "GitHub Copilot",
  continue: "Continue",
  cline: "Cline",
  codex: "OpenAI Codex",
  agents: "Agents (shared)",
};

interface Props {
  name: string;
  installations: InstalledSkill[];
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}

/**
 * M9b: confirmation modal for the inline Delete on Unregistered
 * cards. Previews exactly what will happen — real-directory copies
 * deleted, symlinks unlinked, external targets explicitly preserved.
 *
 * The taxonomy plan deliberately chose the conservative semantic
 * (leave external targets alone) and required this preview so the
 * user understands what "Delete" does for foreign-symlink skills.
 */
export function DeleteUnregisteredConfirm({
  name,
  installations,
  onCancel,
  onConfirm,
}: Props): React.ReactElement {
  useFocusReturn();
  useEscapeToClose(onCancel);
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
    <div style={overlay}>
      <div style={modal} role="dialog" aria-modal="true">
        <h2 style={{ marginTop: 0 }}>
          <Icon name="alert-triangle" size="sm" /> Delete {name}?
        </h2>
        <p style={{ color: "var(--text-2)", fontSize: 13, marginTop: 4 }}>
          This removes {name}'s presence from your agent directories. The
          skill must already be unregistered.
        </p>

        {realDirs.length > 0 && (
          <section style={{ marginTop: 12 }}>
            <h3 style={sectionTitle}>Will delete</h3>
            <ul style={list}>
              {realDirs.map((i) => (
                <li key={i.linkPath}>
                  <strong>{AGENT_LABELS[i.agent]}</strong>{" "}
                  <code>{i.linkPath}</code>{" "}
                  <span style={badge}>folder</span>
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
                      <span style={{ color: "var(--text-3)" }}>
                        → {i.target}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <p style={hint}>
              Symlink targets are user-owned (often your own git repos)
                and are <strong>not</strong> deleted.
            </p>
          </section>
        )}

        {realDirs.length === 0 && symlinks.length === 0 && (
          <p style={{ color: "var(--text-3)", fontStyle: "italic" }}>
            Nothing to delete — {name} has no on-disk presence in any
            agent directory.
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
          <button
            className="btn"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className="btn danger"
            onClick={() => void confirm()}
            disabled={submitting || installations.length === 0}
          >
            {submitting ? (
              <>
                <span className="spinner inline" /> Deleting…
              </>
            ) : (
              "Delete"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

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
  width: 560,
  maxWidth: "90vw",
};
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
