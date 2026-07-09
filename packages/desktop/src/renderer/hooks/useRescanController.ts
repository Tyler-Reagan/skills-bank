import { useCallback, useEffect, useRef, useState } from "react";
import { type RescanState } from "../components/Header.js";
import { type RegistryFilterTag } from "../components/browseFilters.js";
import { type TabId } from "../components/Tabs.js";

type ToastAction = { label: string; onClick: () => void };

interface FlashErrorOpts {
  action?: ToastAction;
  diagnostic?: string;
}

interface Args {
  /** Re-fetch the registry. Called after rebuildIndex and on probe-complete. */
  refresh: () => Promise<unknown>;
  /** Sticky-error toast used to surface rate-limit failures from the probe. */
  flashError: (msg: string, opts?: FlashErrorOpts) => void;
  /** "View" deep-link from the done-state button: flips the Updates chip. */
  setRegistryFilters: (next: Set<RegistryFilterTag>) => void;
  /** "View" deep-link: bounces the user into Browse. */
  setTabPersisted: (tab: TabId) => void;
  /**
   * Click handler for the rate-limit toast's "Sign in" action (only fired
   * when the upstream probe failed with `unauthenticated: true`). The
   * caller is responsible for clearing the toast and opening the account
   * modal — keeping toast internals out of the hook's surface.
   */
  onRequestSignIn: () => void;
}

interface Result {
  state: RescanState;
  onRefreshClick: () => Promise<void>;
  onViewUpdates: () => void;
}

/**
 * Owns the Header Rescan button's state machine end-to-end:
 *   - the `rescanState` itself,
 *   - the `userTriggeredProbe` gate that distinguishes header-driven
 *     probes from boot/periodic probes,
 *   - the `doneTimer` that auto-fades the done-state when there are no
 *     updates (and is held indefinitely when there are, so the "View"
 *     CTA stays put),
 *   - the `onUpstreamProbeComplete` subscription that advances the
 *     machine and routes rate-limit failures to a sticky-error toast.
 *
 * The hook also surfaces the rate-limit toast's "Sign in" CTA via the
 * `onRequestSignIn` callback so the caller can wire it to whatever
 * account-modal mechanism it owns.
 */
export function useRescanController({
  refresh,
  flashError,
  setRegistryFilters,
  setTabPersisted,
  onRequestSignIn,
}: Args): Result {
  const [state, setState] = useState<RescanState>({ phase: "idle" });
  const userTriggeredProbeRef = useRef(false);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    },
    [],
  );

  const onRefreshClick = useCallback(async () => {
    // Full sweep: rebuild the index (which lock-file-scans + persists +
    // fires the probe), then re-fetch the registry. The probe runs
    // async on the main side — we flip the button into "working" and
    // wait for the probe-complete event to advance to "done" (or back
    // to idle on rate-limit, where the sticky-error toast carries the
    // message).
    if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    userTriggeredProbeRef.current = true;
    setState({ phase: "working" });
    try {
      await window.skillsBank.rebuildIndex();
      await refresh();
    } catch {
      // rebuildIndex failures fall through; clear the working state
      // so the user can retry.
      userTriggeredProbeRef.current = false;
      setState({ phase: "idle" });
    }
  }, [refresh]);

  // Main process completes an upstream probe → re-fetch registry so
  // the new `skillUpdateAvailable` flags surface as card chips,
  // surface rate-limit failures as a sticky error toast, and advance
  // the user-triggered Rescan button's state machine (working → done
  // → idle, or working → idle on rate-limit).
  useEffect(() => {
    if (!window.skillsBank.onOriginProbeComplete) return;
    return window.skillsBank.onOriginProbeComplete((event) => {
      if (event.rateLimit) {
        const resetAt = new Date(event.rateLimit.resetAt);
        const resetText = resetAt.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        });
        const msg =
          `Upstream probe rate-limited (${event.rateLimit.limit}/hr` +
          `${event.rateLimit.unauthenticated ? ", unauthenticated" : ""}). ` +
          `Resets at ${resetText}.`;
        const action: ToastAction | undefined = event.rateLimit.unauthenticated
          ? { label: "Sign in", onClick: onRequestSignIn }
          : undefined;
        flashError(msg, {
          ...(action ? { action } : {}),
          diagnostic:
            `probe rate-limited\n` +
            `limit=${event.rateLimit.limit}/hr\n` +
            `remaining=${event.rateLimit.remaining}\n` +
            `resetsAt=${event.rateLimit.resetAt}\n` +
            `authenticated=${!event.rateLimit.unauthenticated}` +
            (event.failedRepos?.length
              ? `\nfailedRepos=${event.failedRepos.join(",")}`
              : ""),
        });
      }
      // Advance the Rescan button's state machine only when the user
      // started the probe via the header click. Boot probes and the
      // 6h periodic both fire this event too — letting them drive the
      // button would surprise the user with a "checking…" flash on
      // every launch.
      if (userTriggeredProbeRef.current) {
        userTriggeredProbeRef.current = false;
        if (event.rateLimit) {
          // Rate-limit toast carries the message; drop the button to
          // idle without a "done" flash so we don't claim success.
          setState({ phase: "idle" });
        } else {
          const updates = event.updates ?? 0;
          setState({ phase: "done", updates });
          if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
          // Updates>0 case: the button now hosts an actionable "View"
          // CTA. Don't auto-fade — the user dismisses it by clicking
          // View (which navigates and clears the state) or by
          // clicking Rescan again. Auto-fading here would yank the
          // affordance out from under a slow reader.
          if (updates === 0) {
            doneTimerRef.current = setTimeout(
              () => setState({ phase: "idle" }),
              1500,
            );
          }
        }
      }
      void refresh();
    });
  }, [refresh, flashError, onRequestSignIn]);

  // Rescan done-state "View" deep-link. Flip the Updates chip on,
  // bounce the user into Browse, scroll the grid to the top, then
  // clear the done badge. Owns the doneTimer too — a stale timer
  // left over from updates=0 transitions would otherwise pull the
  // rug while the user reads the filtered grid.
  const onViewUpdates = useCallback(() => {
    if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    setRegistryFilters(new Set<RegistryFilterTag>(["updates"]));
    setTabPersisted("browse");
    setState({ phase: "idle" });
    // Scroll the content scroll container to the top after React
    // commits the tab/filter change. Querying the DOM is fine here —
    // there's exactly one `.content` element in the layout.
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(".content");
      if (el) el.scrollTo({ top: 0, behavior: "smooth" });
    }, 0);
  }, [setRegistryFilters, setTabPersisted]);

  return { state, onRefreshClick, onViewUpdates };
}
