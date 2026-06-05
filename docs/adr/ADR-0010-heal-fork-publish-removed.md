# ADR-0010 — Heal/fork/publish feature surface removed

**Status:** Accepted (v1.20.0)

## Context

Three related feature surfaces were added between v1.3 and v1.5:

**Heal actions** (`keepLocalDetach`, `rebaselineHash`, `flipSourceToUser`,
`unlinkOrigin`) let users resolve a "drift" state — the condition where a
skill's on-disk content differed from the baseline recorded at last sync.
The four functions live in `packages/core/src/heal.ts`. Two IPC handlers
(`acceptDrift`, `takeCanonical`) wired them into the desktop app; the drawer
surfaced them as "Accept drift / Re-baseline / Unlink origin" buttons.

**`forkSkill`** (ADR-0006, `packages/core/src/fork.ts`) was the atomic
primitive that converted a vendored skill into a user-owned personal skill:
drop the origin pointer, flip `source: curated → user`, move the folder
from `skills/vendored/` to `skills/personal/`, best-effort repoint agent
symlinks.

**Publish flow** (`packages/core/src/publish-classify.ts`,
`publish-state.ts`, `packages/desktop/src/renderer/components/PublishSection.tsx`,
and the corresponding IPC handlers `publishSkill`, `classifySkillForPublish`,
`getPublishState`, `getPublishStates`) composed `forkSkill` with
`pushSkillFolder` to open a pull request on the user's linked repo. Three
sub-flows: `new`, `safekeeping`, and `fork` (the drift case). ADR-0007 and
ADR-0008 captured the push and publish-state invariants.

ADR-0006 established `forkSkill` primitive invariants. ADR-0008 established
the publish-state computation strategy (git-mode vs. remote-API-mode).

## Decision

Remove the entire surface. File deletions: `fork.ts`, `fork.test.ts`,
`publish-classify.ts`, `publish-classify.test.ts`, `publish-state.ts`,
`publish-state.test.ts`, `PublishSection.tsx`. Surgical removal from
`heal.ts` (four action functions only; utility functions stay), `main.ts`
(six IPC handlers), `preload.mts` (six entries), `ipc.ts` (channel
constants, interface methods, publish types), `DrawerActions.tsx` (three
action states and their button blocks), `DrawerHost.tsx` (three callbacks),
`SkillCard.tsx` (drift badge), and the barrel `index.ts`.

Reasons:

1. **Heal actions were label-flips only.** `keepLocalDetach` and
   `flipSourceToUser` changed `.skills-bank.json` source values without
   moving any files between buckets. The actual file-move lived in
   `forkSkill`, a separate composer that was never exposed with a coherent
   UX path from the heal drawer to the publish drawer. The two halves of
   the intended flow were never connected to a single user-facing action.

2. **Source axis conflation made fork unruly.** Pre-v1.20 `source: "curated"`
   applied to both app-bundled skills AND user-installed third-party skills
   from any origin. This made the fork source condition (`anything source:
   "curated"`) overcrowded and impossible to reason about precisely.

3. **`source: "vendored"` introduced in v1.20 stabilises semantics.**
   With the source axis now carrying `"curated"` for app-bundled skills and
   `"vendored"` for third-party skills, the correct fork trigger condition
   can be expressed cleanly. Removing the stale implementation first avoids
   carrying a semantically broken version forward into the new taxonomy.

4. **Supersedes ADR-0006** (fork primitive invariants) and retires
   ADR-0007 (push invariants) and ADR-0008 (publish-state strategy) as
   forward-active design guidance.

## Alternatives rejected

- **Keep heal actions, remove only publish.** Heal action buttons in the
  drawer had no useful effect post-removal of fork: `keepLocalDetach`
  flipped a source label but left the file in `vendored/`, producing an
  invalid state. Keeping half the surface was worse than removing both.

- **Fix the UX gap (connect heal → fork → publish as one flow).** A valid
  path, but the source axis conflation in the current taxonomy means the
  trigger condition for fork (`source: "curated"` + drift) applies to
  skills the user never intended to fork. The redesign must happen after
  the source axis stabilises.

- **Deprecate with `@deprecated` re-exports for one minor cycle.** These
  are action functions exposed through IPC, not SDK library exports. The
  deprecation cycle convention applies to `packages/core` barrel exports
  consumed by external callers; an IPC handler with no external clients
  does not benefit from a shim cycle.

## What replaces it

Nothing yet — this is a deliberate clearing of design space.

A future "fork" feature should use explicit bucket-move operations tied
to the stable `"vendored"` / `"curated"` / `"user"` source vocabulary
introduced in v1.20, with a coherent single-gesture UX from drift detection
through publish.

The drift badge (`EDITED`) on `SkillCard` is removed from the UI but
`entry.drift` continues to be computed in `build.ts` for future use.
The "update from origin" flow (`originUpdate`, `canUpdate`, `canResetToOrigin`)
is preserved as the only live drift-resolution path.

## Consequences

- The `EDITED` drift badge no longer renders on skill cards. Skills in a
  drift state surface their state through the drawer text only (the
  `edited-without-origin` / `edited-with-origin` drawer state headings
  remain, but the action buttons that resolved them are gone).
- `acceptDrift` and `takeCanonical` IPC channels are unregistered. Any
  call from a cached preload (stale renderer with a fresh main process)
  will receive an "No handler registered" Electron error — acceptable
  given this is a development-only scenario; the app always reloads on
  update.
- `PublishSection` is gone from the drawer. The "Linked repo" section and
  Publish button disappear entirely until the feature is redesigned.
- `packages/core/src/fork.ts`, `publish-classify.ts`, and `publish-state.ts`
  are deleted. Their test files are deleted. The barrel re-exports are
  removed.
- Heal utility functions (`hashSkillFolder`, `readSyncedHash`,
  `writeSyncedHash`, `readRuntimeState`, `writeRuntimeState`) are
  unchanged — they underpin sync and origin-probe flows that remain active.
