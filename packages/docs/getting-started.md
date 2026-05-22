# Getting started

Skills Bank is a desktop app and CLI for managing [Claude Code](https://claude.ai/code) skills across every AI agent you use. This page gets you from "I downloaded the app" to "I'm using a skill in Claude Code" in five minutes.

## Install

Grab the latest DMG from the [Releases page](https://github.com/Tyler-Reagan/skills-bank/releases):

- `Skills-Bank-<version>-arm64.dmg` for Apple Silicon Macs
- `Skills-Bank-<version>-x64.dmg` for Intel Macs

Open the DMG, drag **Skills Bank** to Applications, then launch from Spotlight. Builds are signed with a Developer ID certificate and notarized through Apple, so Gatekeeper opens them on a normal double-click.

The app auto-updates by polling the GitHub Releases feed on launch — when a new version is downloaded in the background, you'll see a "Restart" toast.

## First launch

On first launch you pick a starting point:

![First-launch onboarding screen](/images/setup.png)

- **Use the public skills bank** — browse and install from the curated `Tyler-Reagan/skills-bank` repo. No GitHub account needed. Refresh pulls the latest at the unauthenticated GitHub rate limit (60/hr).
- **Connect with GitHub** — sign in via Device Flow. After signing in you pick a repo to back your registry. The curated bank is pre-listed as **Recommended** (same content, 5000/hr rate limit); or pick any repo of your own to host your own registry.

Either way, the app boots into the Registry tab once you've picked. You can change your mind any time from **Account → Change linked repo**.

Want to fork the entire app and ship your own build? See [Self-hosting](/self-host).

## Install a skill

![The Registry tab — the default view](/images/registry.png)

1. Open the **Registry** tab (it's the default).
2. Click any card to open the detail dialog.
3. Click **Install**. Skills Bank symlinks the skill into every agent directory you have set up — `~/.claude/skills/`, `~/.cursor/skills/`, etc.
4. Restart Claude Code (or Cursor, Gemini, …). The new skill is available next session.

Want to install only into specific agent directories instead of all of them? Open the account menu → **Settings…** → set **Default install agents**.

## See everything that's installed

Open the **Installed** tab. You'll see two sections:

![The Installed tab with Registered and Not registered sections](/images/installed.png)

- **Registered** — skills installed via Skills Bank (or otherwise linked to the registry)
- **Not registered** — skills installed by other tools (e.g. `npx skills add` from [skills.sh](https://skills.sh/))

Click any "Not registered" card to manage it: register it into Skills Bank, link it into other agents, or fix broken links.

## Next steps

- [Concepts](/concepts) — terms you'll see throughout the app (registry, linked repo, source, agent dir).
- [Guides](/guides/install) — task-oriented walkthroughs for installing, registering, syncing, and resolving conflicts.
- [Keyboard shortcuts](/reference/keyboard) — keyboard shortcuts reference.
- [Troubleshooting](/reference/troubleshooting) — common problems and how to recover.
