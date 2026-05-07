# Register a skill into the bank

You installed a skill from somewhere else (e.g. `npx skills add` or a manual copy). It shows up in the **Installed** tab under **Not registered**. You want Skills Bank to manage it from now on.

## Steps

1. Open the **Installed** tab. Skills you didn't install through this app appear under **Not registered**, with a chip showing the agent dir they live in.
2. Click the card to open the detail drawer.
3. Click **Register**. The app:
   - Moves the skill's files into `<repo>/skills/<name>/`.
   - Replaces the original agent-dir entry with a symlink to the new registry location.
   - Generates registry metadata (source = `user`, computes publish state).
4. The card moves to the **Registered** section. From now on it behaves like any other registry skill — installable into other agents, taggable, etc.

## Bulk register

Use **Register all** in the section header to register every "Not registered" skill in one pass. Each skill is processed sequentially with a progress toast.

## What if the same name is already registered?

If you click Register on a skill whose name is already in the registry (typically because the skill is registered AND has stragglers in other agent dirs), the app routes you to the **conflict resolution** flow instead. See [resolve-conflicts.md](resolve-conflicts.md).

## Why register?

Registering buys you:

- **Cross-agent linking** — once registered, install into any other agent dir with one click.
- **Metadata** — tags, descriptions, warnings, validation.
- **Sync safety** (convenience persona) — your `user`-sourced skills are never overwritten by upstream sync.
- **Portability** — committing the registry to git lets you reproduce the same setup on another machine.
