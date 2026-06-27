# ADR-0007 — pushSkillFolder atomicity (superseded)

**Status:** Superseded by ADR-0010 (v1.22.0)

The `pushSkillFolder` primitive — six-step GitHub API push (tree → commit →
ref → PR) with ref-as-commit-point atomicity, PR-state-aware branch
resolution, and rate-limit handling — was introduced in v0.11.12 as the
upstream-publish path for forked skills.

The entire fork/publish/heal surface was removed in v1.22.0. The decision to
remove it is recorded in ADR-0010. This stub exists to close the numbering gap
so the ADR register is sequential and new records can be numbered confidently.
