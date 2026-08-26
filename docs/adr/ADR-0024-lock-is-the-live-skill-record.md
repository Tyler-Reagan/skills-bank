# ADR-0024 — The Lock is the live skill record

**Status:** Accepted (supersedes [ADR-0021](./ADR-0021-manifest-is-the-live-skill-record.md) and [ADR-0015](./ADR-0015-skill-record-unified-reader.md))

npx skills is the control layer. Content lives in `~/.agents/skills/<name>/`. Metadata lives in the v3 Lock at `{home}/.agents/.skill-lock.json`. There is no `registry-manifest.json` and no per-skill sidecar. List joins the Lock and the folders; a lock-without-folder or a folder-without-lock is a Skill Diagnostic, not a repair.

The disk is still the source of truth. There is no database and no in-memory authority.
