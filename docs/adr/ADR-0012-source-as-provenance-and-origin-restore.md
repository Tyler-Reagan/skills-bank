# ADR-0012 — `source` is sticky provenance; restore unreachable origins via two human-driven paths

**Status:** Accepted, but its central decision — "`source` is sticky provenance" — is superseded
by [ADR-0019](./ADR-0019-source-removed-origin-is-sole-authority.md), which removes `source`
entirely. Its curated-specific content (the "curated can have no origin" carve-out, the
never-mint-at-runtime rule, and the preserve-curated-across-sync-mount special case) is separately
superseded by [ADR-0017](./ADR-0017-curated-and-bundled-default-removed.md). Its references to
`origin: { kind: "none" }` (the detach stamp and the manifest-export exclusion) are superseded by
[ADR-0018](./ADR-0018-origin-kind-narrowed-no-undefined-state.md), which renames that value to
`"local"`. The leftover "in force" paragraph does **not** remain: `isSelfOrigin` compared Origin
to Linked Repo, and "adopt into linked repo" is a Linked Repo restore path. Linked Repo is
retired. Repoint is writing Origin on the Lock. See [ADR-0025](./ADR-0025-origin-on-the-lock.md),
[ADR-0028](./ADR-0028-first-boot-one-shot-import-hard-cutover.md), and
[ADR-0029](./ADR-0029-manifest-merge-retired.md). This ADR does not define a new self-origin rule.

## Context

Two long-standing soft spots converged.

**1. `source` duplicates what `origin` already determines.** Since v1.22.2
([ADR-amended origin semantics](ADR-0002-sidecars-are-the-skill-record.md)), `origin` means
exactly one thing — _where the content currently lives and is re-fetched from_. With that
narrowing, the stored `source` axis (`curated` / `user` / `vendored`) became largely
redundant: a self-origin (`origin.repo === linkedRepo`) implies `user`, a third-party github
origin implies `vendored`. Only `curated` carries a signal origin can't supply
(curated-channel sync provenance — `syncedFromCommit`).

A _stored_ field that duplicates a _derived_ fact will drift from it. It did, twice:

- The **falsely-curated** bug (v1.20.5): skills stamped `source: curated` with a third-party
  github origin and no sync provenance.
- The **69-skill bucket cleanup**: skills stamped `source: user` while their origin pointed
  at a third-party repo — bulk-imported through the linked-repo pull, which stamped `user`
  indiscriminately.

**2. An unreachable origin is a dead end.** When a vendored skill's upstream is deleted,
renamed, or reorganized, the probe fails `ORIGIN_UNREACHABLE_THRESHOLD` (3) times, the skill
enters `origin-unreachable`, and the **UNREACHABLE** badge appears with no path forward.
`applyOriginUpdate` still prints a "Sever to keep local, or Unlink the pointer" hint for a
404, but those resolution actions were removed in v1.20 (ADR-0010, since deleted) pending a
source-axis-aware redesign and never rebuilt. Live cases span all three modes: `electron`
(repo moved → 301), `caveman`/`diagnose`/`zoom-out` (repo alive at 200, folder relocated → path 404s).

## Decision

### `source` is a sticky provenance class, not a derived label

`source` answers _"how this skill entered the bank"_ — curated by the maintainer, authored by
the user, or vendored from a third party — and is **stamped at acquisition, independent of
`origin`**. It is deliberately **not derived** from origin at read time.

Pure derivation was rejected because it couples `source` to the _current_ `linkedRepo`
identity: a re-link (to a fork or rename) or future multi-linked-repo support would silently
flip every skill's label. Provenance has zero `linkedRepo` dependence and survives both.

`source ⊥ bucket` is now intentional — the v4 manifest already declares them decoupled. The
correctness boundary moves to the **acquisition-time stamp**: the linked-repo pull path must
stamp `vendored` for a third-party github origin (not `user`), `user` for self/none origin,
and preserve `curated` only on the curated channel — extending the v1.20.5 downgrade rule.

### Restore is two deterministic, human-driven paths — no auto-discovery

Auto-discovery (`npx skills find` + name-keyed matching) is rejected: skill folder names are
not unique, so cross-repo auto-repoint can silently replace a skill with a _different_ skill
that merely shares its name — a supply-chain footgun, and a `node`/network runtime dependency
inside a packaged GUI. Instead, the human owns the "is this the same skill?" judgment:

1. **Repoint** — the user pastes the new GitHub URL; the app re-fetches via `applyOriginUpdate`
   (validate + rebaseline + roll back on failure) and rewrites the origin pointer. Stays vendored.
2. **Adopt into linked repo** — `detachOrigin` rehomes the skill locally, then the app opens a
   **PR** committing the folder into the linked repo (per-file via the existing Contents-API
   writer; no Git Data API). A PR, not a direct commit, so the user handles repo-specific
   machinery (`.claude-plugin`, custom files, path placement) in review. After merge + sync,
   `reconcileResidentOrigins` rewrites the origin to a self-origin and it becomes installable
   again.

### `detach` rehomes the folder; detached skills are local-only

`bucket` derives from origin, so `origin: none → personal`. `detachOrigin` therefore **moves
the folder `vendored/ → personal/`** (and repoints agent symlinks — extracted as the reusable
`moveSkillBucket` primitive) so disk, runtime, and manifest agree; the deriver is unchanged.
A detached skill (`origin: none`) is **excluded from the pushed manifest** (mirroring the
`adopted: false` filter), because `import.ts` can't fetch a non-github origin — it would break
restore on other machines. It stays local-only until adopted.

## Consequences

- The acquisition-time stamp is now the single place provenance correctness is enforced; the
  v1.20.5 self-heal generalizes from "downgrade curated" to "stamp the right provenance."
- Consumers must treat `source` and `bucket`/`origin` as independent: the badge stays
  source-driven, the manifest carries both as separate fields, and the classifier must not
  infer one from the other.
- Detached skills are intentionally invisible to sync until adopted — the limbo window
  (detached locally, adopt PR open) mirrors the manifest-PR flow and is accepted.
- Supersedes the removed ADR-0010 restore arm. Drift _resolution_ (`rebaseline`,
  `reset-to-origin`) remains out of scope under issue #126; only the shared `detach`
  (keep-local) lands here.
