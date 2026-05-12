# Register a skill into the bank

You installed a skill from somewhere else (e.g. `npx skills add` or a manual copy). It shows up in the **Installed** tab under **Not registered**. You want Skills Bank to manage it from now on.

## Steps

1. Open the **Installed** tab. Skills you didn't install through this app appear under **Not registered**, with a chip showing the agent dir they live in.
2. Click the card to open the detail drawer.
3. Click **Register**. What happens next depends on the **Move files into Skills Bank on Register** setting (Settings → Registration):
   - **On (default)** — files move into `<repo>/skills/<name>/`, the original agent-dir entry becomes a symlink pointing at the new registry location, and the entry is recorded with `adopted: true`. This is the standard flow.
   - **Off** — files stay where they are. The registry just records the external location; the skill is `adopted: false`. Use this when you actively edit the skill in its own git repo and don't want Skills Bank to move it.
4. Either way, registry metadata is generated (source = `user`, computes publish state).
5. The card moves to the **Registered** section. From now on it behaves like any other registry skill — installable into other agents, taggable, etc.

## Bulk register

Use **Register all** in the section header to make individual selections for every "Not registered" skill in one pass. Each skill is processed sequentially with a progress toast. The dropdown offers **Register** (uses your current setting) and **Skip** (and **Remove** for broken symlinks).

## Adopt vs. symlink-mode

Skills Bank tracks an **Adopted** axis per registry entry:

- **Adopted** — files live under `<repo>/skills/<name>/`. The bank owns the files. Unregistering moves them to your shared agents directory (see [unregister.md](unregister.md)).
- **Not adopted** — files live wherever you registered from. The bank just tracks the external path. Unregistering removes the index entry but leaves origin files untouched.

The choice is controlled globally by the `Move files into Skills Bank on Register` setting. Existing `register-external` entries from before M3 load forward as `adopted: false` registered entries with no migration step.

## What if the same name is already registered?

If you click Register on a skill whose name is already in the registry (typically because the skill is registered AND has stragglers in other agent dirs), the app routes you to the **conflict resolution** flow instead. See [resolve-conflicts.md](resolve-conflicts.md).

## Why register?

Registering buys you:

- **Cross-agent linking** — once registered, install into any other agent dir with one click.
- **Metadata** — tags, descriptions, warnings, validation.
- **Sync safety** (convenience persona) — your `user`-sourced skills are never overwritten by upstream sync.
- **Portability** — committing the registry to git lets you reproduce the same setup on another machine.
