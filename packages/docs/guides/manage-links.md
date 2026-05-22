# Manage agent links

A registered skill can be linked into any subset of your agent directories. Use the **Manage agent links** action when you want to add the skill to one more agent, drop it from a specific one, or audit exactly where it's live.

## Steps

1. Open the dialog for a registered skill (Registry tab or the **Registered** section of the Installed tab).
2. Click **Manage agent links…**.
3. The modal shows a row per supported agent. Each row is one of:
   - **Linked** — the agent dir has a symlink to the registry copy. A checked checkbox.
   - **Not linked** — the agent dir doesn't have this skill. An unchecked checkbox.
   - **Install collision** — the agent dir has something at this name that _isn't_ a Skills Bank symlink (e.g. a real folder). The row is disabled with a hint pointing at install-collision resolution.

   ![Manage agent links modal — per-agent checkboxes with target paths](/images/manage-links.png)

4. Tick or untick agents to add or remove links. Click **Apply**.
5. Skills Bank creates the missing symlinks and removes the unticked ones. The registry copy is never touched.

## Default agents

If you find yourself ticking the same agents over and over, set them as defaults: account menu → **Settings…** → **Default install agents**. The Install button on the Registry tab uses those defaults instead of broadcasting to every existing dir.

## Why the install-collision rows?

An install collision means there's already a real folder or foreign symlink at that path. Skills Bank refuses to silently overwrite it — that's how you avoid losing work that another tool placed there. Resolve the collision first ([Heal bad states](/guides/heal)) and the row becomes editable.
