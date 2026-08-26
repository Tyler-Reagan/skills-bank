# Desktop

The Skills Bank UI overlay. Labels live here. They are not Store or Lock fields. Tabs are Store, Discover, Agents (working name), and Metrics.

## Language

**Discover**:
The catalog surface: an embedded skills.sh view plus in-app Add (Fetch, then Add into the Store). It does not spawn `npx`. Plugin inventory does not live here.
_Avoid_: Install tab, marketplace, Open Terminal (as an Add path)

**Agents**:
Working chrome name (the spec may rename it). The tab for Claude and Cursor package artifacts: Plugin inventory today, other harness objects later. It is the view for overlap between Plugin-shipped skills and Store skills. It is not an Agent Directory and not the Installed tab.
_Avoid_: Agent Directory, Installed, Marketplace

**Label**:
The combined category and tags assigned to a skill for browsing and filtering. Never stored in the skill files or the Lock.
_Avoid_: Metadata, annotation

**Category**:
A single structured label slot per skill, using a compound `meta:function` slug (e.g. `engineering:code-scaffolding`). Drawn from a fixed taxonomy of 21 functions across 5 meta-categories. User-defined categories are also supported.
_Avoid_: Type, kind, domain

**Meta-category**:
The top-level prefix of a category slug, grouping functions by the broad domain of work they serve: `engineering`, `research`, `business`, `creative`, or `productivity`.
_Avoid_: Group, namespace, parent category

**Function**:
The second segment of a category slug, describing what a skill does within its meta-category (e.g. `scaffolding`, `diagnostics`, `brainstorming`). Stable across collections regardless of technology domain.
_Avoid_: Subcategory, type

**Tag**:
A freeform domain or technology signal applied to a skill by the user. No predefined vocabulary.
_Avoid_: Keyword, attribute

**Metrics**:
The desktop view of Invocation stats. It consumes harness machinery (Claude Hook, Invocation, and Tracking today; Cursor when that machinery is named). It is not a Store or Lock feature.
_Avoid_: Tracking (that is on/off state), telemetry
