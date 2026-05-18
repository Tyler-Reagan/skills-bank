import { useEffect, useState } from "react";

/**
 * Tracks the `prefers-reduced-motion: reduce` media query. Returns
 * `true` when the user has opted into reduced motion at the OS level.
 *
 * Use to skip motion-conditional logic that the global CSS reset can't
 * catch (e.g. JS-driven inline `animationDelay` style values that still
 * tick even when CSS-level `animation-duration` is zeroed).
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return reduced;
}
