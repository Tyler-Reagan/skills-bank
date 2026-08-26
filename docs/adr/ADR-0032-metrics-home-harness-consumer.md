# ADR-0032 — Metrics stay on the real home; they consume harness machinery

**Status:** Accepted

The invocation log, hook script, and tracking ledger stay at real `~/.skills-bank/`. The Hook entry stays in real `~/.claude/settings.json`. Unpackaged runs still never write real `~/.agents`. There is one Claude Code; the Hook fires from it, so a dev build and a packaged build share that log.

Metrics is not a Store feature. It is a desktop consumer of harness machinery: Claude Hook, Invocation, and Tracking today. Cursor machinery is not named yet; when it exists, Metrics consumes it the same way. Do not move the log under `~/.agents` to sit next to the Store.
