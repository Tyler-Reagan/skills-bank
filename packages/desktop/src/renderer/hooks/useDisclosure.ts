import { useCallback, useState } from "react";

interface Disclosure {
  open: boolean;
  toggle: () => void;
  close: () => void;
  setOpen: (open: boolean) => void;
}

/** Single boolean expand/collapse state with a stable toggle. */
export function useDisclosure(initial = false): Disclosure {
  const [open, setOpen] = useState(initial);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);
  return { open, toggle, close, setOpen };
}

interface DisclosureSet {
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
}

/** Independent expand/collapse state for a set of keyed rows. */
export function useDisclosureSet(): DisclosureSet {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((key: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const isOpen = useCallback((key: string) => open.has(key), [open]);
  return { isOpen, toggle };
}
