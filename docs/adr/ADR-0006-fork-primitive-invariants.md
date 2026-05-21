# ADR-0006 — `forkSkill` primitive: atomicity, collision, trigger

**Status:** Proposed (post-v1.0)

## Context

The in-app Publish flow (planned post-v1.0) has three sub-flows by
trigger condition — new / safekeeping / fork — defined in
[`docs/concepts.md`](../concepts.md#publish). The fork sub-flow is the
delicate one: a user has vendored a third-party skill, edited it
locally, and now wants to push their edits to their linked repo.
Publishing the edits without disclaimer would silently desync the
local copy from its origin — the update probe would keep surfacing
origin changes the fork has diverged from, and the user wouldn't
know their copy had effectively become a fork.

Per [`UBIQUITOUS_LANGUAGE.md`](../../UBIQUITOUS_LANGUAGE.md), the
canonical user-facing verb for "drop the origin pointer" is **Unlink
origin**, not "sever upstream" or "accept drift." This ADR uses the
canonical terms in prose; legacy identifiers in the codebase
(`acceptDriftSeverUpstream`, `SkillSource.upstream` field) retain
their existing names and are out of scope for this ADR.

The chosen UX (architecture-pass grilling, Nov 2026):

1. Detect the case at publish time (`source.upstream` set + drift detected).
2. Force the user to confirm via a "Fork your edits" modal.
3. On confirmation, perform a single named operation —
   `forkSkill(registryRoot, name)` — that unlinks the origin
   pointer, flips `source: bundled → yours`, moves the folder from
   `skills/vendored/<name>/` to `skills/personal/<name>/`, and best-
   effort repoints agent-dir symlinks.
4. Refuse the operation on bucket collision (a `personal/<name>` already exists).

This operation has the same failure-class as `mirrorSkillFolder` —
multi-step filesystem mutation with partial-failure torn-state
potential. ADR-0001 Suite 4 pinned that invariant for the inbound
mirror; this ADR pins the symmetric invariants for the outbound fork.

## Decision

Three invariants for `forkSkill`, plus an extension of ADR-0001's test
foundation.

### Invariant 1 — Registry atomicity via scratch-dir + atomic swap

`forkSkill` follows the same scratch-dir pattern `mirrorSkillFolder`
uses. The operation sequence:

1. Validate inputs — `findSkillFolder` confirms the skill is in
   `vendored/`, the source marker has an origin pointer (the
   `SkillSource.upstream` field, retained under its legacy name),
   and `personal/<name>/` does not exist.
2. Copy `vendored/<name>/` to
   `<registryRoot>/.skills-bank/scratch/fork-<rand>/<name>/`.
3. Mutate the scratch copy's source markers — call
   `acceptDriftSeverUpstream` on the scratch dir (drops the origin
   pointer and `.skills-bank-hash`; function retains its legacy
   name pending a future rename pass), then `flipSourceToYours`
   (new four-line helper in `heal.ts`).
4. `fs.renameSync(scratchPath, personalDestPath)` — the atomic
   commit point. Failure here returns the operation cleanly with
   `swap-failed`; nothing has been removed from the source bucket.
5. Remove the old `skills/vendored/<name>/`.
6. Best-effort: repoint agent-dir symlinks (`~/.claude/skills/<name>`,
   `~/.cursor/skills/<name>`, etc.) that previously pointed at the
   `vendored/` location.
7. Cleanup the scratch root.

Failure anywhere before step 4 leaves zero mutation to the registry.
Failure between steps 4 and 5 leaves a transient duplicate (both
buckets have the skill) — the existing `walkSkills`
collision-detection throws `SkillNameCollisionError` on the next
build, and the heal flow converges by removing the vendored leftover.
Symlink repointing (step 6) intentionally sits OUTSIDE the atomic
envelope: agent dirs follow the registry, never lead it, matching
`installSkill`'s existing model.

### Invariant 2 — Collision policy: refuse, never overwrite

If `skills/personal/<name>/` exists at validation time, the operation
returns `{ ok: false, reason: "collision", existingDir }`. The
renderer surfaces a modal directing the user to one of three explicit
resolutions:

- Open the conflicting personal skill (rename via meta.json or unregister).
- Revert the vendored edits (discard the fork plan; origin tracking remains intact).
- Cancel.

No auto-rename (silent renames cascade through agent-dir symlinks
in ways that are hard to undo). No `confirmDestructive` overwrite
path (the conflict reflects state the application cannot disambiguate;
the user resolves explicitly).

### Invariant 3 — Trigger condition: must have an origin pointer

`forkSkill` returns `{ ok: false, reason: "no-origin" }` for skills
without an origin pointer in their source marker. Fork is
_specifically_ the origin-unlinking operation; it is not a generic
"convert to yours" helper or "move bucket" helper.

This keeps the contract narrow and testable: one shape of input
(vendored-with-origin, optionally drifted), one shape of output
(personal, unlinked, owned by the user).

### Test foundation extension

ADR-0001's "and only these five" pin applies to the v0.11.7 foundation.
Post-v1.0 primitives extend that foundation rather than reopen
ADR-0001.

Fork adds a sixth suite to `packages/core/src/fork.test.ts`. Mirroring
Suite 4's structure for `mirrorSkillFolder`:

- Injected fs failure during scratch population → no mutation to source dir, no leftover scratch.
- Injected fs failure during source-marker rewrite → no mutation to source dir, no leftover scratch.
- Injected fs failure during the atomic `rename` → no mutation to source dir.
- Successful swap followed by failure during `vendored/<name>/` removal → personal copy is canonical, vendored leftover surfaces on next `walkSkills` (acceptable per Invariant 1).
- Collision pre-check → no mutation, correct error result.
- Missing-origin pre-check → no mutation, correct error result.

## Consequences

- `acceptDriftSeverUpstream` gains a second caller (the scratch-dir
  path inside `forkSkill`), satisfying the "two adapters = real seam"
  test from the architecture pass — no signature or behavioral change
  required.
- A new `flipSourceToYours(skillDir)` helper lands in `heal.ts`
  alongside the existing source-mutation primitives. Four-line
  function; earns its keep by being independently testable and
  reusable from the fork composition.
- The Publish IPC handler (separate scope — candidate #5 in the
  architecture pass) classifies skills into the three publish flows
  and only calls `forkSkill` for Flow 3 (edited vendored). Flows 1
  and 2 use `pushSkillFolder` (candidate #1, ADR pending) without
  involving fork.
- **Fork commits before push.** In Flow 3, the IPC handler runs
  `forkSkill` (local) before `pushSkillFolder` (remote). If the
  remote push fails — network, auth, rate limit — the local fork
  persists and the PR is never created. The user retries the push
  without re-confirming the fork modal; the fork itself is already
  committed. This matches `installSkill`'s registry-leads-agents
  model (local commits first, remote follows). Re-vendoring from
  the origin is the only path back to a pre-fork state.
  Each fork requires its own user confirmation, so this asymmetry
  cannot be batched across multiple skills — bulk publish handles
  Flow 1 and Flow 2 skills only; Flow 3 skills are surfaced
  individually for confirmation.
- A new directory convention: `<registryRoot>/.skills-bank/scratch/`
  for in-flight fork operations. Gitignored. Cleanup is per-operation
  (each fork creates `fork-<rand>/` and removes it on completion or
  failure); a stale-scratch sweep at app launch is not yet specified.

## Re-opening this decision

Invariant 3's narrowness — "must have an origin" — may bite if a
future flow needs to "convert this `yours`-no-origin skill into a
different bucket." Three options when that comes:

1. Add a separate `relocateBucket(skillDir, targetBucket)` primitive.
   Cheap; no impact on fork's contract.
2. Broaden `forkSkill`'s trigger to accept `yours`-no-origin and
   skip the unlink step. Changes the contract; would require this
   ADR to be amended.
3. Refactor both into a wider "skill record transition" primitive.
   Significant; would supersede this ADR.

Option 1 is the cheapest path if the need arises. Do not preemptively
broaden fork.
