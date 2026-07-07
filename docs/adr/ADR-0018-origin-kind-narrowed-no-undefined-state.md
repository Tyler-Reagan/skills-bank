# ADR-0018 — `OriginKind` narrowed to `github | local`; no undefined state

**Status:** Accepted; enum shape amended by
[ADR-0020](./ADR-0020-origin-is-a-nullable-url-manifest-v6.md), which replaces
`"github" | "local"` with a single nullable URL. The core invariant this ADR establishes — every
indexed skill has an explicitly stamped origin answer, never an undefined state — survives
unchanged (`url: null` is the explicit stamp).

## Context

`OriginKind` today is `"github" | "none"`, but `"none"` conflates two different things. A skill's
`.skills-bank.json` can carry an explicit `{ kind: "none" }` stamp — a deliberate "this is mine,
stop scanning" marker set by `detach` or the manual origin picker. Or it can carry _no origin field
at all_, which `source.ts` documents as "unknown lineage, scanner may try to classify on next
walk" — a promise to maybe resolve it later, not a guarantee. That second flavor can persist
indefinitely: if the boot-time lock scanner (`scanAndStampUpstreamFromLock`) finds no matching CLI
lock entry for a skill, today's code just leaves it unmarked and moves on.

Issue #159's domain-modeling review named the actual defect: a skill's origin has to be _something_
— either a remote GitHub location or a local one — and treating "no evidence yet" as a state that
can legally persist across app launches is the problem, not just the `"none"` name.

## Decision

Narrow `OriginKind` to two positive values: `"github" | "local"`. No `"none"`, and no legal state
where an indexed skill's origin is unresolved beyond the single build/walk pass that indexes it.

The build/walk pass is the resolution boundary: a skill folder that hasn't been indexed into a
`RegistryEntry` yet isn't the app's data, so there's nothing to leave undefined. The instant it is
indexed, its `origin.kind` is decided as part of that same pass — not deferred.

- The boot-time lock scanner stops being advisory. GitHub lock evidence found → stamp `"github"`;
  none found → stamp `"local"`, right then, not "leave unmarked, retry next walk."
- `detach` and the manual "this is mine" origin picker both stamp `"local"` (previously
  `{ kind: "none" }`) — same mechanics, renamed value.
- `"local"` is a flat value with no sub-reason. Nothing downstream (drift detection, sync,
  manifest export) needs to distinguish _why_ a skill is local, only that it is — adding a
  discriminant would recreate exactly the taxonomy weight ADR-0017 removed.
- **This invariant is about definedness, not correctness.** A skill can be stamped `"local"` when
  no GitHub evidence survives — e.g. a manually copied folder whose lock file was lost — even
  though it may have originated from GitHub at some point. That's an acceptable, correctable guess,
  not a violation: the user can re-stamp it via the manual origin picker if they know better.
  Separately, a skill stamped `"github"` can still turn out to be wrong, or become unreachable
  later (404, repo moved) — that's the existing origin-unreachable state and probe-runner
  machinery, entirely unaffected by this decision. This ADR removes the possibility of
  _undefined_; it does not, and is not meant to, remove the possibility of _incorrect_.

## Alternatives rejected

**Keep a third value distinguishing "unknown" from "deliberately no origin."** Rejected because
the "unknown" flavor is exactly the persistent gap this decision closes — if something is only
ever unknown for the duration of one build pass, it doesn't need a stored representation at all.

## Consequences

- Wire-format impact: `.skills-bank.json`/manifest schema's legal `origin.kind` values change from
  `"github"|"none"` to `"github"|"local"`. Batching this schema bump with the still-open
  `source`-shrink decision (see Follow-up) so the manifest version moves once, not twice.
- `stampOriginMarker`, `detachOrigin`, `reconcileResidentOrigins`, the manual origin picker, and the
  manifest-export non-fetchable-origin exclusion all keep working as designed — this is a rename of
  the value they write/check, not new machinery.
- The lock scanner's contract changes from "opportunistic, may retry" to "authoritative for this
  pass" — worth a code comment at the call site so a future reader doesn't reintroduce a "leave it
  unmarked, try again later" fallback.
- The call sites named above are illustrative, not exhaustive — `kind: "none"` also reaches
  `desktop/src/main/ipc-github.ts`, `renderer/components/DrawerOriginSection.tsx`,
  `renderer/components/SkillDetailDrawer.tsx`, and the discriminated union in
  `desktop/src/shared/ipc.ts`. Full inventory is implementation-time work, tracked in the eventual
  feature-branch PR description, not enumerated here.

## Follow-up (not decided by this ADR)

How far `source` shrinks, or whether it disappears entirely in favor of deriving everything from
`origin` — now the only remaining open question, since both `curated` (ADR-0017) and the
`origin.kind` vacuum state (this ADR) are settled.
