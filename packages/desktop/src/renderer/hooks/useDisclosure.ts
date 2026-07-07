import { useCallback, useState } from "react";

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
