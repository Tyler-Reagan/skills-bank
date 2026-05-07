# Resolve conflicts

A skill is **registered** in Skills Bank but another agent dir has a stale or duplicate copy at the same name — a real folder, or a symlink that points somewhere outside the registry. The drawer shows a **Resolve conflicts (N)** button.

## When this happens

Common causes:

- You installed the skill via `npx skills add` into one agent, then later registered it in Skills Bank from a different agent dir.
- An older version of Skills Bank installed real directories instead of symlinks (shouldn't happen on current versions).
- You manually copied a skill into an agent dir.
- You shared `~/.agents/skills` between agents and have leftover entries from before.

## Steps

1. Open the drawer for the registered skill.
2. Click **Resolve conflicts (N)** (the count tells you how many duplicate entries exist).
3. The modal lists each conflict — its path, the agent dir it's in, and the kind (`real-directory` or `foreign-symlink`).
4. For each conflict, choose an action:
   - **Replace with symlink to registry** *(default)* — Delete the duplicate and recreate it as a symlink to `<repo>/skills/<name>/`. The result is a normal Skills Bank installation.
   - **Keep separate** — Skip this one. The duplicate stays where it is. Useful when you have intentional divergence (e.g. a customized fork in one agent dir).
   - **Delete entirely** — Remove the duplicate without creating a symlink. Use when the duplicate is just garbage.
5. Use the bulk shortcuts at the top (**Replace all** / **Delete all** / **Keep all**) for the common case.
6. Click **Apply**. Skills Bank processes each decision sequentially and reports the result.

## Verifying

After resolving, the **Resolve conflicts** button should disappear from the drawer (no more conflicts). The **Manage agent links** modal should show the affected agent dirs as **Linked** rather than **Conflict**.

## Why not auto-resolve?

We never delete files automatically. A "conflict" is potentially work the user placed there on purpose — a manual fork, a one-off override, an experiment. Asking is the only safe default.
