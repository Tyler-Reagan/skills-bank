/**
 * Pure derivation over the tracking-history ledger (on/off periods).
 *
 * The ledger exists so usage stats can be read honestly: absence of
 * invocation events does NOT mean tracking was off (the user might just
 * not have used a skill), so gaps in observability can only be known
 * from explicit on/off transitions. This deriver turns the raw period
 * list into normalized windows + the off-gaps between them — the data a
 * future gap-respecting timeline view needs, and the minimal "tracked
 * since / currently off" indicator v1 shows.
 */

/** One on/off period as persisted in `tracking-history.json`. */
export interface TrackingPeriod {
  /** ISO-8601 when tracking was switched on. */
  enabledAt: string;
  /** ISO-8601 when switched off; null while still on. */
  disabledAt: string | null;
  /**
   * True when this boundary was inferred by the reconcile invariant
   * (the settings.json file diverged from the ledger, e.g. a hand-edit)
   * rather than recorded at the exact toggle moment.
   */
  approximate?: boolean;
}

/** A coalesced tracked window. `endAt: null` means still on. */
export interface CoverageWindow {
  startAt: string;
  endAt: string | null;
  approximate?: boolean;
}

/** An off-interval between two tracked windows. */
export interface CoverageGap {
  startAt: string;
  endAt: string;
}

export interface TrackingCoverage {
  /** Normalized, sorted, coalesced tracked windows. */
  windows: CoverageWindow[];
  /** Off-intervals between consecutive windows. */
  gaps: CoverageGap[];
  /** Earliest `enabledAt` across all windows; null when never tracked. */
  trackedSince: string | null;
  /** True when the latest window is still open. */
  currentlyOn: boolean;
}

/**
 * Derive coverage from a raw period list. Pure and clock-free: "currently
 * on" is whether the latest window is open, never a comparison against
 * now. Tolerates unsorted input, overlapping/adjacent windows (coalesced),
 * and a malformed period (skipped) — `enabledAt` must be a non-empty
 * string; a present `disabledAt` earlier than `enabledAt` is treated as
 * an instantaneous (already-closed) window.
 */
export function deriveCoverage(periods: TrackingPeriod[]): TrackingCoverage {
  const valid = periods
    .filter((p) => typeof p.enabledAt === "string" && p.enabledAt !== "")
    .slice()
    .sort((a, b) => a.enabledAt.localeCompare(b.enabledAt));

  const windows: CoverageWindow[] = [];
  for (const p of valid) {
    const cur: CoverageWindow = {
      startAt: p.enabledAt,
      endAt: p.disabledAt ?? null,
      ...(p.approximate ? { approximate: true } : {}),
    };
    const prev = windows[windows.length - 1];
    // Coalesce when the previous window is open (endAt null) or overlaps/
    // touches this one. An open previous window absorbs everything after it.
    if (prev) {
      if (prev.endAt === null || prev.endAt >= cur.startAt) {
        if (cur.endAt === null) {
          prev.endAt = null;
        } else if (prev.endAt !== null && cur.endAt > prev.endAt) {
          prev.endAt = cur.endAt;
        }
        if (cur.approximate) prev.approximate = true;
        continue;
      }
    }
    windows.push(cur);
  }

  const gaps: CoverageGap[] = [];
  for (let i = 1; i < windows.length; i++) {
    const prevEnd = windows[i - 1]!.endAt;
    // prevEnd is non-null here: an open window would have coalesced.
    if (prevEnd !== null) {
      gaps.push({ startAt: prevEnd, endAt: windows[i]!.startAt });
    }
  }

  return {
    windows,
    gaps,
    trackedSince: windows.length > 0 ? windows[0]!.startAt : null,
    currentlyOn:
      windows.length > 0 && windows[windows.length - 1]!.endAt === null,
  };
}
