# Register a skill

You installed a skill from somewhere else (e.g. `npx skills add` or a manual copy). It shows up in the **Installed** tab under **Unregistered**. You want Skills Bank to manage it from now on.

## Steps

1. Open the **Installed** tab. Skills you didn't install through this app appear under **Unregistered**, with a chip showing the agent dir they live in.
2. Click the card to open the detail dialog.
3. Click **Register**. What happens next depends on the **Move skill files into Skills Bank when registering** setting (Settings → Behavior):
   - **On (default)** — files move into `skills/personal/<name>/` under your registry root, the original agent-dir entry becomes a symlink pointing at the new registry location, and the entry is recorded with `adopted: true`. This is the standard flow.
   - **Off** — files stay where they are. The registry just records the external location; the skill is `adopted: false`. Use this when you actively edit the skill in its own git repo and don't want Skills Bank to move it.
4. Either way, registry metadata is generated (source = `user`). The skill appears in the Registry tab under **Uncategorized** until you assign a category — use **Manage Labels** in the toolbar or the skill's detail drawer.
5. The card moves to the **Registered** section. From now on it behaves like any other registry skill — installable into other agents, taggable, categorized, etc.

> [!NOTE]
> The **Default install targets** setting in Settings applies during register too — if you've configured specific agents, the registered skill fans out symlinks into only those directories. Override per-skill any time from **Manage agent links…** in the detail dialog.

## Bulk register

Use **Register all** in the section header to make individual selections for every "Unregistered" skill in one pass. Each skill is processed sequentially with a progress toast. The dropdown offers **Register** (uses your current setting) and **Skip** (and **Remove** for broken symlinks).

## Adopt vs. symlink-mode

See [Adopt](/concepts#adopt) in Concepts for the full definition of the axis this setting controls. The reverse direction — backing a skill out of the registry — is the [Unregister flow](/guides/unregister), distinct from **Delete from this machine**, which destroys files outright.

## What if the same name is already registered?

If you click Register on a skill whose name is already in the registry (typically because the skill is registered AND has stragglers in other agent dirs), the app routes you to the conflict-resolution heal flow instead. See [Heal bad states](/guides/heal).

## Why register?

Registering buys you:

- **Cross-agent linking** — once registered, install into any other agent dir with one click.
- **Metadata** — tags, descriptions, warnings, validation.
- **Sync safety** — skills with `source: user` are never overwritten by upstream sync.
- **Portability** — committing the registry to git lets you reproduce the same setup on another machine.
