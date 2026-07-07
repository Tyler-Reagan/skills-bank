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

**Runtime Map**:
The one gitignored file per Registry (`.skills-bank/runtime.json`) holding every skill's volatile probe/drift state — content hash baseline, last successful fetch, consecutive probe failures — keyed by skill name. Replaces what used to be three per-skill sidecar files. Distinct from the registry manifest, which holds the durable/committed half of a skill's record (identity, Origin, labels).
_Avoid_: Sidecar data, skill record, skill state (which refers to the UI-facing installation classification)
