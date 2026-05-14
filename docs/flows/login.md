# Registry source

Skills Bank picks a registry source — the place where your skills physically live — when it launches. As of the provenance-reframe release, that decision is no longer a first-launch fork: every install lands on the bundled registry by default, and linking a GitHub repo is an opt-in mode available later from Settings or the account menu.

## Default: Local bundled

On first launch the app materializes a local registry at `~/Library/Application Support/Skills Bank/registry/` and seeds it with the curated bundled skills. You get:

- The full set of bundled skills, installable with one click.
- A **Sync skills** button that fetches the latest upstream bundled skills while preserving anything you've added or modified.
- The ability to register your own skills alongside the bundled ones.
- **Export registry** and **Import a registry** in the account menu — move your registry to another machine or back it up as a zip.

No GitHub auth required. This is the path the rest of the docs assume unless otherwise noted.

## Link a GitHub repo (Coming soon)

A future release will let you back your registry with a GitHub repo you own. Until that lands, the entry-point shows a **Coming soon** label in two places:

- Account menu → **Link a GitHub repo… (Coming soon)**
- Settings → **Registry source** → **Link a GitHub repo… (Coming soon)** radio

Both open a small dialog explaining the feature direction and linking to the full plan at [`docs/plans/03-github-backed-mode.md`](../plans/03-github-backed-mode.md).

## Self-host

Self-hosting is a developer path: fork the app, ship your own build. See [`self-host.md`](../self-host.md). Not a runtime option from the UI.

## What persists

Registry source, GitHub token (if any, once linked-mode lands), and settings are stored in the app's userData folder (`~/Library/Application Support/Skills Bank` on macOS). The registry contents live alongside, under the same userData area.

For developers iterating on the app, `pnpm run desktop:reset` wipes the stored registry-source choice and token; `pnpm run desktop:reset:hard` also wipes the registry. See the README for details.
