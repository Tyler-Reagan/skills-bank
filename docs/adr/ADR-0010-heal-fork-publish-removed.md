# ADR-0010 — Heal / fork / publish surface removed

**Status:** Accepted (v1.22.0)

## Context

Three features were added in v0.11.12 under a "publish your edits upstream"
model: `forkSkill` (edit a curated/vendored skill locally), `pushSkillFolder`
(push a fork back as a GitHub PR), and a dual-mode publish-state classifier
that tracked whether a local skill had drifted from its upstream and whether a
push was in flight. These were specified in ADR-0006, ADR-0007, and ADR-0008.

By v1.22.0 the surface had several irreconcilable problems:

1. **Source-axis conflict.** The new `source` axis (`curated / user / vendored`)
   treats provenance as sticky acquisition-time state. Fork flipped `source`
   from `curated` to `user` — making provenance mutable, which contradicts the
   axis's core invariant.

2. **Origin-paradigm mismatch.** The v1.x origin model records where a skill
   came from (its authoritative GitHub location). Fork detached the origin and
   treated the user's linked repo as the new upstream, which conflates editing
   with re-publishing and breaks drift detection.

3. **Heal surface entanglement.** `keepLocalDetach`, `unlinkOrigin`,
   `flipSourceToUser`, and `rebaselineHash` were heal actions built around the
   fork/publish lifecycle. Without fork/publish, these actions had no coherent
   home and were never clearly exposed in the UI.

4. **Net code weight vs value.** The feature added ~3,847 lines but generated
   consistent user confusion: the difference between "fork," "detach origin,"
   and "adopt into linked repo" was not clear, and the publish-state classifier
   fired for skills that had no meaningful upstream relationship.

## Decision

Remove the entire fork/publish/heal surface:

- Core: `fork.ts`, `publish-classify.ts`, `publish-state.ts`, their tests.
- IPC: all associated `ipcMain.handle` handlers, preload exports, channel
  constants, and interface methods (`canAcceptDrift`, `canTakeCanonical`,
  `canResetToOrigin`).
- Heal actions: `keepLocalDetach`, `unlinkOrigin`, `flipSourceToUser`,
  `rebaselineHash`.
- UI: `PublishSection.tsx`, the drift badge on `SkillCard`.
- Docs: CLI page, Publish/Fork/Safekeeping sections, the heal-drift guide arm.

ADR-0006, ADR-0007, and ADR-0008 are stamped Superseded by this ADR.

The concept is intentionally cleared rather than revised — if an upstream-
contribution story is built later it should start from the current source-axis
and origin-paradigm semantics, not patch the removed surface.

## Alternatives rejected

- **Preserve fork, fix the source-axis conflict** — would require making
  provenance mutable, which breaks every downstream invariant (drift
  detection, manifest serialization, the two-machine merge base).
- **Keep heal actions, remove only publish** — the heal actions' coherence
  depended on fork/publish state; keeping them without fork would have left
  dead branches with no trigger.

## Consequences

Net −3,847 lines. The drift badge, Publish section, and heal-fork arms are
gone from the UI. Users who want to edit a curated or vendored skill now
either: (a) work on a copy in a personal skill, or (b) use the "Detach
origin" flow in the restore path (ADR-0012), which makes the skill local
without any publish affordance. The latter is a deliberate downscope — origin
detach is a recovery action, not an edit-and-contribute workflow.
