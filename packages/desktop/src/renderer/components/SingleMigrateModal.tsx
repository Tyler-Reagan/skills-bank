import React, { useState } from "react";
import type {
  InstalledSkill,
  MigrationAction,
  MigrationResult,
} from "@skills-bank/core";
import { useFocusReturn } from "../hooks/useFocusReturn.js";
import { Icon } from "./Icon.js";

interface Props {
  entry: InstalledSkill;
  onClose: () => void | Promise<void>;
  onFlash: (msg: string) => void;
}

type Phase =
  | { kind: "plan" }
  | { kind: "applying" }
  | { kind: "result"; result: MigrationResult };

export function SingleMigrateModal({
  entry,
  onClose,
  onFlash,
}: Props): React.ReactElement {
  useFocusReturn();
  const [action, setAction] = useState<MigrationAction>(() =>
    defaultAction(entry),
  );
  const [phase, setPhase] = useState<Phase>({ kind: "plan" });

  const apply = async () => {
    setPhase({ kind: "applying" });
    const results = await window.skillsBank.migrate([
      { name: entry.name, action },
    ]);
    const result = results[0]!;
    if (result.ok && result.action.type === "adopt") {
      // Refresh the index so the freshly adopted skill is recognised.
      void window.skillsBank.rebuildIndex();
    }
    setPhase({ kind: "result", result });
  };

  if (phase.kind === "applying") {
    return (
      <div style={overlay}>
        <div style={modal} role="dialog" aria-modal="true">
          <h2 style={{ marginTop: 0 }}>Migrating {entry.name}…</h2>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "32px 0",
            }}
          >
            <div className="spinner" />
          </div>
        </div>
      </div>
    );
  }

  if (phase.kind === "result") {
    return (
      <div style={overlay}>
        <div style={modal} role="dialog" aria-modal="true">
          <h2 style={{ marginTop: 0 }}>
            {phase.result.ok ? "Migration complete" : "Migration failed"}
          </h2>
          <p
            style={{
              color: phase.result.ok ? "var(--success)" : "var(--danger)",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon name={phase.result.ok ? "check" : "x"} size="sm" />{" "}
            {phase.result.message}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              className="primary"
              onClick={() => {
                onFlash(phase.result.message);
                void onClose();
              }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  const options = optionsFor(entry);

  return (
    <div style={overlay}>
      <div style={modal} role="dialog" aria-modal="true">
        <h2 style={{ marginTop: 0 }}>Migrate {entry.name}</h2>
        <p style={{ color: "var(--text-2)", fontSize: 13 }}>
          <span className="tag">{entry.kind}</span>
        </p>
        <p style={{ color: "var(--text-3)", fontSize: 12, marginTop: 4 }}>
          {entry.target ?? entry.linkPath}
        </p>

        <div style={{ marginTop: 16, marginBottom: 16 }}>
          {options.map((o) => (
            <label
              key={o.value}
              style={{
                display: "block",
                padding: 10,
                marginBottom: 6,
                border: "1px solid var(--border)",
                borderRadius: 6,
                cursor: "pointer",
                background:
                  action.type === o.value ? "var(--accent-dim)" : "transparent",
                borderColor:
                  action.type === o.value
                    ? "var(--accent)"
                    : "var(--border)",
              }}
            >
              <input
                type="radio"
                name="action"
                value={o.value}
                checked={action.type === o.value}
                onChange={() => setAction(actionFor(o.value, entry))}
                style={{ marginRight: 8 }}
              />
              <strong style={{ color: "var(--text)" }}>{o.label}</strong>
              <p
                style={{
                  margin: "4px 0 0 24px",
                  fontSize: 12,
                  color: "var(--text-2)",
                }}
              >
                {o.description}
              </p>
            </label>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={() => void onClose()}>Cancel</button>
          <button className="primary" onClick={() => void apply()}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function defaultAction(e: InstalledSkill): MigrationAction {
  switch (e.kind) {
    case "ours":
      return { type: "skip", name: e.name };
    case "broken-symlink":
      return { type: "remove", name: e.name };
    case "foreign-symlink":
      return { type: "register-external", name: e.name };
    case "real-directory":
      return { type: "adopt", name: e.name };
  }
}

interface ActionOption {
  value: MigrationAction["type"];
  label: string;
  description: string;
}

function optionsFor(e: InstalledSkill): ActionOption[] {
  switch (e.kind) {
    case "ours":
      return [
        {
          value: "skip",
          label: "Skip",
          description: "Already integrated. No action needed.",
        },
      ];
    case "broken-symlink":
      return [
        {
          value: "remove",
          label: "Remove broken symlink",
          description: "Delete the dead link from ~/.claude/skills.",
        },
        {
          value: "skip",
          label: "Skip",
          description: "Leave it in place.",
        },
      ];
    case "foreign-symlink":
      return [
        {
          value: "adopt",
          label: "Adopt into registry",
          description:
            "Copy the target folder into skills/<name>/ and re-point the symlink at the registry.",
        },
        {
          value: "register-external",
          label: "Register as external",
          description:
            "Track the symlink in .skills-bank/external.json without touching the source.",
        },
        { value: "skip", label: "Skip", description: "Leave it as-is." },
        {
          value: "remove",
          label: "Remove symlink",
          description:
            "Delete the symlink (leaves the target folder untouched).",
        },
      ];
    case "real-directory":
      return [
        {
          value: "adopt",
          label: "Adopt into registry",
          description:
            "Move the directory into skills/<name>/ and replace it with a symlink.",
        },
        { value: "skip", label: "Skip", description: "Leave it as-is." },
      ];
  }
}

function actionFor(
  type: MigrationAction["type"],
  e: InstalledSkill,
): MigrationAction {
  switch (type) {
    case "adopt":
      return { type: "adopt", name: e.name };
    case "register-external":
      return { type: "register-external", name: e.name };
    case "remove":
      return { type: "remove", name: e.name };
    case "skip":
      return { type: "skip", name: e.name };
  }
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const modal: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border-hi)",
  borderRadius: 8,
  padding: 24,
  width: 520,
  maxWidth: "90vw",
};
