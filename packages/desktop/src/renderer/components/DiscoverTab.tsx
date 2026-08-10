import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AdoptableNpxSkill,
  ClaudePluginSkill,
  RegistryEntry,
} from "@skills-bank/core";
import type { DiscoverStatus } from "../../shared/ipc.js";
import { DisclosureChevron } from "./primitives.js";

const HOME = "https://skills.sh";

/**
 * Accepts either a raw GitHub tree/blob URL or the npx install command
 * that skills.sh copies to the clipboard:
 *
 *   npx skills add https://github.com/owner/repo --skill skill-name
 *
 * Returns the trimmed input to hand to addFromGithub verbatim, or null if
 * it's neither recognised shape. The main process does the real parsing and
 * resolution (the npx form's skill folder is found by searching the repo
 * tree there) — the renderer no longer guesses a `skills/<name>` path.
 */
function parseInstallInput(raw: string): string | null {
  const s = raw.trim();
  if (/^npx\s+skills\s+add\s+\S+\s+--skill\s+\S+/.test(s)) return s;
  if (s.startsWith("https://github.com/")) return s;
  return null;
}

function formatUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const tail =
      u.pathname === "/" && !u.search ? "" : `${u.pathname}${u.search}`;
    return `${host}${tail}`;
  } catch {
    return url;
  }
}

interface Props {
  /** When true (any modal is open), hide the WebContentsView so it doesn't render above modal overlays. */
  modalOpen: boolean;
  /** macOS terminal app preference forwarded to the IPC handler. */
  terminalApp?: string;
  /** Called after a successful install so the host can refresh the registry. */
  onInstalled: () => void;
  /** Current registry, keyed by name — used only to flag a plugin-skill name that overlaps a managed skill. */
  registryByName: Map<string, RegistryEntry>;
}

export function DiscoverTab({
  modalOpen,
  terminalApp,
  onInstalled,
  registryByName,
}: Props): React.ReactElement {
  const [installUrl, setInstallUrl] = useState("");
  const [installBusy, setInstallBusy] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installBanner, setInstallBanner] = useState<string | null>(null);
  // Skills installed via npx that skills-bank doesn't yet manage (#192).
  // Fetched on view — deliberately not a boot sweep (see the IPC doc).
  const [npxSkills, setNpxSkills] = useState<AdoptableNpxSkill[]>([]);
  // Name currently being adopted (#193), and the last per-skill adopt error.
  const [adoptingName, setAdoptingName] = useState<string | null>(null);
  const [adoptError, setAdoptError] = useState<{
    name: string;
    message: string;
  } | null>(null);
  // Skills exposed by installed Claude Code plugins — read-only visibility
  // only, no adopt action. Fetched on view, same as the npx list; a name
  // colliding with a registry entry is just flagged inline, never resolved.
  const [pluginSkills, setPluginSkills] = useState<ClaudePluginSkill[]>([]);
  // Which plugin groups are expanded, keyed by "pluginName@marketplaceName".
  // Starts empty (everything collapsed) — a flat 50-60 skill list across a
  // handful of plugins is unscannable; collapsed group headers turn it back
  // into a glanceable summary, and the user opts into detail per plugin.
  const [expandedPluginGroups, setExpandedPluginGroups] = useState<Set<string>>(
    () => new Set(),
  );

  const submitInstall = async () => {
    const resolved = parseInstallInput(installUrl);
    if (!resolved) {
      setInstallError(
        "Paste an npx skills add … command or a GitHub folder URL.",
      );
      return;
    }
    setInstallBusy(true);
    setInstallError(null);
    setInstallBanner(null);
    try {
      const r = await window.skillsBank.addFromGithub(resolved);
      if (r.ok) {
        setInstallUrl("");
        setInstallBanner(`${r.name} added`);
        onInstalled();
        return;
      }
      switch (r.reason) {
        default:
          setInstallError(r.message);
      }
    } catch (err) {
      setInstallError(
        err instanceof Error
          ? err.message
          : "Add failed — check your network and try again.",
      );
    } finally {
      setInstallBusy(false);
    }
  };
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<DiscoverStatus>({
    kind: "loading",
    url: HOME,
  });

  // Mount/unmount lifecycle: attach the WebContentsView when this tab
  // mounts, detach when it unmounts. Bounds are pushed via ResizeObserver,
  // RAF-coalesced so a window resize stream stays cheap.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let rafHandle = 0;
    let lastSent = "";

    const measure = (): {
      x: number;
      y: number;
      width: number;
      height: number;
    } => {
      const r = host.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };

    const push = (initial: boolean) => {
      const b = measure();
      const sig = `${b.x},${b.y},${b.width},${b.height}`;
      if (!initial && sig === lastSent) return;
      lastSent = sig;
      if (initial) void window.skillsBank.discoverShow(b);
      else void window.skillsBank.discoverSetBounds(b);
    };

    const schedule = () => {
      if (rafHandle) return;
      rafHandle = requestAnimationFrame(() => {
        rafHandle = 0;
        push(false);
      });
    };

    push(true);

    const ro = new ResizeObserver(schedule);
    ro.observe(host);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);

    const unsub = window.skillsBank.onDiscoverStatus((s) => setStatus(s));

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      if (rafHandle) cancelAnimationFrame(rafHandle);
      unsub();
      void window.skillsBank.discoverHide();
    };
  }, []);

  // Hide the WebContentsView whenever a modal overlay is open — child views
  // always render above BrowserWindow content in Electron, so modals would
  // otherwise appear behind the embedded browser.
  // useLayoutEffect fires synchronously before the browser paints, ensuring
  // the view is hidden before the modal becomes visible (async hide arrives
  // too late and causes a visible flash of the embedded browser over the modal).
  useLayoutEffect(() => {
    if (modalOpen) {
      window.skillsBank.discoverHideSync();
    } else {
      const host = hostRef.current;
      if (!host) return;
      const r = host.getBoundingClientRect();
      void window.skillsBank.discoverShow({
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
      });
    }
  }, [modalOpen]);

  // Discover npx-installed skills not yet under skills-bank management.
  // Runs when the tab mounts (i.e. on user view) — never a boot sweep.
  // Failures degrade to an empty list; this is a passive nudge, not a
  // blocking flow.
  useEffect(() => {
    let cancelled = false;
    void window.skillsBank
      .discoverNpxSkills()
      .then((skills) => {
        if (!cancelled) setNpxSkills(skills);
      })
      .catch(() => {
        /* npx interop is best-effort — a read miss just hides the panel. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Discover skills exposed by installed Claude Code plugins. Read-only,
  // display-only — mirrors the npx fetch above but with no adopt affordance.
  useEffect(() => {
    let cancelled = false;
    void window.skillsBank
      .discoverClaudePluginSkills()
      .then((skills) => {
        if (!cancelled) setPluginSkills(skills);
      })
      .catch(() => {
        /* best-effort — a read miss just hides the panel. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onDismissPlugin = (skillPath: string) =>
    setPluginSkills((prev) => prev.filter((s) => s.skillPath !== skillPath));
  const onDismissAllPlugins = () => setPluginSkills([]);

  // Group by "pluginName@marketplaceName" — the same identity Claude Code
  // itself uses in installed_plugins.json — preserving first-seen order so
  // the group list doesn't reshuffle as the underlying list is dismissed
  // from.
  const pluginGroups = useMemo(() => {
    const order: string[] = [];
    const byKey = new Map<
      string,
      {
        key: string;
        pluginName: string;
        marketplaceName: string;
        skills: ClaudePluginSkill[];
      }
    >();
    for (const s of pluginSkills) {
      const key = `${s.pluginName}@${s.marketplaceName}`;
      let group = byKey.get(key);
      if (!group) {
        group = {
          key,
          pluginName: s.pluginName,
          marketplaceName: s.marketplaceName,
          skills: [],
        };
        byKey.set(key, group);
        order.push(key);
      }
      group.skills.push(s);
    }
    return order.map((key) => byKey.get(key)!);
  }, [pluginSkills]);

  const allPluginGroupsExpanded =
    pluginGroups.length > 0 &&
    pluginGroups.every((g) => expandedPluginGroups.has(g.key));

  const togglePluginGroup = (key: string) =>
    setExpandedPluginGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleAllPluginGroups = () =>
    setExpandedPluginGroups(
      allPluginGroupsExpanded
        ? new Set()
        : new Set(pluginGroups.map((g) => g.key)),
    );

  // Adopt one npx skill into the registry (#193): move it in, repoint agent
  // symlinks at the bank copy, backfill origin from the lockfile. On success
  // it leaves the adoptable list and the host refreshes so it appears in
  // Browse. Errors surface inline against the offending row.
  const onAdopt = async (name: string) => {
    setAdoptingName(name);
    setAdoptError(null);
    try {
      const r = await window.skillsBank.adoptNpxSkill(name);
      if (r.ok) {
        setNpxSkills((prev) => prev.filter((s) => s.name !== name));
        onInstalled();
      } else {
        setAdoptError({ name, message: r.message });
      }
    } catch (err) {
      setAdoptError({
        name,
        message: err instanceof Error ? err.message : "Adopt failed.",
      });
    } finally {
      setAdoptingName(null);
    }
  };

  // Dismiss adopt prompts without adopting — a UI-only hide (skills-bank never
  // writes npx's lockfile). Covers a skill the user doesn't want managed here,
  // or the odd stale row that slips past the on-disk filter. Session-scoped:
  // the panel is repopulated from the live lockfile next time the tab mounts,
  // so nothing genuinely adoptable is hidden for good.
  const onDismiss = (name: string) =>
    setNpxSkills((prev) => prev.filter((s) => s.name !== name));
  const onDismissAll = () => setNpxSkills([]);

  // Re-push the embedded view's bounds when the npx panel appears or
  // changes height: inserting it above `discover-host` shifts the host
  // down without resizing it, so the ResizeObserver never fires. Skip
  // while a modal is open (the view is hidden then).
  useEffect(() => {
    if (modalOpen) return;
    const host = hostRef.current;
    if (!host) return;
    const r = host.getBoundingClientRect();
    void window.skillsBank.discoverSetBounds({
      x: r.left,
      y: r.top,
      width: r.width,
      height: r.height,
    });
  }, [npxSkills, pluginSkills, expandedPluginGroups, modalOpen]);

  const onBack = () => void window.skillsBank.discoverGoBack();
  const onReload = () => void window.skillsBank.discoverReload();
  const onOpenExternal = () => void window.skillsBank.discoverOpenExternal();
  // Hand the terminal the install form's current input so it opens pre-loaded
  // with the resolved `npx skills add … --skill …` command (issue #194). Empty
  // or unrecognised input falls back to a bare shell in the main process.
  const onOpenTerminal = () =>
    void window.skillsBank.discoverOpenTerminal(terminalApp, installUrl);

  const isError = status.kind === "error";
  const isLoading = status.kind === "loading";
  const canGoBack = status.kind === "ready" && status.canGoBack;
  const url = "url" in status ? status.url : HOME;

  return (
    <div className="discover-tab">
      <p className="discover-intro">
        <strong>skills.sh</strong> (below) is where you acquire skills. Skills
        Bank is the version-control layer over it — adopt, version, sync across
        machines, and detect drift on what you add. Use <em>Open Terminal</em>{" "}
        to hand off to <code>npx skills</code> for install across all 70+
        agents.
      </p>
      <div className="discover-callout" aria-label="Add a skill from GitHub">
        <span className="discover-callout-label">See a skill you want?</span>
        <div className="discover-callout-form">
          <input
            type="text"
            className="discover-callout-input"
            placeholder='Paste "npx skills add <url> --skill <name>" or a GitHub skill folder URL'
            value={installUrl}
            disabled={installBusy}
            onChange={(e) => {
              setInstallUrl(e.target.value);
              setInstallError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && installUrl.trim().length > 0)
                void submitInstall();
            }}
            aria-label="GitHub skill folder URL"
          />
          <button
            type="button"
            className="btn"
            onClick={() => void submitInstall()}
            disabled={installBusy || installUrl.trim().length === 0}
          >
            {installBusy ? (
              <>
                <span className="spinner inline" /> Adding
              </>
            ) : (
              "Add"
            )}
          </button>
        </div>
        {installError && (
          <p
            role="alert"
            className="discover-callout-feedback discover-callout-feedback--error"
          >
            {installError}
          </p>
        )}
        {installBanner && (
          <div className="discover-install-banner" role="status">
            <span>{installBanner}</span>
            <button
              type="button"
              className="discover-install-banner-dismiss"
              aria-label="Dismiss"
              onClick={() => setInstallBanner(null)}
            >
              ✕
            </button>
          </div>
        )}
      </div>
      {npxSkills.length > 0 && (
        <section
          className="discover-npx"
          aria-label="Skills installed via npx you can adopt"
        >
          <div className="discover-npx-head">
            <div className="discover-npx-titlebar">
              <span className="discover-npx-title">
                {npxSkills.length} skill{npxSkills.length === 1 ? "" : "s"}{" "}
                installed via npx, not yet managed here
              </span>
              <button
                type="button"
                className="btn ghost discover-npx-dismiss-all"
                onClick={onDismissAll}
                disabled={adoptingName !== null}
                title="Hide these prompts — nothing is uninstalled, and skills-bank never touches npx's lockfile"
              >
                Dismiss all
              </button>
            </div>
            <p className="discover-npx-copy">
              Adopt them into skills-bank for version control — a tracked
              manifest row, cross-machine sync, and drift detection against
              their upstream. npx installs stay put until you choose to adopt;
              once adopted, manage the skill here, not via npx — its npx entry
              goes stale (skills-bank reads npx's lockfile but never rewrites
              it).
            </p>
          </div>
          <ul className="discover-npx-list">
            {npxSkills.map((s) => (
              <li key={s.name} className="discover-npx-item">
                <div className="discover-npx-item-main">
                  <span className="discover-npx-name">{s.name}</span>
                  <span className="discover-npx-origin">
                    {s.origin?.url
                      ? formatUrl(s.origin.url)
                      : "local install — no upstream recorded"}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void onAdopt(s.name)}
                  disabled={adoptingName !== null}
                >
                  {adoptingName === s.name ? (
                    <>
                      <span className="spinner inline" /> Adopting
                    </>
                  ) : (
                    "Adopt"
                  )}
                </button>
                <button
                  type="button"
                  className="discover-npx-dismiss"
                  onClick={() => onDismiss(s.name)}
                  disabled={adoptingName !== null}
                  aria-label={`Dismiss ${s.name}`}
                  title="Hide this prompt (does not uninstall or touch npx)"
                >
                  ✕
                </button>
                {adoptError?.name === s.name && (
                  <p
                    role="alert"
                    className="discover-npx-error"
                    aria-live="polite"
                  >
                    {adoptError.message}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {pluginSkills.length > 0 && (
        <section
          className="discover-plugins"
          aria-label="Skills available via installed Claude Code plugins"
        >
          <div className="discover-plugins-head">
            <div className="discover-plugins-titlebar">
              <span className="discover-plugins-title">
                {pluginSkills.length} skill
                {pluginSkills.length === 1 ? "" : "s"} across{" "}
                {pluginGroups.length} installed Claude Code plugin
                {pluginGroups.length === 1 ? "" : "s"}
              </span>
              <div className="discover-plugins-head-actions">
                {pluginGroups.length >= 2 && (
                  <button
                    type="button"
                    className={`expand-collapse-btn${allPluginGroupsExpanded ? " all-collapsed" : ""}`}
                    onClick={toggleAllPluginGroups}
                  >
                    <DisclosureChevron open={!allPluginGroupsExpanded} />
                    {allPluginGroupsExpanded ? "Collapse all" : "Expand all"}
                  </button>
                )}
                <button
                  type="button"
                  className="btn ghost discover-plugins-dismiss-all"
                  onClick={onDismissAllPlugins}
                  title="Hide these — nothing is changed, skills-bank never manages plugin state"
                >
                  Dismiss all
                </button>
              </div>
            </div>
            <p className="discover-plugins-copy">
              Informational only — skills-bank doesn't manage plugin skills or
              merge them into your registry. A skill also present in your
              registry is flagged below; nothing is resolved automatically.
            </p>
          </div>
          <div className="discover-plugins-groups">
            {pluginGroups.map((group) => {
              const open = expandedPluginGroups.has(group.key);
              return (
                <div key={group.key} className="discover-plugins-group">
                  <button
                    type="button"
                    className="discover-plugins-group-header"
                    aria-expanded={open}
                    onClick={() => togglePluginGroup(group.key)}
                  >
                    <DisclosureChevron open={open} />
                    <span className="discover-plugins-group-name">
                      {group.pluginName}
                    </span>
                    <span className="discover-plugins-group-marketplace">
                      @{group.marketplaceName}
                    </span>
                    <span className="discover-plugins-group-count">
                      {group.skills.length}
                    </span>
                  </button>
                  {open && (
                    <ul className="discover-plugins-list">
                      {group.skills.map((s) => (
                        <li key={s.skillPath} className="discover-plugins-item">
                          <div className="discover-plugins-item-main">
                            <span className="discover-plugins-name">
                              {s.name}
                            </span>
                            {s.description && (
                              <span className="discover-plugins-description">
                                {s.description}
                              </span>
                            )}
                          </div>
                          {registryByName.has(s.name) && (
                            <span
                              className="discover-plugins-overlap"
                              title="A skill with this name is also in your skills-bank registry"
                            >
                              also in registry
                            </span>
                          )}
                          <button
                            type="button"
                            className="discover-plugins-dismiss"
                            onClick={() => onDismissPlugin(s.skillPath)}
                            aria-label={`Dismiss ${s.name}`}
                            title="Hide this row (does not uninstall or touch the plugin)"
                          >
                            ✕
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
      <div
        className="discover-chrome"
        role="toolbar"
        aria-label="skills.sh navigation"
      >
        <button
          type="button"
          className="icon-btn"
          onClick={onBack}
          disabled={!canGoBack}
          aria-label="Go back"
          title="Back"
        >
          ←
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onReload}
          aria-label="Reload"
          title="Reload"
        >
          ↻
        </button>
        <div className="discover-url" title={url} aria-live="polite">
          {formatUrl(url)}
        </div>
        <span
          className={`discover-dot ${isError ? "offline" : "online"}`}
          aria-label={isError ? "Offline" : "Online"}
          title={isError ? "Offline or load failed" : "Connected"}
        />
        <button
          type="button"
          className="btn ghost"
          onClick={onOpenTerminal}
          title="Hand off to npx skills — installs across all 70+ agents. Pre-filled with the command from the box above when present."
        >
          Open Terminal ↗
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={onOpenExternal}
          title="Open the current page in your default browser"
        >
          Open in browser ↗
        </button>
      </div>
      {isLoading && <div className="discover-progress" aria-hidden="true" />}
      <div
        ref={hostRef}
        className={`discover-host ${isError ? "is-error" : ""}`}
      >
        {isError && (
          <DiscoverEmpty
            description={
              status.errorCode === -106 || status.errorCode === -105
                ? "You appear to be offline. Reconnect and try again."
                : `Load failed (${status.description || `code ${status.errorCode}`}).`
            }
            onRetry={onReload}
            onOpenExternal={onOpenExternal}
          />
        )}
      </div>
    </div>
  );
}

// Error-state card shown when skills.sh can't be reached. Folded in
// from its own file: single-use, no logic.

interface DiscoverEmptyProps {
  description: string;
  onRetry: () => void;
  onOpenExternal: () => void;
}

function DiscoverEmpty({
  description,
  onRetry,
  onOpenExternal,
}: DiscoverEmptyProps): React.ReactElement {
  return (
    <div className="discover-empty" role="status" aria-live="polite">
      <div className="discover-empty-card">
        <div className="discover-empty-eyebrow">skills.sh</div>
        <h2 className="discover-empty-title">Can't reach skills.sh</h2>
        <p className="discover-empty-body">{description}</p>
        <div className="discover-empty-actions">
          <button
            type="button"
            className="btn primary"
            onClick={onRetry}
            autoFocus
          >
            Retry
          </button>
          <button type="button" className="btn ghost" onClick={onOpenExternal}>
            Open in browser
          </button>
        </div>
      </div>
    </div>
  );
}
