# Login and persona

The first launch shows a one-time setup screen. The choice you make here decides which features the app exposes — but it's not permanent: you can switch any time from the account menu.

![First-launch setup screen with Quick start and Advanced sections](../images/setup.png)

## The two options

### Use the bundled registry *(recommended for most users)*

Skills Bank manages a local copy of the curated registry shipped with the app. You get:

- The full set of curated skills, installable with one click.
- A **Pull updates** button that fetches the latest upstream curated skills while preserving anything you've added or modified.
- The ability to register your own skills alongside the curated ones.
- **Export registry** and **Import a registry** in the account menu — move your registry to another machine or back it up as a zip.

No GitHub auth needed.

### Connect your own registry

For users who want full version control over an independent skill registry they maintain themselves. Skills Bank clones your GitHub repo locally and reads from it. From then on:

- You manage the repo through your normal git workflow (commit, push, PRs, branching, …).
- The app never auto-syncs — your content is yours.
- All other features (install, manage links, register, conflict resolution) work exactly the same as with the bundled registry.
- **Portability is built in** — `git clone` on a new machine reproduces your full registry.

This is not a fork of the app. It's your own repo with a `skills/` directory; the app just reads from it.

You'll be sent through GitHub's OAuth flow to grant repo read access. The app then asks you to pick a repo whose root contains a `skills/` directory.

---

*Want to fork the entire app and ship your own build?* See [self-host.md](../self-host.md). Self-hosting is a developer path, not a runtime option on this screen.

---

See [personas.md](../personas.md) for a full feature-by-feature comparison.

## Switching later

The account menu (top-right of the header) lets you:

- **Sign out of GitHub** — clears the token and persona, sending you back to the LoginScreen.
- **Choose registry repo…** — power persona only; switch which repo backs the registry.
- **Settings…** — defaults like which agents an Install action targets.

## What persists

Persona, GitHub token (if any), and settings are stored in the app's userData folder (`~/Library/Application Support/Skills Bank` on macOS). The registry contents live separately — by default in the same userData area on convenience persona, or in the cloned location on power persona.

For developers iterating on the app, `pnpm run desktop:reset` wipes persona and token; `pnpm run desktop:reset:hard` also wipes the registry. See the README for details.
