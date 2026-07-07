# ADR-0019 — `source` removed; `origin` is the sole authority on provenance

**Status:** Accepted

## Context

With `curated` removed ([ADR-0017](./ADR-0017-curated-and-bundled-default-removed.md)) and
`origin.kind` narrowed to an always-defined `"github" | "local"`
([ADR-0018](./ADR-0018-origin-kind-narrowed-no-undefined-state.md)), the only question `source`
could still answer — "is this mine, or someone else's" — is now fully computable from `origin`
alone. `bucket` already performs exactly this computation today (`local`, or self-origin
`github` → `personal`; third-party `github` → `vendored`); a separate sticky `source` field
duplicates it.

The one candidate reason to keep `source` independent was preserving "this was originally
vendored" memory across `detach` — so a skill's history survives even after the app stops tracking
where it came from. Discussion concluded that memory isn't needed: `detach` is a lightweight
escape hatch, a shortcut for what would otherwise be a manual fork-and-maintain-your-own-copy
workflow, not a formal transaction the app is obligated to audit. A user can detach a skill and
leave it local forever, never pushing it anywhere, and that's an ordinary, acceptable end state —
not a limbo requiring a permanent provenance footnote. The only thing that must stay unambiguous
is what `detach` _does_: flip the skill's origin from `github` to `local`. No parallel record is
needed to know that.

## Decision

Remove the `source` field entirely — the `SkillOrigin` type, `SkillSource.source`, the `source` key
in `.skills-bank.json`, and `ManifestSkill.source` in the manifest schema. Every prior consumer
re-derives the same answer from `origin`:

- "Is this mine?" → `origin.kind === "local"`, or `origin.kind === "github"` and self-origin
  (`origin.repo === linkedRepo`).
- "Is this someone else's?" → `origin.kind === "github"` and not self-origin.
- `bucket` (or the `isSelfOrigin` check underneath it) becomes the single authority for this
  distinction, not one of two agreeing-most-of-the-time fields.

`detachOrigin` (`heal.ts`) simplifies accordingly: it only ever touches `origin`, flipping
`github` → `local`. There's no second field to leave untouched or reconcile.

## Alternatives rejected

**Keep `source` as a 1-bit sticky "was this ever third-party" memory, surviving `detach`.**
Rejected: `detach` is optional and terminal-if-left-alone, not a transaction the app must audit
going forward. Requiring a permanent footnote for an action with no obligation attached to it
doesn't pull its weight.

## Consequences

- This fully supersedes ADR-0012's central decision ("`source` is sticky provenance"). ADR-0012's
  remaining content — the two-path origin-restore design (repoint / adopt into linked repo) and
  `isSelfOrigin` as the self-vs-third-party decider — is unaffected; both already operate on
  `origin`, not `source`.
- Manifest schema: removing `ManifestSkill.source` combines with ADR-0018's `origin.kind` rename
  into one schema version bump, not two.
- Simplifies `sync.ts` (no more source-scoped orphan detection or mount-source stamping — both key
  off `origin`/`bucket` alone) and `stampOriginMarker` (no provenance-healing logic remains, since
  there's no provenance value left to heal).
- The full call-site and doc migration surface (renderer reads of `entry.source.source`, `README.md`
  /`CLAUDE.md`/`INVENTORY.md` mentions, etc.) is implementation-time work, tracked in the eventual
  feature-branch PR description per this repo's convention — not enumerated here.
