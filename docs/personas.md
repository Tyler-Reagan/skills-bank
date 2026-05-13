# Persona feature comparison

> [!NOTE]
> **In transition.** The first-launch persona fork is being collapsed in a forthcoming release. Every user will start on the bundled registry by default, with GitHub-linking moving to an opt-in Settings affordance available at any time. Detailed first-launch docs will be refreshed once that work ships.

Skills Bank asks you to make a one-time registry choice on first launch. This page explains what that choice means for each feature you'll use day-to-day.

## Quick comparison

|                                    | Bundled registry                                                                                                    | Your own registry                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **What the registry is**           | Curated skill set bundled with and managed by this app                                                              | A GitHub repo you own and maintain independently                                                      |
| **Who maintains it**               | Upstream (you pull updates)                                                                                         | You (via git push, PRs, branches)                                                                     |
| **Where skills live on disk**      | `~/Library/Application Support/Skills Bank/registry/skills/<name>/`                                                 | Wherever your repo is cloned                                                                          |
| **Sync skills**                    | One-click via the Sync skills header button                                                                         | Not applicable — you push changes directly                                                            |
| **Registering an unmanaged skill** | Moves files into the app's local registry; never overwritten by Sync skills                                         | Moves files into your repo's `skills/` directory; commit to persist                                   |
| **Registry maintenance**           | None required — you can add your own skills alongside curated ones                                                  | Full ownership — content, structure, curation                                                         |
| **Already-installed skills**       | Show as Not registered in the Installed tab until you Register them                                                 | Same                                                                                                  |
| **Tags**                           | Local only (stored in `meta.json`); preserved across Sync skills                                                    | Local only; persist by committing `meta.json` changes                                                 |
| **Portability**                    | Machine-local; use Export registry to back up or migrate, or Merge another registry into yours for additive imports | High — `git clone` reproduces the full registry on any machine; Merge into yours for additive imports |

---

## Bundled registry (convenience persona)

**What the registry is.** The curated skill set shipped with this app. It lives under `~/Library/Application Support/Skills Bank/registry/` — a folder the app manages for you. You never need to know it's there.

**How to use it / implications of registering.** Browse the Registry tab and click Install to link skills into your agent directories. If you have skills installed by another tool (e.g. `npx skills add`), they appear in the Installed tab under Not registered. Clicking Register moves those files into the app's local registry, rewrites the agent-dir symlink to point at the new location, and marks them `source: user`. Once registered, a skill is cross-agent linkable and will never be overwritten by Sync skills.

**Scope of registry maintenance.** None. The upstream curated list is maintained for you. You can add your own `user`-sourced skills alongside the curated ones, and Sync skills will never touch them.

**Persistence / where skills live.** Registry-managed skills live under `~/Library/Application Support/Skills Bank/registry/skills/<name>/`. Each installed skill is a symlink from your agent directory (e.g. `~/.claude/skills/<name>`) pointing back to that registry copy.

**How installation works.** Clicking Install creates symlinks in every agent directory you have configured (Claude Code, Cursor, Gemini, etc.). Both symlinks point at the same registry source folder — edits to the skill are immediately visible everywhere without a resync step.

**Impact on already-installed skills.** Skills installed before you first launched this app, or installed via other tools, show up in the Installed tab under Not registered. They work exactly as before; the app just doesn't manage them yet. Register them whenever you want to bring them under Skills Bank's management.

**Tags and their persistence.** Tags are stored in each skill's `meta.json`. They are local to this machine. Sync skills reads your existing tag list before overwriting canonical skill content, so your tag edits survive updates automatically.

**Portability.** The registry lives on this machine only. To move it to another machine: use **Settings menu → Export registry…** to create a `.zip` of the entire `skills/` directory, copy it to the new machine, then use **Import a registry…** to point the app at the extracted folder. Individual skills can also be exported via the skill detail drawer.

---

## Your own registry (power persona)

**What the registry is.** A GitHub repo you own, cloned locally by the app. The app reads from the clone; you manage the repo's contents through your normal git workflow. The app never rewrites or auto-syncs your repo.

**How to use it / implications of registering.** Browse and install skills exactly as with the bundled registry — the Install button works the same way. If you have unmanaged skills in your agent directories, Register moves their files into your repo's `skills/` directory and rewrites the agent-dir symlink. Those files now belong to your git repo; commit and push to persist them.

**Scope of registry maintenance.** Full ownership. You decide what skills exist, how they're structured, and when changes land. There is no upstream to pull from.

**Persistence / where skills live.** Skills live wherever your repo is cloned. If you cloned to `~/code/my-skills-repo`, registry skills live at `~/code/my-skills-repo/skills/<name>/`. Symlinks from agent directories point there.

**How installation works.** Identical to the bundled registry — symlinks from agent dirs to the cloned repo. No copies, no drift.

**Impact on already-installed skills.** Same as the bundled registry — unmanaged skills appear as Not registered in the Installed tab. Registering them moves files into your repo.

**Tags and their persistence.** Tags are stored in `meta.json` in your repo. Since the files are in a git repo, `git commit` is how you persist tag changes across machines or share them with others.

**Portability.** High. `git clone` on a new machine reproduces the full registry. Install Skills Bank, choose "Connect your own registry", pick the same repo, and you're back to the same state.

---

## Switching personas

Open the account menu (top-right of the header) at any time:

- **Bundled registry users**: Choose **Import a registry…** to point the app at a different folder, or sign out to return to the first-launch screen and pick "Connect your own registry".
- **Your own registry users**: Choose **Choose registry repo…** to switch to a different GitHub repo, or sign out to return to the first-launch screen.

Switching persona does not delete your installed agent-dir symlinks — your agents keep working. Only the app's source-of-truth registry changes.

### Canon is repo-relative

The **canon** axis (see [concepts.md](concepts.md#taxonomy)) is evaluated against whichever registry is currently linked:

- **Bundled registry** — canon = the upstream curated name set, refreshed by Sync and persisted alongside the registry.
- **Your own registry** — canon = skills that are committed and reachable from your repo's upstream branch (publishState `pushed`).

Switching repos drops the previous root's canon snapshot and recomputes against the new one. A skill that was canon under repo A is not automatically canon under repo B; if you want it canonical under B, commit it to B.

#### Canon protection: Hide instead of Unregister/Delete

Canon skills are upstream-owned, so unregistering or deleting one locally would be irrecoverable from the UI. The destructive verbs are disabled on canon — the drawer shows **Hide** instead. Hidden canon skills:

- Drop out of the default Browse view.
- Keep their installations, tags, and agent links — Hide is a UI dormancy flag, not an uninstall.
- Are scoped per linked-registry. Switching repos shows that repo's canon fresh, with its own hide list. A skill hidden under repo A is not automatically hidden under repo B.

Manage hidden canon skills via Settings → **Hidden canon skills**. Each row exposes an Unhide button.
