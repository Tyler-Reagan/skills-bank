# ADR-0006 — forkSkill atomicity (superseded)

**Status:** Superseded by ADR-0010 (v1.22.0)

The `forkSkill` primitive — scratch-dir atomic swap, source-axis flip from
`curated` → `user`, origin detach, and `vendored/ → personal/` bucket move —
was introduced in v0.11.12 as the safe-copy path for editing curated or
vendored skills locally.

The entire fork/publish/heal surface was removed in v1.22.0. The decision to
remove it is recorded in ADR-0010. This stub exists to close the numbering gap
so the ADR register is sequential and new records can be numbered confidently.
