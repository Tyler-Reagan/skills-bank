# Troubleshooting

Common problems and how to recover. If you hit something not on this list, [open an issue](https://github.com/Tyler-Reagan/skills-bank/issues).

## "Skill is registered but I see Uninstall instead of Resolve conflicts"

You may be on an older version where this was a bug. Update to the latest build via the [GitHub Releases page](https://github.com/Tyler-Reagan/skills-bank/releases). If you're already up to date, the dialog will show **Resolve conflicts (N)** when there are stragglers — see [Heal bad states](/guides/heal).

## "The Registry tab is empty"

A few causes:

- **Bundled default, first launch in progress** — the registry is being seeded. Wait a moment and click **Refresh**.
- **Linked custom repo with no `skills/` directory** — the chosen repo must have skill folders (each with `SKILL.md`) somewhere it can be walked by convention. Switch repos via Account → **Change linked repo**.
- **Self-host build, missing seed** — see [Self-hosting](/self-host).

If the **Refresh** button is showing in the empty state, click it. The app re-reads the registry from disk.

## "A skill shows a MISSING badge"

The skill's symlink resolves into the registry, but the registry copy isn't on disk. Usually means:

- The registry got moved or deleted out from under the app.
- A GitHub-linked registry switch removed the skill.

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

For packaged-app users, manually delete `~/Library/Application Support/@skills-bank/` to start fresh. (To remove the app itself too, see [Uninstalling Skills Bank](#uninstalling-skills-bank).)

A reset script is also available if you're running from source:

```bash
pnpm reset          # restore the dev app to a first-install state:
                    # wipe ~/.skills-bank-dev/, drop app-installed skills,
                    # and seed a fresh isolated managed registry
```

Set `unset SKILLS_BANK_ROOT` in your shell first if you've been pointing the app at a checkout.

## Uninstalling Skills Bank

"Start fresh" above only clears app state — the app stays installed. To remove Skills Bank **entirely**, use the uninstaller script from a clone of the repo:

```bash
./scripts/uninstall.sh --dry-run    # preview exactly what will be removed
./scripts/uninstall.sh              # do it (prompts for confirmation)
./scripts/uninstall.sh --keep-data  # remove the app but keep your registry/userData
```

It removes the app bundle, the app-managed registry + userData, logs/caches/preferences, the dev-mode redirect dir (`~/.skills-bank-dev/`), and **only** the agent-directory symlinks that point into the Skills Bank registry — your own skills (real directories, or symlinks pointing elsewhere) are left untouched.

> [!WARNING]
> A full uninstall deletes the app-managed registry — the skills in your bank and their content. If your registry isn't pushed to a linked GitHub repo, that's unrecoverable. Run `--dry-run` first, or [move your registry](/guides/manifest) somewhere safe before uninstalling. Use `--keep-data` to remove the app but preserve the registry.

Prefer to do it by hand? Quit the app, drag **Skills Bank** from `/Applications` to the Trash, then delete `~/Library/Application Support/@skills-bank/` and `~/Library/Caches/com.tyler-reagan.skills-bank*`. The leftover agent symlinks under `~/.claude/skills/`, `~/.cursor/skills/`, etc. will be broken afterward — remove the broken ones (the script does this for you).

## "A skill keeps showing EDITED after I run it"

A skill that installs dependencies or writes output into its own folder at runtime (e.g. a `node_modules/` it populates on first use) used to drift to `EDITED` because those generated files changed the folder's content hash. As of **v1.15.0**, drift detection honors the skill's own `.gitignore`, so anything the skill ignores no longer counts as an edit. If you're on v1.15.0+ and still see this, confirm the generated paths are actually listed in the skill's `.gitignore`; only ignored paths are excluded.

## "Sync conflict modal keeps appearing for the same skill"

Decisions are remembered per-skill. If the modal reappears, the upstream version of the skill changed again after your last decision — that's a _new_ conflict, not a stale one. Pick again; the new decision sticks until upstream changes once more.

## Reporting a bug

Include:

- App version (Account → About this app).
- Registry source: bundled default vs linked custom repo (Account → Registry source).
- Steps to reproduce.
- The contents of `~/Library/Logs/Skills Bank/main.log` if relevant.

File at the [GitHub Issues page](https://github.com/Tyler-Reagan/skills-bank/issues).
