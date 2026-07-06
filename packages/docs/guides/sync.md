# Pull registry updates

The **Pull from `<repo>`** button in the header pulls the latest content from your linked GitHub repo into your local bank. Bundled-default users (no linked repo) refresh against it through the same diff-before-apply path; the button label changes but the underlying flow is identical.

Independent of pull, the **Check for updates** button probes each skill's authoritative GitHub **Origin** for newer content — useful for harvested skills whose upstreams live in third-party repos, not in your linked repo. Surfaces available updates as chips on individual cards; does not download anything until you click the chip.

## Steps

1. Click **Pull from `<repo>`** in the header.
2. The app fetches the upstream tarball, computes a diff against your local copy, and applies the merge.
3. The **Sync banner** above the tabs reports the result: `N skills updated`, `M conflicts pending`, `K no longer in source repo`. Click **Details** to expand a list of exactly which skills refreshed and which are no longer in the source repo. The banner auto-dismisses after 5 seconds if you don't interact with it; error and conflict banners stay until you act.
4. If any skills changed in both your local registry and the incoming update, an **Incoming update conflicts** modal opens. Pick one of:
   - **Keep mine** — your local version stays; the incoming update for that skill is skipped.
   - **Use incoming (replaces mine)** — the incoming version replaces yours. Your local changes are lost.
   - **Rename mine to `<name>-local`** — your version moves to a new name; the incoming version takes the original. Both are kept.
5. The app remembers your decision per-skill, so the same conflict won't appear again unless the upstream changes.

## What pull touches

Pull is **upsert** plus reporting:

- **Refreshed** — skills with `syncedFromCommit` set (any prior pull, curated or linked-repo). Content matches upstream after pull.
- **Never touched** — skills with no `syncedFromCommit`. Anything you authored or brought in via Register stays exactly as it was.
- **Reported as "no longer in source repo"** — local skills that previously came from a pull but are no longer in the current upstream. The system never auto-deletes them; the count is informational so you can decide to remove them yourself.

## When to pull

Pull is manual. Run it when:

- You want updates from your linked repo.
- After updating the app itself (registry contents and app binaries are independent — a new app version doesn't auto-pull).
- Before sharing your registry with a teammate, to make sure everyone is on the same upstream baseline.

## App updates vs registry updates

These are independent paths:

- **App** auto-updates via the GitHub Releases feed. The "Restart" toast applies a downloaded update.
- **Registry** updates only when you click Pull.

You can update one without the other.

## Importing from elsewhere

Pull only refreshes skills already in your registry against their existing origin. To bring in a whole different registry's worth of skills, use the manifest flow instead — see [Move your registry](/guides/manifest).
