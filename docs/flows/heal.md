# Heal a skill in a bad state

Skills can land in states where the registry, on-disk files, and agent symlinks disagree. The detail drawer surfaces a single primary action per bad state with explanatory copy when there's only one reasonable recovery, or a multi-option modal when several are legitimate.

Every heal flow is the user's call — Skills Bank never auto-deletes content that might be intentional.

## The bad states

| State | Trigger | Primary heal |
|---|---|---|
| **registered-conflicts** | Registered skill has a duplicate copy (real dir or foreign symlink) in another agent dir. | Resolve conflicts modal (per-row choices). |
| **registered-broken** | Registered skill has at least one broken symlink and no working `ours` copy. | Try repair (find a usable source); fall back to delete-broken. |
| **registered-mixed-broken** | Registered + working symlinks AND broken symlinks. | Repair the broken ones; the working ones stay. |
| **unregistered-conflicts** | Multiple non-`ours` copies of the same skill name exist across agents (registration ambiguous). | Pick the canonical copy via the registration-conflict modal, then register. |
| **unregistered-broken** | Only broken-symlink copies exist for this name. Dead reference. | Delete the broken link. |
| **canon-drift** | Local copy of a canonical skill differs from the synced baseline. | Two arms, both clear the badge: **Accept local changes** detaches from Sync (skill becomes user-authored, sync stops overwriting); **Take canonical** re-baselines the current state as the new synced version (drift clears, sync still owns the skill and can overwrite on the next pull). |
| **registry-folder-missing** | Adopted entry's `<repo>/skills/<name>/` folder is gone on disk. | **Forget this entry** — drops the registry record. |
| **external-target-missing** | Non-adopted (symlink-mode) entry's external path is gone. | **Forget this entry** — drops the external.json row. (Repointing the target is future work.) |

## How heal flows are surfaced

- **Single reasonable option**: the drawer renders one heal button with explanatory copy beneath it (no modal). Today this covers canon-drift, registry-folder-missing, and external-target-missing.
- **Multiple reasonable options**: the drawer opens a modal where the user makes per-row choices. Today this covers registered-conflicts and unregistered-conflicts (per-agent decisions: replace / delete / keep).
- **Hybrid (try-then-confirm)**: the drawer tries the cheap option first, then prompts if it fails. Today this covers broken symlinks: try to repoint at a usable source; if none, ask whether to delete.

The state-machine that picks which heal applies is `classifyDrawerState` in `@skills-bank/core/skill-state` — same module the IPC handlers consult, so the renderer can't bypass an in-flight bad state.

### Conflicts — surfaced through the drawer

The drawer for a `registered-conflicts` skill replaces the usual Manage-agent-links primary action with a **Resolve conflicts** button. The skill card behind the drawer carries a warning state.

![Detail drawer surfacing Resolve conflicts on a registered skill that has stragglers in another agent dir](../images/skill-detail-conflict.png)

Clicking **Resolve conflicts** opens a per-agent modal. Each row shows what's currently at that path (real folder, foreign symlink, broken symlink) and the choice for that row: **Replace** with a symlink to the registry copy, **Delete** the stranger, or **Keep** as-is (and skip linking that agent).

![Resolve conflicts modal — per-row choices: replace with our symlink, delete the stranger, or keep as-is](../images/resolve-conflict.png)

### Canon drift — surfaced through the drawer

The drawer for a `canon-drift` skill replaces the usual destructive area with two heal buttons — **Accept local changes** and **Take canonical** — under explanatory copy. The card carries the `DRIFT` badge. Both buttons clear the badge; the difference is *which copy survives*: Accept local detaches the skill from Sync (becomes user-authored), while Take canonical re-baselines the synced hash so Sync still owns the skill and the next pull may overwrite the local edits.

*Screenshot deferred — capture by editing a canonical skill's `SKILL.md` in the app's data dir (`~/Library/Application Support/@skills-bank/desktop/registry/skills/<name>/`) and refreshing the Registry tab.*

## Why not auto-resolve?

A "bad state" is often work the user placed somewhere on purpose — a manual fork, a one-off override, an experiment. The taxonomy plan calls this out explicitly: present choices when several are reasonable; force the single option with an explanation banner when there's only one. Skills Bank never silently mutates content under either path.
