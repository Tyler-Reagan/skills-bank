# ADR-0011 — Split register into `register` (record-only) and `move-into-bank`

**Status:** Superseded by [ADR-0022](./ADR-0022-registry-is-adopted-only.md) — the
record-only `register` / `move-into-bank` split and the whole in-place (`adopted: false`)
registration path were removed once keep-in-place skills and custom dirs were dropped. The
register/move split described below is historical.

## Context

Registering a skill conflated two concerns behind one boolean
(`RegistrationAction.register.adopt`): **record** the skill in the
registry, and **move** its files into `skills/<bucket>/`. The boolean was
driven globally by `settings.registerAdopts`.

The canonical motivating case (issue #125) is a non-egressable work-org
repo: it can't be moved into the bank and has no GitHub origin, but must
stay on disk while still getting app-managed agent symlinks and labels.
That "track in place" workflow was only reachable via the global toggle
or the drawer's secondary path — and it was in fact **broken
end-to-end**: both the `IPC.register` handler and the Register-All modal
discovered entries via `scanExistingInstalls`, which never walked custom
directories, so a custom-dir skill's register action failed with "entry
not found in scan."

Two coupled problems: (1) the primitive was overloaded, so "record" could
not be expressed without also deciding "move"; (2) custom-dir provenance
never reached the scan, so in-place registration could not complete.

## Decision

Split the overloaded primitive into two coherent ones, making "track in
place" the structural default rather than a special-cased flag.

1. **`register` is record-only.** It writes an `external.json` row
   (`adopted: false`) pointing at the source's realpath and never moves
   files. Optional `agents` fan-out links the in-place source into the
   requested agent set.

2. **`move-into-bank` is the relocate primitive.** It moves a recorded
   (or stray) skill's files into `<registryRoot>/skills/<name>`, flips
   `adopted: true`, and sweeps agent links onto the in-bank copy. Callable
   on an already-registered in-place skill or directly on a stray install.

3. **`registerAdopts` survives as a UI-level chain default.** The renderer
   chains `register` → `move-into-bank` in one gesture when the toggle is
   on **and** the skill isn't a custom-dir source. Custom-dir provenance
   always suppresses the chain — keep-in-place is the whole point of a
   custom directory. The chain predicate (`registerAdopts && !isInPlace`)
   lives in exactly one place: the shared `useRegisterSkill` hook, which
   backs both inline call sites (inline per-card Register, drawer Register).
   The row-based `RegistrationPlanModal` (formerly `RegisterModal`)
   deliberately does not route through the hook — it builds per-row actions
   for explicit disambiguation — but speaks the same
   `register` / `move-into-bank` vocabulary. Bulk "Register All" goes
   through that modal, not the hook.

4. **In-place entries are excluded from the pushed manifest.**
   `exportRegistryManifest` filters out `adopted: false` entries. A
   non-egressable repo's skills are local-only and must never travel via
   push/pull. (Covers both the committed `registry-manifest.json` and any
   pushed copy.)

5. **Custom dirs reach the scan.** `scanExistingInstalls` takes
   `{ customDirs }` and forwards to `listInstalled`; the `IPC.register`
   handler derives the distinct `customDir` values from the incoming batch,
   and `IPC.scan` accepts an explicit `customDirs` arg for the plan modal.
   A real directory whose realpath matches a registry index entry (or lives
   under the registry tree) is classified `ours`, so a registered in-place
   skill's own source no longer reads as a self-conflict.

6. **Locally, in-bank vs in-place is invisible.** Cards surface nothing to
   distinguish the two. Symlinks, labels, and editing all key off
   name/realpath, not `adopted`; the only divergence is sync/portability,
   which is exactly the intended behavior.

## Backcompat — none (deliberate hard cut)

The `adopt` boolean and the combined-register path are deleted outright —
no tolerant-read, no `@deprecated` alias. Every call site moves to the
split primitives in the same change. This diverges from the repo's usual
one-minor-cycle deprecation convention by explicit maintainer decision:
`{adopt}` is an internal renderer↔main wire shape with no external SDK
consumer to preserve. The on-disk `external.json` / `.skills-bank.json`
shapes are unchanged.

## Consequences

- A custom directory pointing at an external repo registers its skills
  without moving files (`adopted: false`); agent symlinks + labels work
  normally, and those skills stay out of the synced manifest.
- "Adopt" as a user-facing verb is replaced by the explicit **Move into
  bank** drawer action, surfaced via the `canMoveIntoBank` capability on a
  registered, non-adopted entry.
- "Register All" opens the `RegistrationPlanModal` — the per-row
  review-then-apply surface — from both the empty state and the Unregistered
  section header; the inline per-card Register button stays the one-off path.
  (An earlier iteration gave the empty state a separate "Scan for existing
  skills" button and made Register All silently loop the cards; the button
  duplicated the header's Scan Local and was removed, and bulk registration
  was unified onto the modal.)
