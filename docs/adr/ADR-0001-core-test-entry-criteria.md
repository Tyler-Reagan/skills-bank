# ADR-0001 — Test entry criteria for `packages/core`

**Status:** Accepted (v0.11.7)

## Context

Before v0.11.7, `packages/core` had zero `.test.ts` files. The v0.11.4
architecture audit (`docs/audits/v0.11.4-architecture.md`) flagged this
as the single biggest risk to v0.11.8+ refactor work: the security
hardening (v0.11.8) and the core consolidation (v0.11.9) both involve
moving load-bearing primitives across module boundaries, and a green
typecheck alone doesn't prove the byte-equality invariants in
`hashSkillFolder`, the conflict-resolution branches in
`applyCanonicalSync` / `mergeImportRegistry`, or the partial-failure
no-mutation contract in `mirrorSkillFolder`.

We need a test foundation that gates the high-stakes contracts without
trying to test every primitive. "Test everything" produces a brittle
suite no one runs.

## Decision

Five suites — and only these five — constitute the v0.11.7 test
foundation:

1. **`hashSkillFolder`** — byte-equal hashing, the `HASH_BYTE_BUDGET`
   8 MB null fallback, symlink hashing of link content (not realpath),
   and the two sidecar exclusions (`.skills-bank.json`,
   `.skills-bank-hash`).
2. **`applyCanonicalSync`** — all five conflict-resolution branches
   (no-collision upsert; bundled→bundled overwrite; `keep-mine`;
   `use-canonical`; `rename-mine`) plus the meta.json tag-preservation
   splice.
3. **`mergeImportRegistry`** — same conflict surface as Sync, plus the
   divergent `source: yours` stamping and canon-cache invalidation.
   Pins where Sync and Merge differ so a future consolidation (v0.11.9
   territory) can't silently regress one into the other.
4. **`mirrorSkillFolder`** — partial-failure invariant. Simulate one
   failing blob fetch (last-blob-fails is the worst case); assert no
   disk mutation. The entire safety story of the direct-fetch Update
   path rests here.
5. **`classifyDrawerState`** — table-driven coverage of every
   `DrawerState` × `PrimaryAction` × capability triple. Drawer
   regressions are the cheapest UX bugs to ship; the table is the
   defense.

The "and only these five" pin applies to **the v0.11.7 foundation**.
Post-v1.0 primitives may extend the foundation per their own ADR —
see ADR-0006 (`forkSkill`, Suite 6) and ADR-0007 (`pushSkillFolder`,
Suite 7) for the precedent. Each extension names a specific
contract (atomicity, partial-failure, error vocabulary) the new
suite exists to pin; future additions follow the same pattern.

**Explicitly out of scope** for v0.11.7:

- IPC handlers (`packages/desktop`) — tested at the integration
  boundary in v0.11.8 (security pass).
- Trivial pass-throughs (`fromCaught`, `makeAppError`, etc.) — they
  shape errors, they don't decide outcomes.
- The CLI surface (`packages/cli`) — `cli-minimal` plan deprecates
  most of it; tests would be churn.
- Any UI rendering test — covered by manual smoke tests on each
  release branch.

Future architecture reviews that recommend "add tests" must name a
*specific* contract not already covered above, with a stated invariant
that would be broken by a plausible refactor. Generic coverage targets
are explicitly rejected as actionable.

## Consequences

- v0.11.8 (security) refactors IPC handlers with confidence that the
  core primitives they call still hold.
- v0.11.9 (core architecture refactor) consolidates `SkillRecord`,
  extracts the probe scheduler, and unifies Sync + Merge. Without the
  Suite-2 and Suite-3 surface pinned, that work would be uncomfortable.
- The maintainer accepts an ongoing tax: any new high-stakes contract
  surfaces *must* land with a suite. The bar is "would a refactor that
  looks innocuous break this without us noticing." If yes, it gets a
  suite; if no, it doesn't.
