# Login and persona

The first launch shows a one-time setup screen. The choice you make here decides which features the app exposes — but it's not permanent: you can switch any time from the account menu.

![First-launch setup screen with Quick start and Advanced sections](../images/setup.png)

## The three options

The screen has two sections: **Quick start** and **Advanced**.

### Quick start: Use the bundled registry

The recommended path for most people. Skills Bank manages a local copy of the curated registry shipped with the app. You get:

- The full set of curated skills available to install with one click.
- A **Sync skills** button that pulls upstream updates while preserving anything you've added.
- The ability to register your own skills alongside the curated ones.

No GitHub auth needed.

### Advanced: Connect a GitHub registry

For users who want the registry to be a GitHub repo of their own. Skills Bank clones your repo into the local registry location and treats its contents as `imported`. From then on:

- You maintain the repo through your normal git workflow (push, PRs, branching, …).
- The app's auto-sync is **off** — Skills Bank never overwrites your repo.
- All other features (install, manage links, register, conflict resolution) work the same.

You'll be sent through GitHub's OAuth flow to grant repo read access. The app then asks you to pick a repo whose root contains a `skills/` directory.

### Advanced: Self-host

For users who want to fork the entire app. See [self-host.md](../self-host.md) for the build instructions.

## Switching later

The account menu (top-right of the header) lets you:

- **Sign out of GitHub** — clears the token and persona, sending you back to the LoginScreen.
- **Choose registry repo…** — power persona only; switch which repo backs the registry.
- **Settings…** — defaults like which agents an Install action targets.

## What persists

Persona, GitHub token (if any), and settings are stored in the app's userData folder (`~/Library/Application Support/Skills Bank` on macOS). The registry contents live separately — by default in the same userData area on convenience persona, or in the cloned location on power persona.

For developers iterating on the app, `pnpm run desktop:reset` wipes persona and token; `pnpm run desktop:reset:hard` also wipes the registry. See the README for details.
