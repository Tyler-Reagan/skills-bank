# Browse & install skills

The everyday flow. Browse the **Registry** tab, find a skill, link it into your agents.

![The Registry tab — search, tag filters, and Installed-only toggle](/images/registry.png)

## Steps

1. Open the **Registry** tab (it's the default tab).
2. Skills are grouped into collapsible category sections — **Frontend**, **Backend**, **AI Tooling**, and [more](/reference/labels). Click a section header to expand or collapse it, or use **Collapse all / Expand all** in the results row to fold every section at once. Use the search bar or tag filters to narrow the list further; toggle **Installed only** to filter to skills you've already linked.
3. Click any card to open its detail dialog. The dialog shows the full `SKILL.md` preview, tags, category, source, and any warnings.

   ![Skill detail dialog with SKILL.md preview, Install, Manage agent links](/images/skill-detail.png)

4. Click **Install**.
5. Skills Bank creates a symlink at `<agent-dir>/<skill-name>` for every supported agent directory you have set up. By default, every existing agent dir gets a link.
6. Restart the affected agent (Claude Code, Cursor, …). The skill is available next session.

## Choosing which agents get the link

Open the account menu → **Settings…** → scroll to **Default install agents** and tick the agents you want. From then on, the Install button targets only those directories. Leave all unchecked to keep the default "broadcast to all existing dirs" behavior.

![Settings modal — Default install agents section with per-agent checkboxes](/images/settings.png)

You can override per-skill from the dialog's **Manage agent links…** action — pick exactly which agents this one skill goes into.

## What gets created

For a skill named `my-skill` and agents Claude Code + Cursor:

```
~/.claude/skills/my-skill  →  <repo>/skills/my-skill/
~/.cursor/skills/my-skill  →  <repo>/skills/my-skill/
```

Both symlinks point at the same source folder. Edits to the registry copy are immediately visible to every linked agent — no copy step, no resync.

## Install a skill from the Discover tab

The **Discover** tab embeds [skills.sh](https://skills.sh) — a browsable directory of community skills. When you find one you want, copy its install command (skills.sh shows a copy button on each skill) and paste it directly into the callout bar at the top of the tab.

Two formats are accepted:

- **`npx skills add` command** — the format skills.sh puts on the clipboard:
  ```
  npx skills add https://github.com/owner/repo --skill skill-name
  ```
- **GitHub folder URL** — a direct link to the skill's folder:
  ```
  https://github.com/owner/repo/tree/main/skills/skill-name
  ```

Press **Install** (or Enter). The app fetches the skill into your bank and shows a confirmation flash. The skill then appears in the **Registry** tab under its inferred category — click it there and press **Install** to link it into your agent directories.

## Uninstall

Open the dialog for an installed skill → **Manage agent links…** → untick every agent → **Apply**. The symlinks are removed; the registry copy is left untouched. Reinstall any time without losing changes.

### Selective uninstall

The **Manage agent links** modal drops a skill from a subset of agents while keeping it in the others — just untick the agents you want to remove and leave the rest checked. See [Manage agent links](/guides/manage-links) for the full action.
