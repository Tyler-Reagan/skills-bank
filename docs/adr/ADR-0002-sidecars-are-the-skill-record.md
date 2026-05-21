# ADR-0002 — Sidecar files are the Skill record

**Status:** Accepted (v0.11.7)

## Context

A skill on disk is described by up to three files alongside its
`SKILL.md`:

1. `.skills-bank.json` — Source + Origin pointer + Baseline hash.
   Committed in the bundled registry; gitignored when generated
   downstream.
2. `.skills-bank-hash` — runtime probe state cache (last upstream
   commit sha observed, last fetched timestamp). Always gitignored.
3. `meta.json` — optional user-facing tags + display metadata. Lives
   inside the skill folder and is committed.

Together these constitute the skill's record. There is no DB; no
in-memory authoritative source; the disk is the source of truth.

Repeated proposals (v0.10.x era, again at the start of v0.11.x) have
suggested unifying these into a single file — "the Skill record" —
to reduce mental load. The recurring argument is correct on the
surface: three sidecars _is_ more files than one. But each split
exists for a load-bearing reason.

## Decision

The three sidecars stay separate. Their boundaries are:

- **`.skills-bank.json` is what gets committed.** Mixing in a runtime
  cache (last probe sha, fetchedAt) creates working-tree churn on
  every app launch — exactly the bug v0.11.7 M8 fixes by carving
  `fetchedAt` _out_ of this file. The committed marker stays small,
  stable, and review-friendly.
- **`.skills-bank-hash` is runtime state, intentionally not shipped.**
  Probing depends on it for "did anything actually change since last
  time"; that has no business in the committed record.
- **`meta.json` is user-authored.** Tags belong to the maintainer, not
  to the install pipeline. Unifying it into `.skills-bank.json` would
  invite the install pipeline to overwrite user-curated state on
  every sync.

**Rule:** No fourth sidecar lands without revisiting this ADR. New
metadata either:

- Joins one of the existing three files (with explicit reasoning on
  which one and why), or
- Justifies a fourth file with a concrete reason the other three
  couldn't absorb it.

## Consequences

- The two test suites that touch sidecars (`hashSkillFolder` for the
  exclusion list, `mergeImportRegistry` for the source-stamping
  contract) pin the boundary. Refactors that try to "simplify" by
  collapsing files will fail tests instead of silently regressing.
- v0.11.7 M8 (fetchedAt fix) is a pure consequence of this ADR: the
  runtime field moves to the runtime sidecar.
- v0.11.9 (core architecture refactor) can consolidate the _code_
  that touches these files (the eventual `SkillRecord` type) without
  consolidating the _files_ themselves. The type can read all three;
  the files stay split.

## v1.3 amendment — wire-format vocabulary

The ADR's stability claim is reframed from "stable absolutely" to
"stable across renames via tolerant-read windows." Two specific
changes land in v1.3 under that discipline (see the CHANGELOG v1.3.0
entry for the full surface):

- **`.skills-bank.json` `source` axis values rename:** `bundled` →
  `curated`, `yours` → `user`. Tolerant reads accept both for one
  minor cycle (v1.3.x); writes use only the new values from v1.3
  onward.
- **`.skills-bank.json` field `upstream` → `origin`.** The renamed
  TypeScript surface (v0.11.10 origin-rename-pass) gets matched on
  the wire. Tolerant reads accept both keys for one minor cycle;
  writes use only `origin` from v1.3 onward.

The rule on no-fourth-sidecar stands. A rename inside an existing
sidecar is not a fourth file; it's a vocabulary refinement of an
existing one, and the tolerant-read window contains the blast
radius. Removal of legacy readers targeted at v1.4.

A maintainer pass-through (`scripts/migrate-source-markers.ts`)
rewrites every committed marker to the new form in one PR, so the
curation layer doesn't drip-migrate over weeks. Downstream
registries — anything the app touches — drift toward the new form
automatically as files are touched.
