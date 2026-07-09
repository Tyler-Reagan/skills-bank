# Skills Bank

A desktop registry for discovering, installing, and organizing Claude Code skills.

## Language

**Skill**:
A named capability installable into an AI coding agent (Claude Code, Cursor, etc.), consisting of a SKILL.md entry point and optional supporting files.
_Avoid_: Plugin, extension, tool

**Registry**:
The user's local collection of installed skills, sourced from one or more origins.
_Avoid_: Library, catalog, store

**Agent Directory**:
The fixed directory a supported AI coding agent reads its skills from, one per agent under `$HOME` (e.g. `~/.claude/skills/`). `~/.agents/skills/` is one of these too — shared across tools rather than tied to one — and is the default destination Unregister sends files to, not a fallback for missing ones. A missing directory is skipped silently, never an error. The Registry only ever reaches these via a symlink (Install) or by classifying what's already sitting there (Installation kind) — the Registry itself is never stored here.
_Avoid_: Agent folder, Skills folder, Tool directory

**Linked Repo**:
The single GitHub repository a user has configured as both the mirror source for their entire Registry _and_ the presumed home for their own collection of skills — a repo they own, not merely a sync target. The Registry reads this repo's `skills/` contents by convention, and it's the one write destination for pushing local changes back out (manifest export, adopt-and-push). Distinct from Origin, which tracks the upstream source of an individual skill and may point at a third-party repo the user doesn't own — a skill's Origin is often, but not always, the Linked Repo. When no Linked Repo is configured, the Registry is simply empty until the user links one or installs from Discover — there is no curated/bundled fallback set (retired in the origin-only provenance model, ADR-0020/0021, issue #159).
_Avoid_: Linked registry, GitHub registry, registry source (when meaning this specific repo)

**Label**:
The combined category and tags assigned to a skill for browsing and filtering. Stored in `labels.json`, never in the skill files themselves.
_Avoid_: Metadata, annotation

**Category**:
A single structured label slot per skill, using a compound `meta:function` slug (e.g., `engineering:code-scaffolding`). Drawn from a fixed taxonomy of 21 functions across 5 meta-categories. User-defined categories are also supported.
_Avoid_: Type, kind, domain

**Meta-category**:
The top-level prefix of a category slug, grouping functions by the broad domain of work they serve: `engineering`, `research`, `business`, `creative`, or `productivity`.
_Avoid_: Group, namespace, parent category

**Function**:
The second segment of a category slug, describing what a skill _does_ within its meta-category (e.g., `scaffolding`, `diagnostics`, `brainstorming`). Stable across registries regardless of technology domain.
_Avoid_: Subcategory, type

**Tag**:
A freeform domain or technology signal applied to a skill by the user. No predefined vocabulary — tags reflect the user's own mental model of their collection.
_Avoid_: Keyword, attribute

**Origin**:
A skill's single nullable-URL provenance: the GitHub URL it was mirrored from, or `null` for a local skill with no remote (ADR-0018/0020). Lives entirely in the skill's registry-manifest row — there is no separate provenance axis. A URL matching the active Linked Repo is a self-origin (authored here); any other URL is an external upstream; `null` is an explicit "local, no remote" stamp, not an error state.
_Avoid_: Source (the old provenance-axis term, retired), upstream (kept only as a description of what an Origin URL points at)

**Manifest**:
The registry's metadata record for every skill it manages — Origin, Category, Tags — never skill content itself, which is always re-fetched from Origin on import. Two projections exist (ADR-0021): the live manifest carries every row, including `url: null` local-only skills; the pushed manifest drops those rows before anything is committed to the Linked Repo, diffed, or merged, so a local-only skill can never be misread by a pull as "deleted upstream."
_Avoid_: Registry (the managed collection itself; Manifest is its metadata artifact), Skill record, Sidecar (retired provenance mechanism, ADR-0021)

**Runtime Map**:
The one gitignored file per Registry (`.skills-bank/runtime.json`) holding every skill's volatile probe/drift state — content hash baseline, last successful fetch, consecutive probe failures — keyed by skill name. Replaces what used to be three per-skill sidecar files. Distinct from the registry manifest, which holds the durable/committed half of a skill's record (identity, Origin, labels).
_Avoid_: Sidecar data, skill record, skill state (which refers to the UI-facing installation classification)

**Bucket**:
A skill folder's spatial location under `<registryRoot>/skills/`: `personal` (self-originated — Origin's `url` is `null` or matches the Linked Repo) or `vendored` (external Origin, mirrored in). Derived once at acquisition time from Origin (`bucketForOrigin`); the folder location is the durable record afterward, so re-linking to a different repo moves no files and relabels nothing. Distinct from the retired `curated` bucket (ADR-0017, issue #159) — in this repo's own tree `skills/vendored/` is kept deliberately empty by policy (the maintainer's authored skills live in the separate `Tyler-Reagan/skills` repo), but Bucket itself is a live concept for any registry.
_Avoid_: Category (that's a Label axis), Source (retired provenance-axis term, ADR-0019)

Three orthogonal verbs move a skill along the pipeline, distinguished by _where content comes from_ and _where it goes_: **Add** brings content in from a remote into the bank; **Register** brings an on-disk skill into the bank; **Install** symlinks a bank skill out to Agent Directories. The Discover-tab GitHub flow is Add composed with Register + Install as its mechanics.

**Add**:
Acquire a skill from a remote source (today, a GitHub repo) into the Registry: mirror its content into the Bucket tree (external Origin → `vendored`), write a manifest row carrying the `origin.url`, baseline the drift hash, and Install it to the default Agent Directories. User-facing button: "Add from GitHub." "Install" is deliberately _not_ used for this whole operation — Install is only the agent-symlink step Add composes at the end.
_Avoid_: Install from GitHub (retired label — overloaded "Install"), Import (reserved for manifest/disk import flows), Vendor (retired verb, though the resulting Bucket is still `vendored`)

**Register**:
Bring an on-disk skill into the Registry: its files move into the Bucket tree under `<registryRoot>/skills/` and a manifest row is written — one verb, one effect (ADR-0022). Registering a skill discovered in an agent dir (a foreign symlink or a real directory left by another tool) relocates its real content into `skills/personal/<name>/` and repoints every agent symlink at the bank copy. **Registered ⇔ files live under `<registryRoot>/skills/`** — there is no "track in place" mode and no separate move-into-bank step (both retired with ADR-0011 when keep-in-place skills and custom directories were dropped). Distinct from Add only in source: Register's content is already on local disk, Add's arrives from a remote. User-facing button: "Register in registry."
_Avoid_: Adopt / Move into bank (retired — registering _is_ moving into the bank now), Add (reserved for the remote-acquisition verb), Import (reserved for manifest/disk import flows), track-in-place / symlink-mode (retired concepts)

**Unregister**:
Register's inverse: move a skill's files out of the bank to the `unregisterDestinationAgent` directory (default the shared `~/.agents/skills/`) and rewrite every agent symlink that pointed at the bank copy to the new location, then drop the manifest row. User-facing button: "Unregister." Mid-tier on the destructive-action ladder — stops short of deleting files (see the Installed tab's Delete, reachable only on already-unregistered skills).
_Avoid_: Remove (ambiguous with Uninstall — never use "Remove" in prose for either action), Deregister

**Install**:
Symlink a Registry skill's canonical folder into one or more Agent Directories. Button label: "Install" (or "Reinstall" when repairing broken links, or "Install (will prompt for conflicts)" when stragglers exist). Multi-agent by default — installs to every Agent Directory that exists on disk.
_Avoid_: Add, Enable

**Uninstall**:
Remove an agent-dir symlink for a skill — Install's inverse. Never a standalone button; reached only via "Manage agent links" (unchecking an agent, or a "Remove from all agents" action) or as a side effect of Unregister/Delete.
_Avoid_: Remove (reserved for nothing — never use it for this or Unregister), Disable

**Installation kind**:
Classification of what sits at `<agentDir>/<name>`, computed by resolving the entry to its _final_ symlink target (not just one hop — a symlink-to-a-symlink into the Registry still classifies `ours`): `ours` (resolves into the Registry), `foreign-symlink` (resolves outside the Registry), `real-directory` (actual files, not a symlink — e.g. installed by another tool's CLI), `broken-symlink` (target doesn't exist). Drives both the Registered/Unregistered split and Conflict detection.
_Avoid_: Installation type, Link kind

**Finalize**:
Turn every Agent Directory that's currently a symlink (typically into the shared `~/.agents/skills/`) into its own real, independent directory — a single "Finalize now" action batches over all of them, not one at a time. For each: renames the old symlink to a timestamped backup rather than deleting it, creates a real directory in its place, and recreates each skill inside as a direct symlink into the Registry — one hop, not the old symlink-through-a-symlink chain. Afterward those agents no longer share storage with any other; edits to the shared directory no longer touch them. Refuses per-agent if any entry there isn't already a symlink — Finalize only ever recreates existing symlinks, never adopts foreign content — while still finalizing whichever other agents are clear to proceed.
_Avoid_: Detach (reserved for severing a skill's Origin — unrelated), Unlink (that's Uninstall/Unregister)

**Conflict**:
More than one non-`ours` Installation Kind entry for the same skill name across Agent Directories. Two related classifier states: `registered-conflicts` (stragglers alongside an already-registered, installed skill) and `unregistered-conflicts` (multiple candidate copies with no Registry entry yet, so the user must pick one before Registering). Resolved by replacing each straggler with a symlink to the canonical copy, deleting it, or keeping it. This is the **sole** meaning of "conflict" in the skills domain — the manifest-merge name-collision case (a manifest resolution: `keep-mine` / `use-theirs` / `keep-both`, surfaced during Import) is a separate concern that lives privately inside the merge machinery and is not called a "conflict" in shared vocabulary.
_Avoid_: Duplicate, Collision

**Detach**:
Sever a skill's Origin pointer while keeping its local content — sets `origin.url` to `null`, re-baselines the drift hash, and moves the folder `vendored/ → personal/` via a Bucket rehome. User-facing label: "Keep my edits (detach)" (from drift) or "Keep local (detach)" (from the Restore-origin modal, when Origin has gone unreachable). The detached skill is local-only (excluded from the pushed manifest) until re-homed into the Linked Repo via a pull request (`rehomeIntoLinkedRepo`) to regain a self-Origin.
_Avoid_: Unlink (that's Uninstall/Unregister), Orphan

**Pull**:
Fetch and apply a content update for one skill already in the Registry, from that skill's own Origin — scoped to the skill, not the Linked Repo. Surfaced as the `UPDATE` card badge and the drawer's "Update" button, but "Pull" is the precise engineering term: "Update" alone is ambiguous with app-release updates and with Import's registry-level reconciliation.
_Avoid_: Update (ambiguous outside UI copy), Sync (retired), Refresh

**Extract**:
Write a single skill out of the Registry to a standalone file on disk — a bare `SKILL.md` or a bundled zip, depending on whether it has supporting files. Distinct from Export, which moves a Manifest's metadata, never skill content.
_Avoid_: Export (reserved for the Manifest-level operation)

Import and Export are a second, orthogonal pair — they move the Manifest (metadata), never skill content, and are unrelated to the Add/Register/Install content pipeline above.

**Import**:
Reconcile which skills the Registry has, and their manifest rows (Origin, Category, Tags), against a Manifest. Never touches an existing skill's file content — only brand-new entries get content mirrored in. Covers both the blunt reconcile (first-link, and the Header's quick-refresh) and the deliberate three-way merge (base/ours/theirs) in the Manifest modal, which surfaces divergences as a manifest resolution rather than a Conflict (see Conflict).
_Avoid_: Sync (retired, ADR-0017/0020), Adopt (reserved for Register), Update (reserved for Pull)

**Export**:
Commit the Registry's pushed Manifest to the Linked Repo, guarded against a non-fast-forward push so a diverged remote is never silently clobbered (ADR-0009). Also available as a plain file via the Manifest modal's disk-transport tab, independent of any Linked Repo, for moving a Manifest's metadata between machines by hand.
_Avoid_: Push (reads as Pull's inverse, but Pull is skill-content-scoped and Export never sends skill content anywhere)

Metrics is a separate, self-contained domain — tracking how often skills fire, unrelated to the Registry/Manifest axes above.

**Invocation**:
One recorded use of a skill — either model-invoked (`PreToolUse`, tool `Skill`) or a user `/slash` command (`UserPromptExpansion`). Logged as a single JSONL line by the Hook; aggregated into per-skill counts and first/last-seen timestamps.
_Avoid_: Usage event, Call

**Hook**:
The `PreToolUse`/`UserPromptExpansion` entries this app installs into Claude Code's `settings.json`, plus the script they invoke, that appends every Invocation to the log. "Installed" means any tracked event has our entry present, not necessarily all of them.
_Avoid_: Tracking (the outcome; Hook is the installed mechanism itself)

**Tracking coverage**:
The derived on/off timeline for the Hook — built from an explicit ledger of enable/disable periods, not inferred from gaps in the invocation log, since silence there could mean "not used" just as easily as "not tracked." Exposes a tracked-since date and whether tracking is currently on; the underlying windows-and-gaps data supports a fuller timeline view later.
_Avoid_: Uptime, History (too generic — this is specifically about Hook on/off state, not skill usage)
