import React, { useEffect, useRef, useState } from "react";
import type { DiscoverStatus } from "../../shared/ipc.js";
import { DiscoverEmpty } from "./DiscoverEmpty.js";

const HOME = "https://skills.sh";

function formatUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const tail = u.pathname === "/" && !u.search ? "" : `${u.pathname}${u.search}`;
    return `${host}${tail}`;
  } catch {
    return url;
  }
}

export function DiscoverTab(): React.ReactElement {
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

    const measure = (): { x: number; y: number; width: number; height: number } => {
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

  const onBack = () => void window.skillsBank.discoverGoBack();
  const onReload = () => void window.skillsBank.discoverReload();
  const onOpenExternal = () => void window.skillsBank.discoverOpenExternal();

  const isError = status.kind === "error";
  const isLoading = status.kind === "loading";
  const canGoBack = status.kind === "ready" && status.canGoBack;
  const url = "url" in status ? status.url : HOME;

  return (
    <div className="discover-tab">
      <div className="discover-chrome" role="toolbar" aria-label="skills.sh navigation">
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
