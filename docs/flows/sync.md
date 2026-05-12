# Sync the registry (convenience persona)

The **Sync skills** button in the header pulls the latest curated skills from upstream into your local registry. Available only on the convenience persona — power-persona users maintain their own repo.

## Steps

1. Click **Sync skills** in the header.
2. The app fetches the upstream registry index, computes a diff against your local copy, and applies it.
3. A toast summarizes what changed: `N added · N updated · N skipped`.
4. If there are name collisions (same skill name, different content for `canonical` and your local `user`/`imported` skill), a **Resolve sync conflicts** modal opens. Pick one of:
   - **Keep mine** — your local copy wins. The upstream version is discarded.
   - **Take upstream** — the upstream version wins. Your local copy is overwritten.
   - **Rename mine to `<name>-local`** — both are kept; your local one is renamed.
5. The app remembers your decision per-skill, so the same conflict doesn't reappear on future syncs.

## What sync touches

Sync is **upsert**:

- **Refreshed** — skills with `source: "canonical"`. Their content matches upstream after sync.
- **Never touched** — skills with `source: "user"` or `source: "imported"`. Anything you authored or brought in stays exactly as it was.
- **Removed** — canonical skills that disappear from upstream are deleted locally. Your local-authored skills are never deleted by sync.

Sync also refreshes the **canon snapshot**: the set of names the upstream registry currently considers canonical. The app uses this to decide which skills are protected from unregister/delete in the UI. Switching to a different registry replaces the snapshot — canon is always evaluated against the active linked repo, never carried over from a previous one.

## When to sync

There's no schedule — sync is manual. Run it when:

- You want updates to canonical skills.
- After updating the app itself (registry contents and app binaries are independent — a new app version doesn't auto-sync the registry).
- Before sharing your registry with a teammate, to make sure everyone is on the same upstream baseline.

## App updates vs registry updates

These are independent paths:

- **App** auto-updates via the GitHub Releases feed. The "Restart" toast applies a downloaded update.
- **Registry** updates only when you click Sync.

You can update one without the other.
