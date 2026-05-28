import React, { useMemo, useState } from "react";
import type { AgentId } from "@skills-bank/core";
import { useSettings } from "../SettingsContext.js";
import {
  AGENT_LABELS,
  AGENT_PATHS,
  ALL_AGENT_IDS as ALL_AGENTS,
} from "../agentDisplay.js";
import { useIpcQuery } from "../hooks/useIpcQuery.js";
import { Icon } from "./Icon.js";
import { Modal, ModalCloseButton, modalHeader } from "./modalStyles.js";

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
  /**
   * Show per-skill upstream activity (last commit to the skill's
   * folder in its source repo) in the drawer's Origin section.
   * Off by default — this is a per-skill GitHub API call with no
   * repo dedup, so heavy registries can pressure the user's rate
   * limit budget. Gated to authed users; surfaces a sign-in hint
   * when toggled by an unauth user.
   */
  showOriginActivity: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultInstallAgents: [],
  gridColumns: "auto",
  searchDebounceMs: "off",
  terminalApp: "system",
  registerAdopts: true,
  unregisterDestinationAgent: "agents",
  customSkillsDirs: [],
  showOriginActivity: false,
};

interface Props {
  onClose: () => void;
  /**
   * M5: list of canon skill names currently hidden from default
   * views. The modal renders an Unhide row per name. Empty array
   * suppresses the section.
   */
  hiddenCanon: string[];
  /** Unhide a name; host refreshes the registry list. */
  onUnhide: (name: string) => Promise<void> | void;
  /**
   * Whether the user is signed in with GitHub. Gates the
   * "Show upstream activity" toggle — when not authed, the toggle
   * disables and surfaces a sign-in hint rather than letting the
   * user enable a feature that would silently fail.
   */
  isAuthed: boolean;
  /**
   * v1.5: opens the Install-from-GitHub modal. Routed through the
   * parent so the modal can refresh the registry view after a
   * successful install via the same refresh path other mutations
   * use.
   */
  onOpenInstallFromGithub: () => void;
}

/**
 * App-wide preferences. Persisted to localStorage by the App layer.
 * Surfaces three knobs today; structured to grow without forcing a
 * tabbed layout until there's enough content to justify one.
 */
export function SettingsModal({
  onClose,
  onOpenInstallFromGithub,
  hiddenCanon,
  onUnhide,
  isAuthed,
}: Props): React.ReactElement {
  const { settings, saveSettings: onSave } = useSettings();
  const [draft, setDraft] = useState<AppSettings>(settings);

  // Top-level agent dir symlinks — drives the conditional "Collapse
  // symlinked agent dirs" section. Loaded once on mount; refresh after
  // a successful finalize so the section disappears.
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  const { data: symlinkData, refetch: refetchSymlinks } = useIpcQuery(
    () => window.skillsBank.listTopLevelSymlinks(),
    [],
    { initialData: [] },
  );
  const topLevelSymlinks = symlinkData ?? [];

  // Curated skills snapshot. Read-only display; curated is an
  // app-managed dependency post-v1.3 — content refresh runs silently
  // on app launch via runSync.
  const { data: registryEntries } = useIpcQuery(
    () => window.skillsBank.listRegistry(),
    [],
    { initialData: [] },
  );
  const curatedSkills = useMemo(
    () =>
      (registryEntries ?? [])
        .filter((e) => e.source.source === "curated")
        .map((e) => ({ name: e.name, description: e.description })),
    [registryEntries],
  );
  const { data: syncReport } = useIpcQuery(
    () => window.skillsBank.getSyncReport(),
    [],
  );
  const curatedLastCheckedAt = syncReport?.syncedAt ?? null;

  const runFinalize = async () => {
    setFinalizing(true);
    setFinalizeError(null);
    try {
      const r = await window.skillsBank.finalize();
      if (r.ok) {
        refetchSymlinks();
      } else {
        setFinalizeError(
          r.blockingEntries
            ? `${r.message}\n${r.blockingEntries.map((n) => `  • ${n}`).join("\n")}`
            : r.message,
        );
      }
    } finally {
      setFinalizing(false);
    }
  };

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
    <Modal label="Settings" onClose={onClose} width={560}>
      <div className={modalHeader}>
        <h2 className="mt-0 mb-0">Settings</h2>
        <ModalCloseButton onClose={onClose} />
      </div>
      <p className="settings-hint">
        Preferences for how the app behaves day-to-day. Registry source and
        identity live under <strong>Account</strong> settings.
      </p>

      <h3 className="settings-group-heading">Skills</h3>
      <section className="settings-section">
        <h3 className="settings-section-title">Registration</h3>
        <p className="settings-hint">
          When you register a skill, move its files into Skills Bank
          (recommended). With this off, the registry just records the skill's
          external location and leaves files where they are — useful for skills
          you actively edit in their own git repo.
        </p>
        <label className="settings-checkbox-row mt-8">
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

      <section className="settings-section">
        <h3 className="settings-section-title">Upstream activity</h3>
        <p className="settings-hint">
          Show the most recent commit to each skill's folder in its source repo
          (in the drawer's Origin section). Uses your GitHub token for 1 API
          call per skill — heavy registries can pressure your rate-limit budget,
          so it's off by default.
        </p>
        <label
          className={`settings-checkbox-row mt-8${isAuthed ? "" : " settings-checkbox-row-disabled"}`}
        >
          <input
            type="checkbox"
            checked={draft.showOriginActivity && isAuthed}
            disabled={!isAuthed}
            onChange={() =>
              setDraft((prev) => ({
                ...prev,
                showOriginActivity: !prev.showOriginActivity,
              }))
            }
          />
          <strong>Show Origin activity</strong>
        </label>
        {!isAuthed && (
          <p className="settings-hint mt-6 text-11">
            Sign in with GitHub to enable — Account → Sign in with GitHub.
          </p>
        )}
      </section>

      <section className="settings-section">
        <h3 className="settings-section-title">Unregister destination</h3>
        <p className="settings-hint">
          When you unregister an adopted skill, its files move out of Skills
          Bank into the agent dir picked here. The default,
          <code className="ml-4 mr-4">~/.agents/skills/</code>, is the shared
          location all agents can read. Non-adopted (symlink-mode) skills aren't
          moved — their origin files stay in place.
        </p>
        <div className="settings-radio-row">
          {ALL_AGENTS.map((id) => (
            <label key={id} className="settings-radio-option">
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

      <section className="settings-section">
        <h3 className="settings-section-title">Default agents</h3>
        {/* end of Skills group; Display + Advanced groups follow. */}
        <p className="settings-hint">
          When you install or register a skill, link it into these agent
          directories. Leave all unchecked to broadcast to every agent
          directory that exists on this machine.
        </p>
        <div className="mt-8">
          {ALL_AGENTS.map((id) => (
            <label key={id} className="settings-checkbox-row">
              <input
                type="checkbox"
                checked={draft.defaultInstallAgents.includes(id)}
                onChange={() => toggleAgent(id)}
              />
              <strong className="min-w-120">{AGENT_LABELS[id]}</strong>
              <code className="text-subtle text-11">
                {AGENT_PATHS[id]}/skills/
              </code>
            </label>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-section-title">Install a skill from GitHub</h3>
        <p className="settings-hint">
          Paste a GitHub folder URL (or a SKILL.md blob URL) and the app fetches
          the skill directly into your bank — no terminal, no npx. The skill
          lands as <code>source: user</code> with its origin stamped, so future
          updates flow through the standard update path.
        </p>
        <button
          className="btn mt-8"
          type="button"
          onClick={() => onOpenInstallFromGithub()}
        >
          Install a skill from GitHub
        </button>
      </section>

      <section className="settings-section">
        <h3 className="settings-section-title">Curated skills</h3>
        <p className="settings-hint">
          Skills bundled with the app, maintained centrally. Read-only — curated
          skills update automatically on app restart.
        </p>
        {curatedSkills.length === 0 ? (
          <p className="settings-hint italic">None present in this registry.</p>
        ) : (
          <ul className="settings-list">
            {curatedSkills.map((s) => (
              <li key={s.name} className="mb-4">
                <code>{s.name}</code>
                {s.description ? (
                  <span className="text-subtle"> — {s.description}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="settings-hint mt-6 text-11">
          Last checked:{" "}
          {curatedLastCheckedAt
            ? new Date(curatedLastCheckedAt).toLocaleString()
            : "never"}
        </p>
      </section>

      <h3 className="settings-group-heading">Display</h3>
      <section className="settings-section">
        <h3 className="settings-section-title">Card grid columns</h3>
        <p className="settings-hint">
          Auto adapts to the window width; fixed values give you consistent card
          density at the cost of overflow on narrow windows.
        </p>
        <div className="settings-radio-row">
          {(["auto", "2", "3", "4"] as GridColumns[]).map((v) => (
            <label key={v} className="settings-radio-option">
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

      <h3 className="settings-group-heading">Advanced</h3>
      <section className="settings-section">
        <h3 className="settings-section-title">Search debounce</h3>
        <p className="settings-hint">
          Delay before search filtering applies. Higher values keep the UI
          smooth on large registries.
        </p>
        <div className="settings-radio-row">
          {(["off", "100", "250"] as SearchDebounce[]).map((v) => (
            <label key={v} className="settings-radio-option">
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

      {topLevelSymlinks.length > 0 && (
        <section className="settings-section">
          <h3 className="settings-section-title">
            Collapse symlinked agent dirs
          </h3>
          <p className="settings-hint">
            {topLevelSymlinks.length === 1
              ? "One"
              : `${topLevelSymlinks.length}`}{" "}
            agent skills directory
            {topLevelSymlinks.length === 1 ? " is" : "s are"} symlinked to
            another location:
          </p>
          <ul className="settings-list">
            {topLevelSymlinks.map((tls) => (
              <li key={tls.agent} className="mb-2">
                <code>{tls.agent}</code> → <code>{tls.resolvedTarget}</code>
                {!tls.exists && <span className="text-danger"> (missing)</span>}
              </li>
            ))}
          </ul>
          <p className="settings-hint">
            Finalize collapses each symlink into a real directory in place,
            moving content from the resolved target. Skills must be registered
            first — finalize refuses while real-directory entries remain
            unregistered.
          </p>
          <button
            className="btn"
            type="button"
            disabled={finalizing}
            onClick={() => void runFinalize()}
          >
            {finalizing ? (
              <>
                <span className="spinner inline" /> Finalizing
              </>
            ) : (
              "Finalize now"
            )}
          </button>
          {finalizeError && (
            <pre className="mt-8 text-11 text-danger pre-wrap">
              {finalizeError}
            </pre>
          )}
        </section>
      )}

      <section className="settings-section">
        <h3 className="settings-section-title">Terminal app (macOS)</h3>
        <p className="settings-hint">
          Used by the "Open Terminal" button in the Discover tab. The chosen app
          must be installed — uninstalled apps will fall back to Terminal.
        </p>
        <div className="settings-radio-row">
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
            <label key={v} className="settings-radio-option">
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
        <section className="settings-section">
          <h3 className="settings-section-title">Dismissed bundled skills</h3>
          <p className="settings-hint">
            Bundled skills you've dismissed from the default Browse view.
            Unhiding restores them everywhere. Their installations and metadata
            are preserved while dismissed — this is a UI dormancy flag, not an
            uninstall.
          </p>
          <ul className="settings-unhide-list">
            {hiddenCanon.map((name) => (
              <li key={name} className="settings-unhide-item">
                <code className="text-13">{name}</code>
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

      <div className="row-end mt-16">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={apply}>
          Save
        </button>
      </div>
    </Modal>
  );
}
