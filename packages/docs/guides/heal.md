# Heal bad states

Skills can land in states where the registry, on-disk files, and agent symlinks disagree. The detail dialog surfaces a single primary action per bad state with explanatory copy when there's only one reasonable recovery, or a multi-option modal when several are legitimate.

Every heal flow is the user's call — Skills Bank never auto-deletes content that might be intentional.

## Bad states reference

| State                       | Trigger                                                                                   | Primary heal                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Install collision**       | Registered skill has a duplicate copy (real dir or foreign symlink) in another agent dir. | Resolve install collision modal (per-row choices: replace with symlink, delete, keep). |
| **registered-broken**       | Registered skill has at least one broken symlink and no working `ours` copy.              | Try repair (find a usable source); fall back to delete-broken.                         |
| **registered-mixed-broken** | Registered + working symlinks AND broken symlinks.                                        | Repair the broken ones; the working ones stay.                                         |
| **Tracking ambiguity**      | Multiple non-`ours` copies of the same skill name exist across agents.                    | Pick the right copy via the resolve modal, then register.                              |
| **unregistered-broken**     | Only broken-symlink copies exist for this name. Dead reference.                           | Delete the broken link.                                                                |
| **registry-folder-missing** | Adopted entry's `<repo>/skills/<name>/` folder is gone on disk.                           | **Forget this entry** — drops the registry record.                                     |
| **external-target-missing** | Non-adopted (symlink-mode) entry's external path is gone.                                 | **Forget this entry** — drops the external row.                                        |

## How heal flows are surfaced

- **Single reasonable option**: the dialog renders one heal button with explanatory copy beneath it (no modal). Covers registry-folder-missing and external-target-missing.
- **Multiple reasonable options**: the dialog opens a modal where the user makes per-row choices. Covers install collisions and tracking ambiguity (per-agent decisions: replace / delete / keep).
- **Hybrid (try-then-confirm)**: the dialog tries the cheap option first, then prompts if it fails. Covers broken symlinks: try to repoint at a usable source; if none, ask whether to delete.

### Install collisions

The dialog for an install collision replaces the usual Manage-agent-links primary action with a **Resolve install collision** button. The skill card behind the dialog carries a warning state.

<!-- SCREENSHOT NEEDED: Detail dialog surfacing Resolve install collision on a registered skill that has stragglers in another agent dir. -->

Clicking **Resolve install collision** opens a per-agent modal. Each row shows what's currently at that path (real folder, foreign symlink, broken symlink) and the choice for that row: **Replace** with a symlink to the registry copy, **Delete** the stranger, or **Keep** as-is (and skip linking that agent).

<!-- SCREENSHOT NEEDED: Resolve install collision modal — per-row choices: replace with our symlink, delete the stranger, or keep as-is. -->

## Conflict vocabulary

Three distinct collision types use distinct labels:

- **Incoming update conflict** — your local and the upstream both have a skill with the same name and different content. Resolved via the **Incoming update conflicts** modal after a Pull run.
- **Install collision** — a registered skill has a real-directory or foreign-symlink copy in an agent dir. Resolved via the **Resolve install collision** modal from the dialog.
- **Tracking ambiguity** — multiple non-ours copies of the same name across agents; registration is unclear. Resolved via the same modal, with the symlink-replace action hidden.

## Why not auto-resolve?

A "bad state" is often work the user placed somewhere on purpose — a manual fork, a one-off override, an experiment. Skills Bank presents choices when several are reasonable; forces the single option with an explanation banner when there's only one. It never silently mutates content under either path.

## See also

- [Manage agent links](/guides/manage-links) — add or remove per-agent symlinks without touching registry files.
- [Unregister a skill](/guides/unregister) — remove a registry entry and optionally expel its files.
- [Pull registry updates](/guides/sync) — the sync flow that surfaces incoming update conflicts.
