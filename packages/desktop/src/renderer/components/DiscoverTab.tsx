import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DiscoverStatus } from "../../shared/ipc.js";
import { DiscoverEmpty } from "./DiscoverEmpty.js";

const HOME = "https://skills.sh";

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
}

export function DiscoverTab({
  modalOpen,
  terminalApp,
}: Props): React.ReactElement {
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
      <div
        className="discover-callout"
        role="note"
        aria-label="How discovered skills land in your registry"
      >
        Anything you install via <code>npx skills add</code> will appear in
        your registry automatically.
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
          title="Open a terminal to run install commands (e.g. npx skillsadd ...)"
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
