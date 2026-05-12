import React, { useState } from "react";
import type { AgentId } from "@skills-bank/core";
import { useFocusReturn } from "../hooks/useFocusReturn.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";

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
const AGENT_PATHS: Record<AgentId, string> = {
  claude: "~/.claude",
  cursor: "~/.cursor",
  gemini: "~/.gemini",
  copilot: "~/.copilot",
  continue: "~/.continue",
  cline: "~/.cline",
  codex: "~/.codex",
  agents: "~/.agents",
};
const ALL_AGENTS: AgentId[] = [
  "claude",
  "cursor",
  "gemini",
  "copilot",
  "continue",
  "cline",
  "codex",
  "agents",
];

export type GridColumns = "auto" | "2" | "3" | "4";
export type SearchDebounce = "off" | "100" | "250";
export type TerminalApp =
  | "system"
  | "iterm2"
  | "warp"
  | "hyper"
  | "alacritty"
  | "kitty";

export interface AppSettings {
  /**
   * Agents an "Install" action targets by default. Empty = broadcast
   * to every existing agent dir (legacy behavior).
   */
  defaultInstallAgents: AgentId[];
  gridColumns: GridColumns;
  searchDebounceMs: SearchDebounce;
  /** macOS only: which terminal app the Discover tab's "Open Terminal" uses. */
  terminalApp: TerminalApp;
  /**
   * Taxonomy axis "Adopted": when registering a skill, move its files
   * into the bank's `skills/` directory (true, default) vs. record an
   * external pointer and leave files where they are (false). M3 wires
   * this into the unified register flow; M1 ships the key.
   */
  registerAdopts: boolean;
  /**
   * Where to move an adopted skill's files when it's unregistered.
   * Default `~/.agents/skills/`. M4 consumes this in `unregisterSkill`.
   */
  unregisterDestinationAgent: AgentId;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultInstallAgents: [],
  gridColumns: "auto",
  searchDebounceMs: "off",
  terminalApp: "system",
  registerAdopts: true,
  unregisterDestinationAgent: "agents",
};

interface Props {
  settings: AppSettings;
  onSave: (next: AppSettings) => void;
  onClose: () => void;
}

/**
 * App-wide preferences. Persisted to localStorage by the App layer.
 * Surfaces three knobs today; structured to grow without forcing a
 * tabbed layout until there's enough content to justify one.
 */
export function SettingsModal({
  settings,
  onSave,
  onClose,
}: Props): React.ReactElement {
  useFocusReturn();
  useEscapeToClose(onClose);
  const [draft, setDraft] = useState<AppSettings>(settings);

  const toggleAgent = (id: AgentId) => {
    setDraft((prev) => {
      const set = new Set(prev.defaultInstallAgents);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...prev, defaultInstallAgents: Array.from(set) };
    });
  };

  const apply = () => {
    onSave(draft);
    onClose();
  };

  return (
    <div style={overlay}>
      <div style={modal} role="dialog" aria-modal="true" aria-label="Settings">
        <h2 style={{ marginTop: 0 }}>Settings</h2>

        <section style={section}>
          <h3 style={sectionTitle}>Default install agents</h3>
          <p style={hint}>
            When you install a skill from the Registry tab, link it into these
            agent directories. Leave all unchecked to broadcast to every agent
            directory that exists on this machine.
          </p>
          <div style={{ marginTop: 8 }}>
            {ALL_AGENTS.map((id) => (
              <label key={id} style={checkboxRow}>
                <input
                  type="checkbox"
                  checked={draft.defaultInstallAgents.includes(id)}
                  onChange={() => toggleAgent(id)}
                />
                <strong style={{ minWidth: 120 }}>{AGENT_LABELS[id]}</strong>
                <code style={{ color: "var(--text-3)", fontSize: 11 }}>
                  {AGENT_PATHS[id]}/skills/
                </code>
              </label>
            ))}
          </div>
        </section>

        <section style={section}>
          <h3 style={sectionTitle}>Card grid columns</h3>
          <p style={hint}>
            Auto adapts to the window width; fixed values give you consistent
            card density at the cost of overflow on narrow windows.
          </p>
          <div style={radioRow}>
            {(["auto", "2", "3", "4"] as GridColumns[]).map((v) => (
              <label key={v} style={radioOption}>
                <input
                  type="radio"
                  name="grid-cols"
                  checked={draft.gridColumns === v}
                  onChange={() =>
                    setDraft((prev) => ({ ...prev, gridColumns: v }))
                  }
                />
                <span>{v === "auto" ? "Auto" : `${v} columns`}</span>
              </label>
            ))}
          </div>
        </section>

        <section style={section}>
          <h3 style={sectionTitle}>Search debounce</h3>
          <p style={hint}>
            Delay before search filtering applies. Higher values keep the UI
            smooth on large registries.
          </p>
          <div style={radioRow}>
            {(["off", "100", "250"] as SearchDebounce[]).map((v) => (
              <label key={v} style={radioOption}>
                <input
                  type="radio"
                  name="search-debounce"
                  checked={draft.searchDebounceMs === v}
                  onChange={() =>
                    setDraft((prev) => ({ ...prev, searchDebounceMs: v }))
                  }
                />
                <span>{v === "off" ? "Off" : `${v} ms`}</span>
              </label>
            ))}
          </div>
        </section>

        <section style={section}>
          <h3 style={sectionTitle}>Terminal app (macOS)</h3>
          <p style={hint}>
            Used by the "Open Terminal" button in the Discover tab. The chosen
            app must be installed — uninstalled apps will fall back to Terminal.
          </p>
          <div style={radioRow}>
            {(
              [
                ["system", "Terminal"],
                ["iterm2", "iTerm2"],
                ["warp", "Warp"],
                ["hyper", "Hyper"],
                ["alacritty", "Alacritty"],
                ["kitty", "kitty"],
              ] as [TerminalApp, string][]
            ).map(([v, label]) => (
              <label key={v} style={radioOption}>
                <input
                  type="radio"
                  name="terminal-app"
                  checked={draft.terminalApp === v}
                  onChange={() =>
                    setDraft((prev) => ({ ...prev, terminalApp: v }))
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </section>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 16,
          }}
        >
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={apply}>
            Save
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
  zIndex: 1000,
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
};
const section: React.CSSProperties = {
  marginBottom: 24,
  paddingBottom: 16,
  borderBottom: "1px solid var(--border)",
};
const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "-0.01em",
  margin: "0 0 4px 0",
};
const hint: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-2)",
  margin: 0,
};
const checkboxRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "4px 0",
  fontSize: 13,
  cursor: "pointer",
};
const radioRow: React.CSSProperties = {
  display: "flex",
  gap: 12,
  marginTop: 8,
  flexWrap: "wrap",
};
const radioOption: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 13,
  cursor: "pointer",
};
