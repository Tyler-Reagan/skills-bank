# Taxonomy alignment plan

Aligning the app's state model, operations, and UI around the four-axis skill taxonomy: **Canon**, **Registered**, **Adopted**, **Installed**.

This plan supersedes prior in-flight work in the same scope. Each milestone bundles code + docs; nothing in a later milestone undoes an earlier one.

## The taxonomy

Four orthogonal axes describe every skill the app knows about. Operations and UI gating derive from these, not from ad-hoc per-component checks.

- **Canon** — derived boolean. A skill is canon iff its name appears in the linked registry repo's upstream (the user's own GitHub repo for power persona, our bundled canonical for convenience). Resolved dynamically from the active linked repo, not from stale per-skill markers. Mutating canon requires write access to the linked repo.
- **Registered** — boolean. The skill has an entry in the local registry index. Mutated freely. Holds local-only metadata (tags, adoption flag, install paths).
- **Adopted** — boolean on `RegistryEntry`. When true, skill files physically live under the registry's `skills/<name>/` directory. When false, the registry entry tracks an external location via a sibling pointer (today's `external.json` substrate). Default at register time is controlled by `settings.registerAdopts` (default `true`).
- **Installed** — derived from on-disk scan. A skill is installed if at least one agent dir contains a folder or symlink at `<agentDir>/<name>`. Per-agent kinds: `ours`, `foreign-symlink`, `real-directory`, `broken-symlink`.

Derived semantics:

- Canon ⇒ registered by default; unregister/delete of a canon skill is prohibited. The user-visible escape is **hide**, recorded per registry root.
- Non-canon + registered + uninstalled is a valid state. Re-install requires the original source (no upstream to pull from).
- Registered + has broken/conflicting installations ⇒ heal flow.
- Unregister of an adopted skill expels files to `settings.unregisterDestinationAgent` (default `~/.agents/skills/`). Unregister of a non-adopted (symlink-tracked) skill leaves origin files alone.

Three destructive verbs form an escalation ladder:

| Action                                                       | Files                                                   | Agent symlinks                       | Recovery                                        |
| ------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------ | ----------------------------------------------- |
| Remove from agents (existing uninstall)                      | untouched                                               | removed (selectable per-agent in M7) | reinstall                                       |
| Unregister (new in M4)                                       | adopted: moved to expulsion dir; non-adopted: untouched | removed                              | re-register from new location                   |
| Delete from Skills Bank (existing deregister, renamed in M4) | deleted                                                 | removed                              | canon: re-pull; non-canon: gone (modulo export) |

## Decisions locked

- Hidden-canon list is **per registry root**, stored alongside other registry state.
- Canon-drift means **local diverged from synced commit** (`.skills-bank.json.syncedFromCommit` vs. current folder hash). "Upstream moved" is already handled by Pull updates.
- M4 first-run notification is a **toast with settings link**: "Moved `<name>` to `~/.agents/skills/`. Change destination in Settings."
- M8 merge-import collision modal **defaults to keep-mine**.
- Skill identity = name. Conflict resolution exists.
- Adopt-vs-symlink default is **strictly global** (no per-skill checkbox at register time).
- Linked repo flexibility = existing one-repo-at-a-time. Switching replaces.

## Milestones

Ordered so no milestone undoes prior work; no milestone overlaps another.

### M1 — Data model + classifier extraction (foundation)

**Scope.** Promote `packages/desktop/src/renderer/components/skillState.ts` (`classifyDrawerState` and the capability table) into `@skills-bank/core` as the single source of truth. Extend the classifier input with a `canon: boolean` so future canon-aware states have a home; the function returns the existing 9 states for now. Add `adopted: boolean` to `RegistryEntry`. Add settings keys `registerAdopts` (default `true`) and `unregisterDestinationAgent` (default `"agents"`) with backward-compatible reads. IPC handlers that perform state-mutating operations consult the classifier and refuse when the capability table denies the action.

**Why this first.** Every subsequent milestone reads from or writes to this model. Moving the classifier to core lets the CLI package and the main process enforce invariants instead of trusting renderer-side button hiding.

**Conflict audit.** Does not undo existing UI; `classifyDrawerState`'s public shape is preserved. The renderer keeps importing from `@skills-bank/core` (re-export shim in `skillState.ts` to avoid touching every consumer). New fields default false/conservative so behavior is unchanged until later milestones populate them.

**Docs.** `docs/concepts.md` adds a "Taxonomy" section defining the four axes. No flow doc changes here — flows describe operations that subsequent milestones change.

---

### M2 — Canon resolution against the linked registry

**Scope.** Replace the `.skills-bank.json`-marker-based canon inference with dynamic resolution: a skill is canon iff its name appears in the linked registry repo's upstream index. For convenience persona this is the bundled canonical index; for power persona it's the user's repo HEAD. Cache the upstream name set with a TTL keyed on the linked repo identity so renderer reads are cheap. Sweep `RegistryEntry.canon` into the registry index build.

**Why second.** M1 added the `canon` field but left it `false`. Until canon is correctly populated, M5's invariants would over- or under-prohibit. M2 fills the field correctly.

**Conflict audit.** The existing `source` marker (`canonical` / `user` / `imported`) stays — it records provenance, not current canon. Sync continues to write it. Repo switches now correctly recompute canon (the prior implicit "trust the marker forever" bug becomes a non-issue). No data migration needed.

**Docs.** `docs/personas.md` clarifies that canon is repo-relative. `docs/flows/sync.md` notes that switching personas recomputes canon.

---

### M3 — Register unified around adopt-or-symlink

**Scope.** Collapse `applyRegistration` action types `adopt` and `register-external` into one core op: `registerSkill(name, { adopt })`. When `adopt: true`, files move into `<registryRoot>/skills/<name>` (today's adopt path). When `adopt: false`, the entry records the external path (today's `external.json` path, generalized). The `adopt` argument defaults to `settings.registerAdopts`. Lift the foreign-symlink-only gating so symlink-mode works for any source kind. RegisterModal still renders the action dropdown per-kind but `register-external` rows become regular "Register" rows; the `adopt` flag is global, not per-row. Drawer's `onRegister` / `onRegisterAsExternal` pair collapses to `onRegister` only (the external alternative becomes the global setting, surfaced in Settings).

**Why third.** M4's unregister behavior diverges based on `adopted`. We must establish the unified register model (and the `adopted` flag's meaning) before unregister consumes it.

**Conflict audit.** Existing `external.json` entries migrate forward: a one-time read-on-load shim populates `adopted: false` for them. RegisterModal's per-row dropdown collapses from 4 options to 2 (Register / Skip; Remove for broken). The classifier's `canRegisterAsExternal` capability is removed; renderer call sites that reference it (drawer secondary button) are deleted, not just hidden.

**Docs.** `docs/flows/register.md` rewrites to describe the unified flow + the setting. `docs/concepts.md` "Adopt" subsection added.

---

### M4 — Unregister + Delete separation

**Scope.** New core op `unregisterSkill(name, { destination })`. For adopted skills: move `<registryRoot>/skills/<name>` → `<destination>/<name>` (default `~/.agents/skills/<name>`); remove the registry index entry; remove agent symlinks that pointed at the moved location and recreate them pointing at the new location. For non-adopted skills: remove the registry index entry; leave origin files untouched; symlinks pointing at origin keep working. Rename `deregisterSkill` → `deleteFromBankSkill` (still hard-deletes; UI label "Delete from Skills Bank" already reflects this). Drawer's `Delete from Skills Bank` button stays where it is; a new `Unregister` button slots in above it in the escalation ladder. First-run notification toast: "Moved `<name>` to `<destination>`. Change destination in Settings."

**Why fourth.** Depends on M3's `adopted` flag. Independent of M5 (M5 prohibits unregister-canon at IPC level; the op itself must exist first).

**Conflict audit.** The rename is a breaking change to the core public API. `packages/cli/src/commands/uninstall.ts` and any other consumers update in the same milestone. IPC handler `IPC.deregister` keeps its wire name to avoid churn but its target function renames. Toast pattern reuses existing `onFlash` infrastructure.

**Docs.** `docs/flows/register.md` cross-links to a new `docs/flows/unregister.md`. `docs/concepts.md` updates the escalation ladder table.

---

### M5 — Canon invariants + Hidden list

**Scope.** IPC handlers reject `unregisterSkill` and `deleteFromBankSkill` when the target is canon. UI surfaces this by replacing the buttons with a single **Hide** button on canon skills. Hide state stored at `<userData>/registries/<hash(registryRoot)>/hidden-canon.json` as a flat list of names. Renderer filters hidden skills out of Registry/Browse tabs by default; SettingsModal grows a "Hidden canon skills" section listing them with an unhide button. Classifier gains the `canon-hidden` state (registered + canon + hidden). Hidden skills retain installations — hide is purely a UI dormancy state, not an uninstall.

**Why fifth.** Requires M2's correct canon resolution (else invariants act on stale canon) and M4's separation of unregister from delete (else "prohibit unregister-canon" has nothing well-defined to prohibit).

**Conflict audit.** Hide is a new dimension that doesn't conflict with existing operations — installations, tags, agent links all continue working on hidden skills. The list is per registry root (decided), so switching repos shows that repo's canon set fresh.

**Docs.** `docs/personas.md` documents the hide affordance and its scope. `docs/user-guide.md` adds a "Managing canon skills" subsection.

---

### M6 — Healing completeness

**Scope.** Enumerate every bad state explicitly in the classifier; add states missing today. Inventory:

- `registered-broken`, `registered-mixed-broken`, `registered-conflicts`, `unregistered-broken`, `unregistered-conflicts` (already exist)
- `canon-drift` (new) — local registered copy hash differs from `.skills-bank.json.syncedFromCommit`. Heal: keep-mine (mark as `source: user` going forward) or take-canonical (re-sync just this skill).
- `registry-folder-missing` (new) — `<registryRoot>/skills/<name>` is in the index but the folder isn't on disk. Heal options: canon → re-pull from upstream; non-canon → present export-restore option if available, else mark as deletion with explanation.
- `adopted-files-missing` (new) — `adopted: true` but bank-side dir is gone. Subset of registry-folder-missing; same heal flow.
- `external-target-missing` (new) — `adopted: false` and the recorded external path is gone. Heal: forget (remove index entry) or repoint (file picker).

Each state's heal flow follows the rule: present choices when multiple reasonable options exist; force the single option with an explanation banner when there's only one. Rename `flows/resolve-conflicts.md` → `flows/heal.md` and rewrite to cover all bad states.

**Why sixth.** Requires the full data model (M1), correct canon (M2), unified registration (M3), and unregister semantics (M4). M5's hide doesn't intersect — hidden skills are surfaced separately and skipped from heal sweeps.

**Conflict audit.** Existing heal entry points (`repairBrokenLinks`, `resolveSkillConflicts`) become the implementation of specific state's heal flows; their function signatures don't change. Renderer's `Needs attention` section pulls from the expanded state set automatically — no per-state hardcoded list.

**Docs.** `docs/flows/heal.md` replaces `flows/resolve-conflicts.md`. `docs/troubleshooting.md` cross-references the new states.

---

### M7 — Per-installation uninstall

**Scope.** Today's `uninstallSkill` removes the symlink from every agent dir. Extend the drawer's "Remove from agents" button to optionally open the same per-agent decision UI used by `resolveSkillConflicts`. The user can select which agents to remove from, retaining the skill in others. The underlying core op already accepts an `agents` array; this is renderer + UX. Bulk "Remove from agents" in InstalledTab keeps the all-agents default.

**Why seventh.** Independent of M5/M6 but consumes the classifier's `canRemoveFromAgents` capability (extended in M1). Placing it after the data/healing work avoids reworking the modal shape if M6 changes the per-agent UI substrate.

**Conflict audit.** The substrate (`ConflictResolveModal` in per-agent decision mode) is reused, not duplicated. The default behavior (remove from all) is unchanged when the user doesn't open the per-agent picker.

**Docs.** `docs/flows/install.md` adds a "Selective uninstall" subsection. `docs/user-guide.md` updates the action descriptions.

---

### M8 — Registry import as merge

**Scope.** Today's `importRegistry` replaces the active registry root. Add a merge mode: scan the picked folder's `skills/`, surface each entry that doesn't collide as a one-click "add to active registry"; surface collisions via the existing sync conflict modal (per locked decision, default keep-mine). New IPC `importRegistryMerge`. RepoPickerModal / import dialog grows a mode toggle: Replace (existing) / Merge (new).

**Why last.** Fully independent of every prior milestone. Lands last so it inherits the unified register model (M3), correct canon attribution on imported skills (M2), and the full heal flow (M6) for any drift/conflicts the merge introduces.

**Conflict audit.** Replace-mode import is preserved unchanged; merge is additive. The conflict modal is reused (sync's), not a new component. Imported skills are written with `source: imported` (existing marker) and `adopted: true` (they were copied in).

**Docs.** `docs/flows/sync.md` adds an "Import a registry" subsection covering both modes. `docs/personas.md` updates the "Portability" rows.

## Cross-cutting concerns (no separate milestone)

- **Naming.** "Adopt" disappears as a user-facing verb after M3 — it's a setting outcome, not an action. "Deregister" disappears after M4. "Unregister" enters in M4. "Hide" / "Unhide" enter in M5. The CLI commands track these renames in their respective milestones.
- **Settings model.** Two new keys (`registerAdopts`, `unregisterDestinationAgent`) added in M1 with conservative defaults. SettingsModal grows two sections: "Registration" (M3, exposes `registerAdopts`) and "Unregister destination" (M4, exposes `unregisterDestinationAgent`). M5 adds a third section: "Hidden canon skills."
- **State machine size.** 9 states pre-plan → 9 after M1 (`canon` field added but unused) → 10 after M5 (`canon-hidden`) → 14 after M6 (`canon-drift`, `registry-folder-missing`, `adopted-files-missing`, `external-target-missing`). Still small enough to enumerate exhaustively in the classifier source and in `docs/concepts.md`.
- **IPC surface.** No breaking wire-name changes. Function renames in core map to existing IPC handlers.

## Out of scope

- Multi-repo coexistence (one linked repo at a time, as today).
- In-app editing of adopted skills (your future work; M3's symlink-mode preserves the option).
- Auto-detection of arbitrary external skill directories beyond the known agent dir list.
- Migration of upstream `.skills-bank.json` markers (canon is computed dynamically post-M2, so no migration needed).
