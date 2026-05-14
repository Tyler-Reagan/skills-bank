import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AgentId } from "@skills-bank/core";
import { useFocusReturn, useInitialFocus } from "../hooks/useFocusReturn.js";
import { Icon } from "./Icon.js";

// Inlined to keep this file type-only against @skills-bank/core. Pulling
// AGENTS as a value drags in node:fs/node:child_process through the core
// barrel and breaks the Vite renderer build. Matches the inline pattern
// used by DeleteUnregisteredConfirm.tsx.
const AGENT_OPTIONS: ReadonlyArray<{
  id: AgentId;
  label: string;
  relativePath: string;
}> = [
  { id: "claude", label: "Claude Code", relativePath: ".claude/skills" },
  { id: "cursor", label: "Cursor", relativePath: ".cursor/skills" },
  { id: "gemini", label: "Gemini", relativePath: ".gemini/skills" },
  { id: "copilot", label: "GitHub Copilot", relativePath: ".copilot/skills" },
  { id: "continue", label: "Continue", relativePath: ".continue/skills" },
  { id: "cline", label: "Cline", relativePath: ".cline/skills" },
  { id: "codex", label: "OpenAI Codex", relativePath: ".codex/skills" },
  { id: "agents", label: "Agents (shared)", relativePath: ".agents/skills" },
];

interface Props {
  open: boolean;
  /** Skill name being unregistered. Surfaced in the prompt for context. */
  skillName: string;
  /** The destination that just collided — disabled in the list. */
  currentDestination: AgentId;
  onCancel: () => void;
  /** Fired with the new destination + an optional "save as default" flag. */
  onPick: (next: AgentId, persistAsDefault: boolean) => void | Promise<void>;
}

/**
 * Inline picker for the post-collision "pick another destination" flow.
 * Replaces the previous "open Settings and use a toast as a hint"
 * affordance, which displaced the user mid-task. Surfacing all agent
 * dirs as a single list keeps the choice local to the failing action.
 */
export function DestinationPickerDialog({
  open,
  skillName,
  currentDestination,
  onCancel,
  onPick,
}: Props): React.ReactElement | null {
  useFocusReturn();
  const modalRef = useRef<HTMLDivElement | null>(null);
  useInitialFocus(modalRef);
  const options = useMemo(
    () => AGENT_OPTIONS.filter((a) => a.id !== currentDestination),
    [currentDestination],
  );
  const firstChoice = options[0]?.id ?? AGENT_OPTIONS[0]!.id;
  const [picked, setPicked] = useState<AgentId>(firstChoice);
  const [persist, setPersist] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setPicked(firstChoice);
  }, [open, firstChoice]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.code === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKey, { capture: true });
  }, [open, onCancel]);

  if (!open) return null;

  const submit = async () => {
    setSubmitting(true);
    try {
      await onPick(picked, persist);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={overlay} onClick={onCancel} role="presentation">
      <div
        ref={modalRef}
        style={modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pick-dest-title"
        tabIndex={-1}
      >
        <h2 id="pick-dest-title" style={titleStyle}>
          <span style={iconWrap} aria-hidden="true">
            <Icon name="folder" size="md" />
          </span>
          Pick a destination for <code>{skillName}</code>
        </h2>
        <p style={summaryStyle}>
          The default destination already has a folder by this name. Choose
          another agent dir to move the files into.
        </p>

        <ul style={list} role="radiogroup" aria-labelledby="pick-dest-title">
          {options.map((a) => {
            const id = `dest-${a.id}`;
            const selected = picked === a.id;
            return (
              <li key={a.id}>
                <label htmlFor={id} style={row(selected)}>
                  <input
                    id={id}
                    type="radio"
                    name="destination"
                    value={a.id}
                    checked={selected}
                    onChange={() => setPicked(a.id)}
                  />
                  <span style={rowText}>
                    <span style={rowLabel}>{a.label}</span>
                    <code style={rowPath}>~/{a.relativePath}</code>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <label style={persistRow}>
          <input
            type="checkbox"
            checked={persist}
            onChange={(e) => setPersist(e.target.checked)}
          />
          <span>Use this as my default unregister destination from now on</span>
        </label>

        <div style={footer}>
          <button
            className="btn"
            type="button"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <span className="spinner inline" /> Moving
              </>
            ) : (
              "Move here"
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
  width: 520,
  maxWidth: "90vw",
  maxHeight: "85vh",
  overflowY: "auto",
  outline: "none",
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 15,
  fontWeight: 600,
};

const iconWrap: React.CSSProperties = {
  display: "inline-flex",
  color: "var(--accent)",
};

const summaryStyle: React.CSSProperties = {
  margin: "10px 0 14px 0",
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--text-2)",
};

const list: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const row = (selected: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 10px",
  border: "1px solid",
  borderColor: selected ? "var(--accent)" : "var(--border)",
  borderRadius: 6,
  cursor: "pointer",
  background: selected ? "var(--surface-hi)" : "transparent",
});

const rowText: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  flex: 1,
};

const rowLabel: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-1)",
};

const rowPath: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-3)",
};

const persistRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginTop: 14,
  fontSize: 12,
  color: "var(--text-2)",
  cursor: "pointer",
};

const footer: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 20,
};
