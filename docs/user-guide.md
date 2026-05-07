# Skills Bank user guide

This page is an index. Pick whichever doc matches what you're trying to do.

## Start here

- **[`getting-started.md`](getting-started.md)** — From "I downloaded the app" to "I'm using a skill in Claude Code" in five minutes.
- **[`concepts.md`](concepts.md)** — The vocabulary the UI uses: skill, registry, persona, source, publish state, conflict, …

## Day-to-day flows

- [`flows/install.md`](flows/install.md) — Browse the Registry tab and link a skill into your agents.
- [`flows/register.md`](flows/register.md) — Bring an externally-installed skill under Skills Bank's management.
- [`flows/manage-links.md`](flows/manage-links.md) — Add or drop a skill from individual agent dirs.
- [`flows/resolve-conflicts.md`](flows/resolve-conflicts.md) — Clean up duplicate copies in other agent dirs.
- [`flows/sync.md`](flows/sync.md) — Pull upstream registry updates (convenience persona).
- [`flows/login.md`](flows/login.md) — The first-launch persona choice and how to switch later.

## Reference

- [`keyboard.md`](keyboard.md) — Keyboard shortcuts.
- [`troubleshooting.md`](troubleshooting.md) — Common problems and how to recover.
- [`self-host.md`](self-host.md) — Fork and ship your own build.
- [`meta-schema.json`](meta-schema.json) — JSON schema for `meta.json` in skill folders.

## App vs registry updates

These are independent paths:

- **App updates** arrive via auto-update. The app polls the GitHub Releases feed on launch; when a new version downloads in the background, a "Restart" toast lets you apply it.
- **Registry updates** (convenience persona) arrive via the Sync button. They never trigger an app restart.

You can update one without the other.
