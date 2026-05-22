# Pull updates into the registry

The **Pull from `<repo>`** button in the header pulls the latest content from your linked GitHub registry into your local bank. Bundled-default users (no linked repo) refresh against the curated bank through the same diff-before-apply path; the button label changes but the underlying flow is identical.

Independent of pull, the **Check for updates** button probes each skill's authoritative GitHub **Origin** for newer content — useful for harvested skills whose upstreams live in third-party repos, not in your linked registry. Surfaces available updates as chips on individual cards; does not download anything until you click the chip.

## Steps

1. Click **Pull from `<repo>`** (or, on the curated default, the equivalent refresh action) in the header.
2. The app fetches the upstream tarball, computes a diff against your local copy, and applies the merge with `applyCanonicalSync`.
3. The **Sync banner** above the tabs reports the result: `N skills updated`, `M conflicts pending`, `K no longer in source repo`. Counts are informational — no destructive action runs against your local copies.
4. If there are name collisions (your local copy and the upstream version diverge), a **Resolve sync collisions** modal opens. Pick one of:
   - **Keep mine** — your local copy wins. The upstream version is discarded.
   - **Use upstream (replaces mine)** — the upstream version wins. Your local copy is overwritten.
   - **Rename mine to `<name>-local`** — both are kept; your local one is renamed.
5. The app remembers your decision per-skill, so the same collision doesn't reappear on the next pull.

## What pull touches

Pull is **upsert** plus reporting:

- **Refreshed** — skills with `syncedFromCommit` set (any prior pull, curated or linked-repo). Content matches upstream after pull.
- **Never touched** — skills with no `syncedFromCommit`. Anything you authored or brought in via Register / Install-from-GitHub stays exactly as it was.
- **Reported as "no longer in source repo"** — local skills that previously came from a pull but are no longer in the current upstream discovery. The system never auto-deletes them; the count is informational so you can decide to remove them yourself.

## When to pull

There's no schedule — pull is manual. Run it when:

- You want updates from your linked registry.
- After updating the app itself (registry contents and app binaries are independent — a new app version doesn't auto-pull).
- Before sharing your registry with a teammate, to make sure everyone is on the same upstream baseline.

## App updates vs registry updates

These are independent paths:

- **App** auto-updates via the GitHub Releases feed. The "Restart" toast applies a downloaded update.
- **Registry** updates only when you click Pull.

You can update one without the other.

## Importing a registry from elsewhere

Two modes (Account modal):

- **Import a registry (replace)…** — point the app at a different folder; the active registry root is swapped. Use when you're switching to a different upstream entirely or restoring from a fresh `git clone`.
- **Merge a registry into mine…** — additive. Scans the picked folder's `skills/`, adds non-colliding entries to your active registry, and surfaces collisions through the same modal Pull uses (default: keep yours). Merged-in skills are marked `source: user` — they're functionally identical to skills you authored locally.

Both modes accept any folder with a `skills/` subdirectory.

Separately, **Import manifest** pulls a v3 `registry-manifest.json` and re-fetches each skill's content from its **Origin**. See [`packages/core/src/manifest.ts`](../../packages/core/src/manifest.ts) for the schema.
