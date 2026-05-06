# skills-bank roadmap

This document captures the long-tail product direction for the Skills Bank desktop app. Each milestone (M1–M6) has a corresponding tracking issue in this repo, labeled `roadmap`.

## Vision

Skills Bank is a desktop manager for [Claude Code](https://claude.ai/code) skills, with a first-launch decision that splits users into two personas. Each persona has its own update flows and registry-management capabilities — but both share the same install/uninstall model and freedom to author skills locally.

### Convenience persona (skip authentication)

The default path. The app manages a local registry of skills, seeded from this repo's canonical collection. Two automated update tracks run independently:

- **App updates** — the desktop app auto-updates from GitHub Releases.
- **Skill updates** — an in-app "Sync" pulls the latest canonical skills via an **upsert** that never touches user-added entries. Naming conflicts are resolved manually by the user.

Each skill carries a source marker (`canonical`, `user`, `imported`) so the UI can differentiate them. Adding your own skills alongside canonical ones is fully supported.

### Power persona (authenticate with GitHub)

Two unlocks for users who want full control:

- **Replace registry** — point the app at a private repo of your own that contains a `skills/` directory. The app clones it (token-authenticated) and uses it as the registry source. No automated sync; you maintain it via your own GitHub workflow.
- **Self-host** — fork this repo (app + registry), build and distribute your own DMG. Onus for both app and registry maintenance transfers entirely to you.

In power mode, automated canonical-skill sync is off by design — you've opted out of the convenience-managed flow.

## Milestones

### M0 — Public distribution + app auto-update *(shipped)*

- Tagged release builds (`v*`) produce Apple Silicon and Intel DMGs published to draft GitHub Releases.
- Installed apps poll the Releases feed via `electron-updater`; a non-blocking toast prompts the user to restart when a new version downloads.
- Code signing and notarization are scaffolded but dormant; flip the secrets and `mac.identity` to activate.
- App and registry update paths are structurally independent (the registry lives in user data, the app in `/Applications`).

### M1 — Foundation: app-managed registry + source tagging

Plumbing for the persona model. Move the convenience-persona registry into the app's `userData` directory and tag each skill with its origin via a sibling `.skills-bank.json` file (kept separate from `meta.json` so canonical skills remain portable). Loosen registry validation so user-added skills with minimal metadata still work.

### M2 — Convenience-persona canonical sync (UPSERT)

The first user-visible feature of the persona model. A "Sync skills" action fetches the canonical registry as a tarball from GitHub, then upserts: canonical-sourced skills are overwritten in place, user-added skills are never touched, and naming collisions are queued for resolution. The resolved commit SHA is recorded per-skill so subsequent syncs are no-ops when nothing has changed.

### M3 — Login screen + persona persistence

First-launch screen with three choices: authenticate with GitHub, continue without, or self-host. Authentication uses GitHub Device Flow, with tokens stored in the OS keychain via Electron's `safeStorage` API. The chosen persona is persisted and switchable later.

### M4 — Power-persona registry replacement

After authentication, the user picks a private repo of theirs that contains a `skills/` directory; the app clones it (token-authenticated) into the registry location. Conventions for what makes a valid skill repo are surfaced inline. Auto-sync is hidden in this mode.

### M5 — Conflict resolution UX

When M2's sync detects a naming collision between a canonical skill and a user-added skill of the same name, a modal prompts the user to keep theirs, accept canonical, or rename theirs. The decision is persisted so subsequent syncs don't re-prompt.

### M6 — Self-host exit ramp

A docs page in this repo with fork-and-build instructions. The login screen's "Self-host" option deep-links here. Pure documentation — no app code change.

## Locked-in design decisions

These shape every milestone and are not up for re-litigation without a new design pass:

1. **Source marker location** — sibling `.skills-bank.json` per skill, not extended `meta.json`. Keeps canonical skills portable; app-specific state never round-trips back to the upstream registry.
2. **Sync mechanism** — GitHub tarball API, not an embedded git binary. Works for non-developer installs without bundling git. Resolved commit SHA is recorded in each canonical skill's `.skills-bank.json`.
3. **OAuth flow (M3)** — GitHub Device Flow, not a localhost-callback OAuth handler. No client secret to leak from a distributed Electron app, no callback-listener plumbing.
4. **Single active registry** — no multi-registry runtime switching. Persona determines source. Power users replace the registry; convenience users sync canonical and add their own alongside.

## Explicitly out of scope

- **Multi-registry simultaneous use** — running canonical + private at once is not on the roadmap.
- **Arbitrary public-URL registry switching for unauth'd users** — collapsed into M4 (only auth'd users point at non-canonical repos). Users without auth get the canonical registry plus their own additions.
- **Authoring/PR flows** — the app doesn't yet commit edits back to a repo. May land in a future milestone.
- **Windows / Linux distribution** — `package:win` exists but is untested; no Linux target. Not blocking the persona work.
