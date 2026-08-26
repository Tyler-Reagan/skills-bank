# ADR-0026 — Claude Projection; Cursor reads the Store

**Status:** Accepted

Cursor is a universal reader of `~/.agents/skills`. Skills Bank does not write `~/.cursor/skills`. Claude Code is not universal: Projection is a directory symlink at `~/.claude/skills/<name>` that points at the Store folder. Delete composes Unproject.
