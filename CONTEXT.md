# Skills Bank

A desktop registry for discovering, installing, and organizing Claude Code skills.

## Language

**Skill**:
A named capability installable into an AI coding agent (Claude Code, Cursor, etc.), consisting of a SKILL.md entry point and optional supporting files.
_Avoid_: Plugin, extension, tool

**Registry**:
The user's local collection of installed skills, sourced from one or more origins.
_Avoid_: Library, catalog, store

**Linked Repo**:
The single GitHub repository a user has configured as both the mirror source for their entire Registry _and_ the presumed home for their own collection of skills — a repo they own, not merely a sync target. The Registry reads this repo's `skills/` contents by convention, and it's the one write destination for pushing local changes back out (manifest export, adopt-and-push). Distinct from Origin, which tracks the upstream source of an individual skill and may point at a third-party repo the user doesn't own — a skill's Origin is often, but not always, the Linked Repo. When no Linked Repo is configured, the Registry mirrors the Bundled Default instead.
_Avoid_: Linked registry, GitHub registry, registry source (when meaning this specific repo)

**Bundled Default**:
The state of a Registry with no Linked Repo configured — it mirrors the curated set shipped with the app (`Tyler-Reagan/skills-bank`) at the unauthenticated GitHub rate limit. Distinct from the `curated` source-provenance value: Bundled Default is a whole-Registry state, `curated` is a per-skill axis reserved for skills read directly from the app's own shipped repo. A skill can only be `curated` while its Registry is in the Bundled Default state, but not every skill in that state need stay `curated` forever (e.g. after local edits).
_Avoid_: Curated bank, curated set, bundled bank

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
The upstream source a skill was installed from — a GitHub repository, a local path, or the curated set. Distinct from source (which tracks provenance axis: `curated`, `user`, `vendored`).
_Avoid_: Source (when referring to the install location specifically)

**Skill Record**:
The app-managed metadata for a single skill: its provenance, sync baseline, and probe state. Stored across three sidecar files in the skill folder. Distinct from the skill's own content (SKILL.md and supporting files).
_Avoid_: Sidecar data, skill metadata, skill state (which refers to the UI-facing installation classification)
