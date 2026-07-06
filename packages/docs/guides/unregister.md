# Unregister a skill

Backs a registered skill out of Skills Bank without deleting its files. Unregister is the mid-tier destructive action: it removes the registry entry and (for adopted skills) moves files out to your shared agents directory. Distinct from **Manage agent links** (which only adds or removes symlinks) and **Delete from this machine** (which deletes files).

## Steps

1. Open the skill's detail dialog from any tab.
2. Click **Unregister** (below **Reveal in Finder** in the dialog). Deleting files is a separate step — **Delete from this machine** — available in the **Installed → Unregistered** section after you unregister.
3. What happens next depends on the **Adopted** axis:
   - **Adopted skill** — files move from `skills/personal/<name>/` in your registry root to `~/.agents/skills/<name>/` by default. Agent-dir symlinks that pointed at the old bank location are rewritten to point at the new location, so installed agents keep working.
   - **Non-adopted (symlink-mode) skill** — just the registry index entry is removed. Origin files stay where they were; any symlinks to origin keep working.
4. A toast confirms the move. The first time you unregister an adopted skill, the toast also points you at the destination setting.

## Changing where files move

Settings → **Unregister sends files to**. Defaults to **Agents (shared)** which maps to `~/.agents/skills/`. You can pick any of the per-tool agent directories instead; Skills Bank moves files there on the next unregister. Non-adopted skills ignore this setting (their files don't move).

## Why unregister vs. delete?

Unregister sits between **Manage agent links** (touches symlinks only) and **Delete** (destroys files) on the [destructive-action ladder](/concepts#destructive-action-ladder). Use it when you want to stop Skills Bank from managing a skill but keep the files around — to hand the skill off to another tool, edit it directly outside of Skills Bank, or audit it before deletion. Delete is the bottom rung and requires unregistering first; once unregistered, the skill appears in **Installed → Unregistered** with an inline **Delete** button (confirmation required).

## Canon skills

Unregistering a curated skill is prohibited — the upstream owns it. Use **Dismiss from registry view** instead to keep the skill installed but out of the default Browse surface.

## See also

- [Register a skill](/guides/register) — the reverse: add an externally-installed skill to the registry.
- [Manage agent links](/guides/manage-links) — add or remove symlinks without touching registry files.
- [Heal bad states](/guides/heal) — recovery flows for conflicts, broken links, and missing files.
