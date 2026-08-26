# ADR-0017 — Curated skills and Bundled Default removed

**Status:** Accepted. Curated and Bundled Default stay gone. The sentence that left ADR-0012's `isSelfOrigin` and adopt-into-linked-repo "in force" is withdrawn; see [ADR-0025](./ADR-0025-origin-on-the-lock.md).

## Context

The `curated` source value and the Bundled Default registry state existed to ship a small
default skill set (`skills/vendored/find-skills`) so a brand-new install wasn't empty. That
required real machinery to keep safe: `packages/core/src/registry/canon.ts`'s upstream-snapshot
tracking (`upstream-canon.json`, `hidden-canon.json`), a dedicated delete/unregister-protection
axis (`canon`) independent of `source`, curated-specific branches in `build.ts`'s drift-detection
gate and `sync.ts`'s orphan-detection scoping, a first-launch seed step in `main.ts`, and a CURATED
badge + Settings modal list in the renderer.

Issue #159's domain-modeling review of this machinery (see the ADR-0012 discussion it grew out of)
found that `canon`'s meaning was undocumented anywhere in the codebase, that it could silently
diverge from `source: curated` in ways no one had named, and that `curated`'s entire justification
was downstream of one product decision: that new installs should ship with default content. That
product decision no longer holds — the target user is a power user capable of choosing their own
initial skill set, not someone who needs the maintainer's picks pre-loaded. Once that premise is
gone, `curated`/`canon` aren't a simplification target, they're dead weight with nothing left to
justify them.

## Decision

Remove `curated` and Bundled Default entirely, not derive a replacement for either. New installs
start with zero skills — a blank slate. Concretely, this removes:

- `packages/core/src/registry/canon.ts` in full, and both its on-disk sidecars.
- The bundled `skills/vendored/find-skills` asset and the first-launch seed step in `main.ts` that
  populated `upstream-canon.json` from it.
- The CURATED badge (`SkillCard.tsx`) and the Settings modal's curated-skills list.
- The curated-specific branches in `build.ts`'s drift-detection gate and `sync.ts`'s
  orphan-detection scoping.
- `"curated"` as a legal value of the `source`/`SkillOrigin` enum. (How far `source` shrinks
  beyond that removal is a separate, still-open decision — see Follow-ups.)
- The parts of ADR-0012 that exist only to make `curated` safe: the "a curated skill can have no
  origin" carve-out, the "never mint `curated` at runtime" rule, and `stampOriginMarker`'s
  preserve-`curated`-across-sync-mount special case. ADR-0012's other content — `isSelfOrigin` as
  the single self-vs-third-party decider, and the two-path origin-restore design (repoint / adopt
  into linked repo) — is untouched and remains in force.

## Alternatives rejected

**Keep `curated` as a derived UI-only label** (computed from "external + no Linked Repo configured

- unedited" rather than stored). Considered during the domain-modeling discussion, rejected once
  the underlying feature was itself cut: there's no shipped-defaults state left to derive a label
  about, so a vestigial derived-curated concept would preserve conceptual weight this decision is
  meant to discard, not reduce it.

## Consequences

- **Blank-slate first run.** No skills, not even `find-skills`, ship with the app going forward.
  Discovery/onboarding must stand on its own (Discover tab, linked repo) with no default seed.
  Accepted as intentional for a power-user audience.
- **Wire-format impact.** Removing `"curated"` from the `source` enum changes manifest schema v5
  and `.skills-bank.json`'s legal values — a breaking change needing a version bump and migration
  story, not a minor-cycle deprecation. That mechanical work is deferred until the full shape of
  `source` is settled (see Follow-ups) so it happens once, not twice.
- Deletes a meaningful amount of code and its test coverage (`canon.ts`, the seed step, curated UI,
  curated-specific branches) — exact size TBD at implementation time.
- The call sites named above are illustrative, not exhaustive — `curated` also reaches
  `renderer/App.tsx`, `ModalRegistryContext.tsx`, `BrowseTab.tsx`, both packages' `INVENTORY.md`
  architecture docs, and `README.md`/`CLAUDE.md` themselves. Full inventory is implementation-time
  work, tracked in the eventual feature-branch PR description, not enumerated here.

## Follow-ups (not decided by this ADR)

1. Redefine `OriginKind` to close the `"none"`/vacuum gap — proposal on the table: `"github" |
"local"`, with no state where a registered skill's origin is genuinely unresolved for more than
   one build pass.
2. Decide how far `source` shrinks now that `curated` is gone: to a single owned-vs-external bit,
   or away entirely in favor of deriving everything from `origin` (self vs. external GitHub repo,
   or local). Hinges on whether `detach` should keep remembering "this wasn't originally mine"
   after the user takes over stewardship.
