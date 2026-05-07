import { useEffect } from "react";

// LIFO stack of "close me" handlers, one per open dialog/drawer/modal.
// A single capture-phase Escape listener fires only the topmost handler
// so a nested modal closes itself without also closing the drawer
// underneath.
const stack: Array<() => void> = [];
let listenerInstalled = false;

function ensureListener(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;
  window.addEventListener(
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
 * top-of-stack handler fires per keypress, so opening a modal on top
 * of a drawer keeps the drawer open until the modal is dismissed.
 */
export function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    ensureListener();
    stack.push(onClose);
    return () => {
      const i = stack.lastIndexOf(onClose);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [onClose]);
}
