import { useEffect, useRef } from "react";

/**
 * Capture the element that had focus when this hook mounts (i.e. when the
 * modal or drawer opened) and restore focus to it on unmount. Behaves
 * gracefully if the element is no longer in the DOM.
 */
export function useFocusReturn(): void {
  const originRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    originRef.current = (document.activeElement as HTMLElement) ?? null;
    return () => {
      const target = originRef.current;
      if (target && document.contains(target)) {
        try {
          target.focus({ preventScroll: true });
        } catch {
          // ignore
        }
      }
    };
  }, []);
}

/**
 * Move focus to the first focusable element inside `container` once it
 * mounts. Combined with useFocusReturn, this gives a minimal but
 * functional modal-focus loop without a full focus-trap dependency.
 */
export function useInitialFocus<T extends HTMLElement>(
  containerRef: React.RefObject<T | null>,
): void {
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    // Focus the container itself first so keydown events bubble from
    // a known location and the capture-phase Escape handler in
    // useEscapeToClose has a focused element to attribute the event
    // to. The container must carry tabIndex=-1 to accept programmatic
    // focus without becoming tab-navigable. After the container is
    // focused, move focus to the first focusable child so Tab works
    // naturally — but skip that step if no focusable child exists.
    try {
      root.focus({ preventScroll: true });
    } catch {
      // ignore
    }
    const focusable = root.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable) {
      try {
        focusable.focus({ preventScroll: true });
      } catch {
        // ignore
      }
    }
  }, [containerRef]);
}
