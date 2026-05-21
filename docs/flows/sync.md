# Sync the registry

The **Sync skills** button in the header pulls the latest bundled skills from upstream into your local registry. Available when the registry source is local-bundled (the default). Once GitHub-linked mode lands, users on that path manage updates through their own git workflow instead.

## Steps

1. Click **Sync skills** in the header.
2. The app fetches the upstream registry index, computes a diff against your local copy, and applies it.
3. A toast summarizes what changed: `N added · N updated · N skipped`.
4. If there are name collisions (same skill name, different content for `bundled` and your local `yours` skill), a **Resolve sync collisions** modal opens. Pick one of:
   - **Keep mine** — your local copy wins. The upstream version is discarded.
   - **Use bundled (replaces mine)** — the upstream version wins. Your local copy is overwritten.
   - **Rename mine to `<name>-local`** — both are kept; your local one is renamed.
5. The app remembers your decision per-skill, so the same collision doesn't reappear on future syncs.

## What sync touches

Sync is **upsert**:

- **Refreshed** — skills with `source: "curated"`. Their content matches upstream after sync.
- **Never touched** — skills with `source: "user"`. Anything you authored or brought in stays exactly as it was.
- **Removed** — bundled skills that disappear from upstream are deleted locally. Your local-authored skills are never deleted by sync.

Sync also refreshes the internal bundled-name snapshot: the set of names the upstream currently considers part of the bundled set. The app uses this to decide which skills get destructive-action protection. Switching to a different registry replaces the snapshot — bundled-ness is always evaluated against the active linked repo, never carried over from a previous one.

## When to sync

There's no schedule — sync is manual. Run it when:

- You want updates to bundled skills.
- After updating the app itself (registry contents and app binaries are independent — a new app version doesn't auto-sync the registry).
- Before sharing your registry with a teammate, to make sure everyone is on the same upstream baseline.

## App updates vs registry updates

These are independent paths:

- **App** auto-updates via the GitHub Releases feed. The "Restart" toast applies a downloaded update.
- **Registry** updates only when you click Sync.

You can update one without the other.

## Importing a registry from elsewhere

Two modes (account menu):

- **Import a registry (replace)…** — point the app at a different folder; the active registry root is swapped. Use when you're switching to a different upstream entirely or restoring from a fresh `git clone`.
- **Merge a registry into mine…** — additive. Scans the picked folder's `skills/`, adds non-colliding entries to your active registry, and surfaces collisions through the same modal Sync uses (default: keep yours). Merged-in skills are marked `source: user` — they're functionally identical to skills you authored locally and won't become part of the bundled set under your active registry.

Both modes accept any folder with a `skills/` subdirectory. The merge path is the right fit when you want to bring a handful of skills from another registry (say, a coworker's export) into your active set without rebasing your whole layout.
