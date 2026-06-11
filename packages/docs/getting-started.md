# Getting started

Skills Bank is a desktop app for managing [Claude Code](https://claude.ai/code) skills across every AI agent you use. This page gets you from "I downloaded the app" to "I'm using a skill in Claude Code" in five minutes.

## Install

Grab the latest DMG from the [Releases page](https://github.com/Tyler-Reagan/skills-bank/releases):

- `Skills-Bank-<version>-arm64.dmg` for Apple Silicon Macs
- `Skills-Bank-<version>-x64.dmg` for Intel Macs

Open the DMG, drag **Skills Bank** to Applications, then launch from Spotlight. Builds are signed with a Developer ID certificate and notarized through Apple, so Gatekeeper opens them on a normal double-click.

The app auto-updates by polling the GitHub Releases feed on launch — when a new version is downloaded in the background, you'll see a "Restart" toast.

## First launch

The app boots straight into the **Registry** tab backed by the curated `Tyler-Reagan/skills-bank` repo — no account needed. You can sign in with GitHub any time from the Account panel to get 5000 requests/hr and link your own registry repo.

Want to fork the entire app and ship your own build? See [Self-hosting](/self-host).

## Install a skill

<!-- STALE SCREENSHOT (re-capture): current registry.png is a dev build ("Skills Bank (Dev)") showing a 1-skill registry with no category grouping. Re-shoot from a packaged build with a populated registry showing the collapsible category sections (Frontend, Backend, …) added in v1.14.0. -->

![The Registry tab — the default view](/images/registry.png)

1. Open the **Registry** tab (it's the default).
2. Click any card to open the detail dialog.
3. Click **Install**. Skills Bank symlinks the skill into every agent directory you have set up — `~/.claude/skills/`, `~/.cursor/skills/`, etc.
4. Restart Claude Code (or Cursor, Gemini, …). The new skill is available next session.

Want to install only into specific agent directories instead of all of them? Open the account menu → **Settings…** → set **Default install targets**.

## See everything that's installed

Open the **Installed** tab. You'll see two sections:

![The Installed tab with Registered and Unregistered sections](/images/installed.png)

- **Registered** — skills installed via Skills Bank (or otherwise linked to the registry)
- **Unregistered** — skills installed by other tools (e.g. `npx skills add` from [skills.sh](https://skills.sh/))

Click any "Unregistered" card to manage it: register it into Skills Bank, link it into other agents, or fix broken links.

## Organize with labels

The Registry tab groups skills into collapsible category sections — Frontend, Backend, AI Tooling, and [more](/reference/labels). Skills with no category assigned appear together under **Uncategorized** until you label them.

Click **Manage Labels** in the Registry toolbar to assign or bulk-edit labels across your registry. The **Auto-Generate Labels** flow inside that modal suggests a category and tags for each skill based on its name and description — you review and confirm before anything is saved. You can also edit any skill's category and tags directly from its detail drawer.

## Next steps

- [Concepts](/concepts) — terms you'll see throughout the app (registry, linked repo, source, agent dir, labels).
- [Skill labels](/reference/labels) — full reference for all 15 categories and 34 tags.
- [Sign in with GitHub](/guides/sign-in) — link your own repo as your registry source and get 5000 requests/hr.
- [Move your registry](/guides/manifest) — push a manifest snapshot to your GitHub repo, or pull it on another machine.
- [Keyboard shortcuts](/reference/keyboard) — keyboard shortcuts reference.
- [Troubleshooting](/reference/troubleshooting) — common problems and how to recover.
