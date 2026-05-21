# Troubleshooting

Common problems and how to recover. If you hit something not on this list, open an issue.

## "Skill is registered but I see Uninstall instead of Resolve conflicts"

You may be on an older version where this was a bug. Update to the latest build via the GitHub Releases page. If you're already up to date, the dialog will show **Resolve conflicts (N)** when there are stragglers — see [flows/heal.md](flows/heal.md).

## "The Registry tab is empty"

A few causes:

- **Bundled default, first launch in progress** — the registry is being seeded. Wait a moment and click **Refresh**.
- **Linked custom repo with no `skills/` directory** — the chosen repo must have skill folders (each with `SKILL.md`) somewhere it can be walked by convention. Switch repos via Account → **Change linked repo**.
- **Self-host build, missing seed** — see [self-host.md](self-host.md).

If the **Refresh** button is showing in the empty state, click it. The app re-reads the registry from disk.

## "A skill shows a MISSING badge"

The skill's symlink resolves into the registry, but the registry copy isn't on disk. Usually means:

- The registry got moved or deleted out from under the app.
- A GitHub-linked registry switch removed the skill (when Bundle 3 lands).

Recovery: open the dialog → **Fix broken link(s)**. The repair flow either re-links the skill to a present registry copy or removes the broken symlinks.

## "Reveal in Finder does nothing"

The button is disabled when the path it would open doesn't exist (e.g. for synthetic placeholder cards). If you expect a file but the button is greyed out, the underlying path is broken — see the MISSING-badge section above.

## "I authorized GitHub but no repos show up"

The OAuth scopes the app requests give you read access to repos you can already see. If a repo you expect is missing:

- Check it's not archived.
- Check the org allows third-party OAuth apps (some orgs disable this by default).
- Sign out (account menu → **Sign out of GitHub**) and re-authorize.

## "Auto-update never triggers"

The app polls the GitHub Releases feed once on launch. If you've been running the app for hours and there's a new release, quit and relaunch — the poll runs at startup.

## "I want to start fresh"

Two reset scripts wipe local state (developer-oriented, but available to anyone running from source):

```bash
pnpm reset          # clear dev-mode userData (registry source choice + auth token)
pnpm reset:hard     # also wipe the app-managed registry directory (and re-seed)
```

Both handle dev-mode and packaged userData paths. Set `unset SKILLS_BANK_ROOT` in your shell first if you've been pointing the app at a checkout.

For packaged-app users without a checkout, manually delete `~/Library/Application Support/Skills Bank` to start fresh.

## "Sync conflict modal keeps appearing for the same skill"

Decisions are remembered per-skill. If the modal reappears, the upstream version of the skill changed again after your last decision — that's a _new_ conflict, not a stale one. Pick again; the new decision sticks until upstream changes once more.

## Reporting a bug

Include:

- App version (Account → About this app).
- Registry source: bundled default vs linked custom repo (Account → Registry source).
- Steps to reproduce.
- The contents of `~/Library/Logs/Skills Bank/main.log` if relevant.

File at the project's GitHub Issues page.
