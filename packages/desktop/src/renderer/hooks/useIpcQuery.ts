import { useCallback, useEffect, useState, type DependencyList } from "react";

interface UseIpcQueryOptions<T> {
  /**
   * When false, skip the fetch and reset `data` to `initialData`.
   * Toggling false→true triggers a fresh fetch; true→false cancels
   * an in-flight one. Replaces the early-return-in-effect pattern
   * (`if (!enabled) return;`) used by call sites that guard on
   * derived inputs (e.g. `!upstreamRepo`, `!showOriginActivity`).
   */
  enabled?: boolean;
  /**
   * Value used for `data` before the first successful fetch and
   * during any dep-driven refetch. Defaults to `null`. The default
   * matches the existing renderer pattern of `setX(null)` at the top
   * of the effect — callers that want stale-while-revalidate behavior
   * shouldn't use this hook (or pass the prior value explicitly).
   */
  initialData?: T | null;
  /**
   * Called once per fetch failure (after the cancellation guard). The
   * hook always populates `error` regardless; this is for side effects
   * like toast-on-failure.
   */
  onError?: (err: Error) => void;
}

interface UseIpcQueryResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  /**
   * Manually re-run the fetch — e.g. after a mutation IPC that
   * changes the underlying data. Uses a bump-counter under the hood
   * so callers don't have to thread an artificial dep.
   */
  refetch: () => void;
}

/**
 * Wraps the cancellation-aware `useEffect → window.skillsBank.foo() →
 * setState → catch` boilerplate that appears across SkillDetailDrawer,
 * PublishSection, RepoPickerModal, and several App.tsx loaders. Each
 * inlined version was 10–15 lines of identical shape with subtle
 * differences (some forgot the cancellation guard, some swallowed
 * errors silently, some reset state on dep change and some didn't).
 *
 * Behavior:
 *   - Re-fires when any entry in `deps` changes (or `enabled` flips).
 *   - Cancels in-flight fetches on dep change / unmount via a guard
 *     captured in the effect closure — late resolutions are dropped.
 *   - Resets `data` to `initialData` before each new fetch so a
 *     dep-driven refetch doesn't briefly render stale data alongside
 *     `loading: true`. Matches the explicit `setX(null)` pattern
 *     callers were doing by hand.
 *   - Surfaces errors through `error` AND the optional `onError`
 *     callback. Errors don't auto-clear; the next successful fetch
 *     resets them.
 */
export function useIpcQuery<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList,
  opts: UseIpcQueryOptions<T> = {},
): UseIpcQueryResult<T> {
  const { enabled = true, initialData = null, onError } = opts;
  const [data, setData] = useState<T | null>(initialData);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<Error | null>(null);
  const [refetchBump, setRefetchBump] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setData(initialData);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setData(initialData);
    setLoading(true);
    setError(null);
    fetcher()
      .then((value) => {
        if (cancelled) return;
        setData(value);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setLoading(false);
        onError?.(e);
      });
    return () => {
      cancelled = true;
    };
    // The caller-supplied `deps` array is the effect's actual dependency
    // contract. `fetcher`, `initialData`, and `onError` are closure-captured
    // and refreshed on every render — listing them would re-fire the effect
    // on every render (since arrow-fn props get a new identity each time),
    // defeating the abstraction. Standard pattern for query-style hooks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, refetchBump]);

  const refetch = useCallback(() => {
    setRefetchBump((n) => n + 1);
  }, []);

  return { data, loading, error, refetch };
}
