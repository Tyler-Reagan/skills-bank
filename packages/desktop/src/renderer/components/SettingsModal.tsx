import React, { useRef, useState } from "react";
import type { AgentId } from "@skills-bank/core";
import { useFocusReturn, useInitialFocus } from "../hooks/useFocusReturn.js";
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

type GridColumns = "auto" | "2" | "3" | "4";
type SearchDebounce = "off" | "100" | "250";
type TerminalApp =
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
  /**
   * User-defined custom skills directories that the Installed tab
   * scans in addition to the known agent dirs. Absolute paths. Empty
   * by default. Managed entirely from the Installed tab — this setting
   * is intentionally not surfaced in the Settings modal because it's
   * scoped to that tab's UX.
   */
  customSkillsDirs: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultInstallAgents: [],
  gridColumns: "auto",
  searchDebounceMs: "off",
  terminalApp: "system",
  registerAdopts: true,
  unregisterDestinationAgent: "agents",
  customSkillsDirs: [],
};

interface Props {
  settings: AppSettings;
  onSave: (next: AppSettings) => void;
  onClose: () => void;
  /**
   * M5: list of canon skill names currently hidden from default
   * views. The modal renders an Unhide row per name. Empty array
   * suppresses the section.
   */
  hiddenCanon: string[];
  /** Unhide a name; host refreshes the registry list. */
  onUnhide: (name: string) => Promise<void> | void;
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
  hiddenCanon,
  onUnhide,
}: Props): React.ReactElement {
  useFocusReturn();
  useEscapeToClose(onClose);
  const modalRef = useRef<HTMLDivElement | null>(null);
  useInitialFocus(modalRef);
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
      <div
        ref={modalRef}
        style={modal}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
      >
        <div style={modalHeader}>
          <h2 style={{ margin: 0 }}>Settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            style={closeBtn}
          >
            <Icon name="x" size="md" />
          </button>
        </div>
        <p style={hint}>
          Preferences for how the app behaves day-to-day. Registry source and
          identity live under <strong>Account</strong> settings.
        </p>

        <h3 style={groupHeading}>Skills</h3>
        <section style={section}>
          <h3 style={sectionTitle}>Registration</h3>
          <p style={hint}>
            When you register a skill, move its files into Skills Bank
            (recommended). With this off, the registry just records the skill's
            external location and leaves files where they are — useful for
            skills you actively edit in their own git repo.
          </p>
          <label style={{ ...checkboxRow, marginTop: 8 }}>
            <input
              type="checkbox"
              checked={draft.registerAdopts}
              onChange={() =>
                setDraft((prev) => ({
                  ...prev,
                  registerAdopts: !prev.registerAdopts,
                }))
              }
            />
            <strong>Move files into Skills Bank on Register</strong>
          </label>
        </section>

        <section style={section}>
          <h3 style={sectionTitle}>Unregister destination</h3>
          <p style={hint}>
            When you unregister an adopted skill, its files move out of Skills
            Bank into the agent dir picked here. The default,
            <code style={{ marginLeft: 4, marginRight: 4 }}>
              ~/.agents/skills/
            </code>
            , is the shared location all agents can read. Non-adopted
            (symlink-mode) skills aren't moved — their origin files stay in
            place.
          </p>
          <div style={radioRow}>
            {ALL_AGENTS.map((id) => (
              <label key={id} style={radioOption}>
                <input
                  type="radio"
                  name="unregister-dest"
                  checked={draft.unregisterDestinationAgent === id}
                  onChange={() =>
                    setDraft((prev) => ({
                      ...prev,
                      unregisterDestinationAgent: id,
                    }))
                  }
                />
                <span>{AGENT_LABELS[id]}</span>
              </label>
            ))}
          </div>
        </section>

        <section style={section}>
          <h3 style={sectionTitle}>Default install agents</h3>
          {/* end of Skills group; Display + Advanced groups follow. */}
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

        <h3 style={groupHeading}>Display</h3>
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

        <h3 style={groupHeading}>Advanced</h3>
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

        {hiddenCanon.length > 0 && (
          <section style={section}>
            <h3 style={sectionTitle}>Dismissed bundled skills</h3>
            <p style={hint}>
              Bundled skills you've dismissed from the default Browse view.
              Unhiding restores them everywhere. Their installations and
              metadata are preserved while dismissed — this is a UI dormancy
              flag, not an uninstall.
            </p>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: "8px 0 0",
              }}
            >
              {hiddenCanon.map((name) => (
                <li
                  key={name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <code style={{ fontSize: 13 }}>{name}</code>
                  <button
                    className="link-btn"
                    onClick={() => void onUnhide(name)}
                  >
                    Unhide
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

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
  width: 560,
  maxWidth: "90vw",
  maxHeight: "85vh",
  overflowY: "auto",
  outline: "none",
};
const modalHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  marginBottom: 4,
};
const closeBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "var(--text-3)",
  padding: 4,
  borderRadius: 4,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
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
const groupHeading: React.CSSProperties = {
  margin: "20px 0 4px 0",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--text-3)",
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
