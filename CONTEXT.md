# Skills Bank

A desktop registry for discovering, installing, and organizing Claude Code skills.

## Language

**Skill**:
A named capability installable into an AI coding agent (Claude Code, Cursor, etc.), consisting of a SKILL.md entry point and optional supporting files.
_Avoid_: Plugin, extension, tool

**Registry**:
The user's local collection of installed skills, sourced from one or more origins.
_Avoid_: Library, catalog, store

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
The second segment of a category slug, describing what a skill *does* within its meta-category (e.g., `scaffolding`, `diagnostics`, `brainstorming`). Stable across registries regardless of technology domain.
_Avoid_: Subcategory, type

**Tag**:
A freeform domain or technology signal applied to a skill by the user. No predefined vocabulary — tags reflect the user's own mental model of their collection.
_Avoid_: Keyword, attribute

**Origin**:
The upstream source a skill was installed from — a GitHub repository, a local path, or the curated set. Distinct from source (which tracks provenance axis: `curated`, `user`, `vendored`).
_Avoid_: Source (when referring to the install location specifically)
