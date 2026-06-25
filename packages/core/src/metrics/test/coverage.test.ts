import { describe, expect, test } from "vitest";
import { deriveCoverage, type TrackingPeriod } from "../coverage.js";

describe("deriveCoverage", () => {
  test("no periods → empty, never tracked, off", () => {
    const c = deriveCoverage([]);
    expect(c.windows).toEqual([]);
    expect(c.gaps).toEqual([]);
    expect(c.trackedSince).toBeNull();
    expect(c.currentlyOn).toBe(false);
  });

  test("single open period → on, no gaps, trackedSince = start", () => {
    const c = deriveCoverage([
      { enabledAt: "2026-01-01T00:00:00Z", disabledAt: null },
    ]);
    expect(c.currentlyOn).toBe(true);
    expect(c.trackedSince).toBe("2026-01-01T00:00:00Z");
    expect(c.windows).toEqual([
      { startAt: "2026-01-01T00:00:00Z", endAt: null },
    ]);
    expect(c.gaps).toEqual([]);
  });

  test("two disjoint periods → one gap between them", () => {
    const periods: TrackingPeriod[] = [
      { enabledAt: "2026-01-01T00:00:00Z", disabledAt: "2026-02-01T00:00:00Z" },
      { enabledAt: "2026-03-01T00:00:00Z", disabledAt: null },
    ];
    const c = deriveCoverage(periods);
    expect(c.windows).toHaveLength(2);
    expect(c.gaps).toEqual([
      { startAt: "2026-02-01T00:00:00Z", endAt: "2026-03-01T00:00:00Z" },
    ]);
    expect(c.currentlyOn).toBe(true);
    expect(c.trackedSince).toBe("2026-01-01T00:00:00Z");
  });

  test("unsorted input is ordered before deriving", () => {
    const c = deriveCoverage([
      { enabledAt: "2026-03-01T00:00:00Z", disabledAt: null },
      { enabledAt: "2026-01-01T00:00:00Z", disabledAt: "2026-02-01T00:00:00Z" },
    ]);
    expect(c.trackedSince).toBe("2026-01-01T00:00:00Z");
    expect(c.windows[0]!.startAt).toBe("2026-01-01T00:00:00Z");
  });

  test("overlapping/adjacent windows coalesce into one (no spurious gap)", () => {
    const c = deriveCoverage([
      { enabledAt: "2026-01-01T00:00:00Z", disabledAt: "2026-01-10T00:00:00Z" },
      { enabledAt: "2026-01-05T00:00:00Z", disabledAt: "2026-01-20T00:00:00Z" },
    ]);
    expect(c.windows).toEqual([
      { startAt: "2026-01-01T00:00:00Z", endAt: "2026-01-20T00:00:00Z" },
    ]);
    expect(c.gaps).toEqual([]);
  });

  test("an open window absorbs a later period and leaves no gap", () => {
    const c = deriveCoverage([
      { enabledAt: "2026-01-01T00:00:00Z", disabledAt: null },
      { enabledAt: "2026-02-01T00:00:00Z", disabledAt: "2026-03-01T00:00:00Z" },
    ]);
    expect(c.windows).toEqual([
      { startAt: "2026-01-01T00:00:00Z", endAt: null },
    ]);
    expect(c.gaps).toEqual([]);
    expect(c.currentlyOn).toBe(true);
  });

  test("approximate boundary propagates to its coalesced window", () => {
    const c = deriveCoverage([
      {
        enabledAt: "2026-01-01T00:00:00Z",
        disabledAt: "2026-01-10T00:00:00Z",
        approximate: true,
      },
    ]);
    expect(c.windows[0]!.approximate).toBe(true);
  });

  test("skips malformed periods (no enabledAt)", () => {
    const c = deriveCoverage([
      { enabledAt: "", disabledAt: null },
      { enabledAt: "2026-01-01T00:00:00Z", disabledAt: null },
    ]);
    expect(c.windows).toHaveLength(1);
    expect(c.trackedSince).toBe("2026-01-01T00:00:00Z");
  });
});
