# Bank-mode persistence — origin-unreachable recovery (planned, v1.4)

Phase 3 of the post-v1.0 roadmap. Single PR against
`Tyler-Reagan/skills-bank`.

## What changed since the original plan

This file previously specified a per-skill `bankSnapshot` cache
under `<registryRoot>/.skills-bank/cache/<package>/<version>/`, an
"npx skills add" install path, and a separate BankCacheModal for
managing snapshots. **That design was retired during the v1.2 Phase
1 grill** (see `docs/plans/curation-layer-reset.md` section 9,
Flagged section).

The retirement was correct. The product promise — "your installed
skills survive upstream loss" — turned out to be met already by the
v1.2 architecture, with no separate cache layer needed:

- Skills live at `<registryRoot>/skills/{personal,vendored}/<name>/`.
  The local copy *is* the user's authoritative content.
- The `origin` pointer (renamed from `upstream` in v1.3) is a
  re-fetch hint, not a content source. Origin loss doesn't delete
  local content; it just means future Updates will fail.
- The v1.2 manifest export/import + `userData` auto-snapshots cover
  the registry-metadata side of persistence.
- v1.5 (in-app-publish) safekeeping covers the remote-pinned-backup
  side via push-to-linked-repo.

What v1.2 did not ship is the **recovery UX** when an origin probe
persistently fails. Today, repeated probe failures surface as a
sticky rate-limit/error toast and the skill stays in
`origin-update-available: undefined` / `drift: undefined` limbo. The
user has no in-app surface that says "your local copy is intact;
drop the origin pointer and stop checking" — they'd have to
manually invoke `unlinkOrigin` via the drawer's heal flow (which
itself is only reachable when there's drift or an update marker, not
on persistent unreachable).

Phase 3 lands that recovery surface and the probe-failure tracking
it depends on. Nothing else.

## Depends on

- v1.3.0 shipped. The `unlinkOrigin` rename + `origin` wire-field
  rename are already on `main`. This plan composes both.
- No hard deps on Phase 4+.

## Goals

1. The desktop runner's origin-probe pass tracks consecutive
   failures per skill, persisted across sessions, with a tolerant
   reset on success.
2. After a configurable threshold of consecutive failures, the
   skill enters a new drawer state `origin-unreachable`.
3. The drawer surfaces a recovery banner: _"This skill's origin is
   no longer reachable. Your local copy is intact."_ Two actions:
   **Keep this skill (unlink origin)** and **Retry probe**.
4. The probe-failure counter persists in the existing runtime
   sidecar `.skills-bank-runtime.json` (ADR-0002) — it's runtime
   state by definition (never committed). Auto-resets when a
   probe succeeds.
5. Phase 4 (`in-app-install-from-discover`) inherits the same
   probe-failure handling for skills installed via Discover.

## Non-goals

- **Per-skill content cache** (`bankSnapshot`, `.skills-bank/cache/`).
  Retired in v1.2 grill. Local content under `skills/*/<name>/` *is*
  the cache; a parallel cache layer would be redundant.
- **`npx skills add` integration.** The v1.2 discovery-mount + the
  `mirrorSkillFolder` primitive replaced this paradigm. Phase 4
  will use `mirrorSkillFolder` directly for in-app install from a
  GitHub origin.
- **Cache management modal.** Without a parallel cache layer,
  there's nothing to manage. The drawer's per-skill recovery is the
  only surface.
- **Export/import cache.** The v1.2 manifest already covers
  metadata; content is re-mirrored from origin on import (or
  preserved if the user is on the same machine).
- **Sync's origin-unreachable handling.** Sync (curated-set pull)
  is a different code path; its unreachable case is "Refresh
  failed; try again" at the registry level, not per-skill. Out of
  scope.

## Scope

### 1. Probe-failure counter in runtime sidecar

`.skills-bank-runtime.json` is the gitignored runtime sidecar (ADR-0002).
Currently carries `fetchedAt`. Add a `probeFailureCount: number`
field; increments on each consecutive failure; resets to 0 on
success.

```ts
// packages/core/src/heal.ts (RuntimeState extension)
export interface RuntimeState {
  fetchedAt?: string;
  /**
   * Consecutive failed origin probes for this skill. Reset to 0
   * on the next successful probe. Drives the
   * `origin-unreachable` drawer state at threshold.
   */
  probeFailureCount?: number;
  /** Last failure's timestamp. Diagnostic; not load-bearing. */
  lastProbeFailureAt?: string;
}
```

`readRuntimeState` / `writeRuntimeState` round-trip the new fields.
Backward-compatible: missing fields default to 0 / undefined.

### 2. Probe-runner increments + resets the counter

`packages/core/src/upstream-probe.ts` already runs per-skill probes
via the desktop runner. Two hook points:

- **On probe success** (current hash captured, no error): write
  `probeFailureCount: 0` if it was previously non-zero. No-op if
  already zero — avoid unnecessary sidecar writes.
- **On probe failure** (network error, 404, rate-limit, anything
  that didn't produce a usable hash): increment
  `probeFailureCount` and stamp `lastProbeFailureAt`. Bound by
  threshold-saturation logic (if already at 99, don't keep
  incrementing — UI doesn't need the precise value above the
  threshold).

Rate-limit failures (429) are a special case: they don't reflect
"origin gone," they reflect "we hit the ceiling." Do NOT increment
the counter on 429. The existing sticky-error toast already handles
that case.

### 3. `origin-unreachable` drawer state

`packages/core/src/skill-state.ts` adds:

```ts
export type DrawerState =
  | ...existing...
  | "origin-unreachable";  // NEW
```

Trigger condition: `entry.source.origin?.kind === "github"` AND
`entry.runtime?.probeFailureCount >= ORIGIN_UNREACHABLE_THRESHOLD`.

Threshold constant lives in `skill-state.ts` (so it's pure data
the classifier owns):

```ts
export const ORIGIN_UNREACHABLE_THRESHOLD = 3 as const;
```

3 consecutive failures matches the probe cadence (every 6h by
default in the desktop runner; user-triggered probes count too).
That's ~18 hours of real-world unreachability before the state
surfaces — long enough to ride out transient outages, short enough
to be useful.

The state takes priority over `origin-update-available` (the user
can't update what we can't reach), but yields to the existing drift
states (drift means we have a baseline hash to compare against, so
the origin was reachable at least once recently).

### 4. Drawer recovery banner + actions

`packages/desktop/src/renderer/components/SkillDetailDrawer.tsx`
adds an `origin-unreachable` banner rendered above the action set.
Wording:

> ⚠️ **This skill's origin is no longer reachable.** Your local
> copy is intact. Updates from `<owner/repo>` will keep failing
> until the origin is restored.
>
> [Keep this skill]  [Retry probe]

- **Keep this skill** routes through the existing IPC
  `IPC.acceptDrift` → which dispatches to `unlinkOrigin` for
  skills with an origin pointer (v1.3 wired this already). The
  origin pointer clears; the skill's `source` stays unchanged
  (it remains `curated` or `user`, whichever it was).
- **Retry probe** fires a one-shot probe against just this skill's
  origin. On success, `probeFailureCount` resets and the banner
  disappears. On failure, the counter increments (which can saturate
  at the threshold; doesn't worsen the displayed state).

A SkillCard chip (`UNREACHABLE`, danger color) surfaces the state at
list level. Lower priority than `MISSING`; higher than `EDITED`.

### 5. RegistryEntry surface

`packages/core/src/types.ts`:

```ts
export interface RegistryEntry extends SkillMeta {
  ...
  /**
   * Derived from the runtime sidecar's probeFailureCount field.
   * True when the count meets or exceeds ORIGIN_UNREACHABLE_THRESHOLD.
   * Only meaningful for skills with origin.kind === "github".
   */
  originUnreachable?: boolean;
}
```

`buildRegistryIndex` populates this from the runtime sidecar in the
same pass that already merges `fetchedAt`. No new file reads.

### 6. IPC

`IPC.retryOriginProbe(name: string)` — one-shot probe against a
single skill's origin. Returns success/failure. Wired into the
drawer's Retry button.

No new IPC for Keep this skill — reuses the existing
`IPC.acceptDrift` since the `unlinkOrigin` dispatch is already
correctly gated by `entry.source.origin?.kind === "github"` in
main.ts (v1.3's Pass 3 work).

### 7. Tests

New `packages/core/src/upstream-probe.test.ts` extension:

- Probe success after a streak of failures resets the counter to 0.
- Probe failure increments the counter; rate-limit (429) does not.
- Counter saturates at the threshold (no unbounded growth).

`packages/core/src/skill-state.test.ts`:

- Entry with `runtime.probeFailureCount >= ORIGIN_UNREACHABLE_THRESHOLD`
  classifies as `origin-unreachable`.
- Entry with the same count but `origin.kind: "none"` does NOT
  classify as unreachable — the state requires a github origin.
- `origin-unreachable` takes priority over `origin-update-available`
  but yields to `edited-with-origin`.

## Migration story

`probeFailureCount` is new; missing fields read as 0. No migration
needed. The runtime sidecar is gitignored, so no committed-marker
churn either.

## Consequences

- **For end users:** still none at this point (no external users).
- **For the maintainer:** when a vendored skill's origin disappears
  (the 62 displaced vendored skills are exactly this case once
  re-installed via Phase 4 against their original repos), the
  recovery flow becomes one click rather than manual sidecar
  surgery.
- **For Phase 4 (`in-app-install-from-discover`):** the same
  drawer state covers Discover-installed skills out of the box.
  Phase 4 doesn't need to ship parallel probe-failure handling.
- **For Phase 5 (`in-app-publish`):** safekeeping remains a
  separate, complementary path. A safekept skill whose origin
  becomes unreachable still surfaces `origin-unreachable`; the
  user can Keep this skill and the safekept copy at the linked
  repo stays intact (safekeeping doesn't depend on origin).
- **For ADR-0002:** the runtime sidecar grows two new fields. The
  ADR's "runtime stays gitignored" invariant is preserved; no
  amendment needed.

## Re-opening this decision

- **If the 3-failure threshold turns out wrong** (false positives
  from regional GitHub outages; missed legitimate origin losses),
  it's a constant in `skill-state.ts`. A one-line PR adjusts it;
  consider exposing as a Setting if telemetry surfaces a need.
- **If users want to retain the original "cache layer" semantics**
  for some workflow reason (offline installs, air-gapped use), the
  bankSnapshot design can be revived as a separate plan. v1.4 ships
  the recovery UX first; cache layer is reactive, not proactive.
- **If origin loss turns out to be common enough that one-click
  Keep is too friction-heavy**, the threshold-trigger + auto-unlink
  flow could be optional. Default would still be one-click for
  audit transparency; the auto path would just be a Setting.
