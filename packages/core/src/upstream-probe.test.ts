import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createOriginProbeRunner,
  recordProbeFailure,
  recordProbeSuccess,
  type ProbeCompleteEvent,
} from "./upstream-probe.js";
import { readRuntimeState } from "./heal.js";
import { ORIGIN_UNREACHABLE_THRESHOLD } from "./skill-state.js";

/**
 * Phase 3 contract: probe-failure counter behavior. Pins the
 * post-v1.4 expectations:
 *
 *   - Failures increment the counter and stamp a timestamp.
 *   - Success resets the counter and clears the timestamp.
 *   - Counter saturates at ORIGIN_UNREACHABLE_THRESHOLD (no
 *     unbounded growth; no needless sidecar writes once unreachable
 *     state is reached).
 *   - Success on a zero counter is a no-op (no sidecar write).
 *
 * Driven directly through the exported helpers; the probe loop's
 * runOnce orchestration is exercised at integration time, not here.
 */

let scratch: string;
let skillPath: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bank-probe-"));
  // Match the layout buildRegistryIndex emits: skills/<bucket>/<name>/.
  fs.mkdirSync(path.join(scratch, "skills", "vendored", "alpha"), {
    recursive: true,
  });
  skillPath = "skills/vendored/alpha";
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function read(): ReturnType<typeof readRuntimeState> {
  return readRuntimeState(path.join(scratch, skillPath));
}

describe("recordProbeFailure / recordProbeSuccess", () => {
  test("first failure increments to 1 and stamps lastProbeFailureAt", () => {
    recordProbeFailure(scratch, { path: skillPath });
    const r = read();
    expect(r.probeFailureCount).toBe(1);
    expect(typeof r.lastProbeFailureAt).toBe("string");
  });

  test("each subsequent failure increments by 1", () => {
    recordProbeFailure(scratch, { path: skillPath });
    recordProbeFailure(scratch, { path: skillPath });
    expect(read().probeFailureCount).toBe(2);
  });

  test("counter saturates at ORIGIN_UNREACHABLE_THRESHOLD", () => {
    for (let i = 0; i < ORIGIN_UNREACHABLE_THRESHOLD + 5; i++) {
      recordProbeFailure(scratch, { path: skillPath });
    }
    expect(read().probeFailureCount).toBe(ORIGIN_UNREACHABLE_THRESHOLD);
  });

  test("success after failures resets counter + clears timestamp", () => {
    recordProbeFailure(scratch, { path: skillPath });
    recordProbeFailure(scratch, { path: skillPath });
    expect(read().probeFailureCount).toBe(2);

    recordProbeSuccess(scratch, { path: skillPath });
    const r = read();
    expect(r.probeFailureCount).toBeUndefined();
    expect(r.lastProbeFailureAt).toBeUndefined();
  });

  test("success on a zero counter does not write to disk", () => {
    // No prior failures — no sidecar should exist.
    const sidecar = path.join(scratch, skillPath, ".skills-bank-runtime.json");
    expect(fs.existsSync(sidecar)).toBe(false);

    recordProbeSuccess(scratch, { path: skillPath });
    expect(fs.existsSync(sidecar)).toBe(false);
  });

  test("fetchedAt preserved across failure increments", () => {
    // Pre-stamp a fetchedAt as the probe-success path would have.
    fs.writeFileSync(
      path.join(scratch, skillPath, ".skills-bank-runtime.json"),
      JSON.stringify({ fetchedAt: "2026-05-20T00:00:00Z" }),
    );
    recordProbeFailure(scratch, { path: skillPath });
    const r = read();
    expect(r.fetchedAt).toBe("2026-05-20T00:00:00Z");
    expect(r.probeFailureCount).toBe(1);
  });
});

describe("runOnce — completion-event invariants", () => {
  test("emits onComplete on the zero-candidates early-return path", async () => {
    // A registry whose skills have no baselined github origin produces
    // a zero-candidates filter result. Pre-fix this returned without
    // firing onComplete, leaving the renderer's Rescan state machine
    // stuck in `working`. Verify the empty-payload completion fires.
    const events: ProbeCompleteEvent[] = [];
    const runner = createOriginProbeRunner({
      registryRoot: () => scratch,
      token: () => null,
      onComplete: (event) => {
        events.push(event);
      },
    });

    const result = await runner.run();

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({});
    expect(result.probed).toBe(0);
    expect(result.updates).toBe(0);
  });
});
