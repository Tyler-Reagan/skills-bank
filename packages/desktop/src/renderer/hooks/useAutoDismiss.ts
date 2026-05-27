import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion.js";

interface Options {
  /** Whether the dismiss timer should run at all. */
  active: boolean;
  /** External pause (e.g. a detail panel is open). */
  paused?: boolean;
  /**
   * Identifies the current dismissible instance. Changing it clears the
   * leaving/hover state so a freshly-shown surface gets a full timer.
   */
  resetKey?: string | null;
  onDismiss: () => void;
  delayMs: number;
  /** Opacity-fade window before onDismiss fires. Must match the CSS. */
  fadeMs: number;
}

interface HoverHandlers {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocusCapture: () => void;
  onBlurCapture: () => void;
}

interface Result {
  /** True once the fade has started — drive the exit transition with it. */
  leaving: boolean;
  /** Spread onto the surface to pause the timer while hovered/focused. */
  hoverHandlers: HoverHandlers;
}

/**
 * Self-dismiss timer for a transient surface (e.g. a success banner).
 * Once `active`, waits `delayMs`, then sets `leaving` for `fadeMs` and
 * calls `onDismiss` — or dismisses immediately under reduced motion. The
 * timer pauses while the pointer or focus is inside the surface (via the
 * returned handlers) or while `paused` is true.
 */
export function useAutoDismiss({
  active,
  paused = false,
  resetKey = null,
  onDismiss,
  delayMs,
  fadeMs,
}: Options): Result {
  const reducedMotion = useReducedMotion();
  const [leaving, setLeaving] = useState(false);
  const [hovered, setHovered] = useState(false);

  // onDismiss is typically an inline arrow, so ref it to keep the timer
  // effect from restarting on every parent re-render.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    setLeaving(false);
    setHovered(false);
  }, [resetKey]);

  useEffect(() => {
    if (!active || paused || hovered) return;
    const timer = window.setTimeout(() => {
      if (reducedMotion) {
        onDismissRef.current();
      } else {
        setLeaving(true);
        window.setTimeout(() => onDismissRef.current(), fadeMs);
      }
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [active, paused, hovered, resetKey, reducedMotion, delayMs, fadeMs]);

  const hoverHandlers: HoverHandlers = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onFocusCapture: () => setHovered(true),
    onBlurCapture: () => setHovered(false),
  };

  return { leaving, hoverHandlers };
}
