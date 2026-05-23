import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

/**
 * Tracks how many `<Modal>` instances are currently mounted. Every
 * `<Modal>` calls `useRegisterModal()` in its body, which increments
 * the count on mount and decrements on unmount; `useAnyModalOpen()`
 * reads the live count.
 *
 * Why two contexts: the registration callback must be stable across
 * renders (or `useRegisterModal`'s effect would re-fire and infinite-
 * loop register/unregister). Splitting the unstable count from the
 * stable callback keeps the API a single mount-and-forget hook for
 * the modal layer while still letting subscribers re-render as the
 * count changes.
 *
 * The hidden BrowserView for the Discover tab subscribes via
 * `useAnyModalOpen()` — when any modal is open, the embedded
 * skills.sh view yields. Before this, App.tsx had to maintain a
 * hand-curated OR-chain across every modal state variable; new
 * modals silently regressed the hide path until someone noticed
 * the WebContentsView painting over the new modal.
 */
const ModalRegisterContext = createContext<() => () => void>(() => () => {
  // No-op fallback for renderers without a provider (e.g. tests that
  // mount a single modal in isolation). Returns a no-op cleanup so
  // useEffect's contract is still satisfied.
});

const ModalCountContext = createContext<number>(0);

interface ProviderProps {
  children: React.ReactNode;
}

export function ModalRegistryProvider({
  children,
}: ProviderProps): React.ReactElement {
  const [count, setCount] = useState(0);

  // Stable across renders so useRegisterModal's effect dep doesn't
  // churn and create a register/unregister loop. The setState updater
  // form means we don't need `count` in the closure.
  const register = useCallback(() => {
    setCount((n) => n + 1);
    return () => setCount((n) => n - 1);
  }, []);

  return (
    <ModalRegisterContext.Provider value={register}>
      <ModalCountContext.Provider value={count}>
        {children}
      </ModalCountContext.Provider>
    </ModalRegisterContext.Provider>
  );
}

/**
 * Register this modal with the open-modal count for the lifetime of
 * the calling component. `<Modal>` calls this internally; callers
 * that hand-roll their own modal chrome (e.g. SkillDetailDrawer's
 * slide-in drawer) can call it directly to participate in the
 * BrowserView-hide flow without adopting `<Modal>`.
 */
export function useRegisterModal(): void {
  const register = useContext(ModalRegisterContext);
  useEffect(() => register(), [register]);
}

export function useAnyModalOpen(): boolean {
  return useContext(ModalCountContext) > 0;
}
