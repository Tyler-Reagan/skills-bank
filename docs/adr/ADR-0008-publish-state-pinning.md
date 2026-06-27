# ADR-0008 — Dual-mode publish-state computation (superseded)

**Status:** Superseded by ADR-0010 (v1.22.0)

`computePublishStatesFromGit` (local, fast) and `computePublishStatesFromRemote`
(GitHub Trees API, packaged-app-safe) were introduced in v0.11.12 to fix a
silent canon-gate bug where packaged installs without `git` on `$PATH` defaulted
every skill's publish state to `unknown`.

The entire fork/publish/heal surface was removed in v1.22.0. The decision to
remove it is recorded in ADR-0010. This stub exists to close the numbering gap
so the ADR register is sequential and new records can be numbered confidently.
