import { useEffect } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
  "details > summary",
].join(",");

/**
 * Trap Tab focus inside `containerRef`. Tab from the last focusable
 * element wraps to the first; Shift+Tab from the first wraps to the
 * last. Elements that are visually hidden (`display: none`,
 * `visibility: hidden`) are skipped.
 *
 * Cooperates with the existing `useEscapeToClose` LIFO stack — focus
 * lives inside the topmost dialog, so the trap doesn't need its own
 * stack discipline.
 *
 * Pass `enabled=false` when the dialog is mounted but not currently
 * visible to avoid trapping focus into an offscreen container.
 */
export function useFocusTrap<T extends HTMLElement>(
  containerRef: React.RefObject<T | null>,
  enabled: boolean = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const root = containerRef.current;
    if (!root) return;

    function getFocusable(): HTMLElement[] {
      if (!root) return [];
      const nodes = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      return nodes.filter((n) => {
        if (n.hasAttribute("disabled")) return false;
        if (n.getAttribute("aria-hidden") === "true") return false;
        const style = window.getComputedStyle(n);
        if (style.display === "none" || style.visibility === "hidden") {
          return false;
        }
        return true;
      });
    }

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        // Nothing to focus — keep focus on the container itself.
        e.preventDefault();
        root?.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (active === first || active === root || !root?.contains(active)) {
          e.preventDefault();
          // Nested dialogs: inner trap stops bubble so the parent trap
          // doesn't also re-focus its own first/last on the same Tab.
          e.stopPropagation();
          last.focus({ preventScroll: true });
        }
      } else {
        if (active === last || !root?.contains(active)) {
          e.preventDefault();
          e.stopPropagation();
          first.focus({ preventScroll: true });
        }
      }
    }

    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [containerRef, enabled]);
}
