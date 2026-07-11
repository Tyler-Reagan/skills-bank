import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DiscoverStatus } from "../../shared/ipc.js";

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
}

export function DiscoverTab({
  modalOpen,
  terminalApp,
  onInstalled,
}: Props): React.ReactElement {
  const [installUrl, setInstallUrl] = useState("");
  const [installBusy, setInstallBusy] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installBanner, setInstallBanner] = useState<string | null>(null);

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

  const onBack = () => void window.skillsBank.discoverGoBack();
  const onReload = () => void window.skillsBank.discoverReload();
  const onOpenExternal = () => void window.skillsBank.discoverOpenExternal();
  const onOpenTerminal = () =>
    void window.skillsBank.discoverOpenTerminal(terminalApp);

  const isError = status.kind === "error";
  const isLoading = status.kind === "loading";
  const canGoBack = status.kind === "ready" && status.canGoBack;
  const url = "url" in status ? status.url : HOME;

  return (
    <div className="discover-tab">
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
          title="Run raw npx commands (advanced). Most users prefer Settings → Add a skill from GitHub."
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
