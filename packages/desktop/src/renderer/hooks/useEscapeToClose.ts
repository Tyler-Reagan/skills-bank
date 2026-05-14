import { useEffect } from "react";

const stack: Array<() => void> = [];
let listenerInstalled = false;

function ensureListener(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;
  // document-level, capture-phase: keystrokes from a focused child element
  // reach the document reliably and run before any bubble handler that
  // might stopPropagation.
  document.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const top = stack[stack.length - 1];
      if (!top) return;
      e.stopPropagation();
      e.preventDefault();
      top();
    },
    { capture: true },
  );
}

/**
 * Register an Escape-to-close handler for an open dialog. Only the
 * top-of-stack handler fires per keypress, so a modal on top of a drawer
 * closes itself first.
 *
 * Pass `enabled=false` when the dialog is mounted but not currently
 * visible — always-mounted closed dialogs would otherwise stack their
 * no-op handlers on top of the actually-open one and swallow the Esc.
 */
export function useEscapeToClose(
  onClose: () => void,
  enabled: boolean = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    ensureListener();
    stack.push(onClose);
    return () => {
      const i = stack.lastIndexOf(onClose);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [onClose, enabled]);
}
