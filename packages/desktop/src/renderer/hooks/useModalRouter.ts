import { useCallback, useState } from "react";

export interface ModalRouter<M> {
  /** The currently open modal, or null when none is open. */
  modal: M | null;
  /** Open a modal, replacing any currently open one. */
  openModal: (modal: M) => void;
  /** Close whatever modal is open. */
  closeModal: () => void;
}

/**
 * Single-slot modal state: at most one modal open at a time, modeled as
 * a discriminated union the caller supplies. Opening a new one replaces
 * the previous (modals swap, they don't stack), which makes
 * "two modals open at once" unrepresentable.
 *
 * Surfaces that genuinely overlay a modal (a drawer, a system-triggered
 * resolver) keep their own state rather than joining the union.
 */
export function useModalRouter<M>(): ModalRouter<M> {
  const [modal, setModal] = useState<M | null>(null);
  const openModal = useCallback((next: M) => setModal(next), []);
  const closeModal = useCallback(() => setModal(null), []);
  return { modal, openModal, closeModal };
}
