# Skill labels

Skills Bank organizes your registry along two axes: **category** and **tags**. Both are user-assigned — nothing is set automatically. Skills with no category appear under **Uncategorized** in the Registry tab until you assign one.

Labels are stored in `labels.json` in your app data directory and never touch the skill files themselves. They persist across registry syncs and manifest imports.

## Browse navigation

Skills are grouped into collapsible category sections when categories have been assigned. When two or more sections are visible, a **Collapse all / Expand all** toggle appears in the results row — click it to fold or unfold every section at once. Individual sections can still be toggled independently. Skills with no category assigned appear together under **Uncategorized**.

## Categories

Each skill has at most one category, drawn from a fixed function-oriented taxonomy: what the skill *does*, not what technology it touches (that's what tags are for — see below). The taxonomy has 21 functions grouped under 5 meta-categories; category slugs are `meta:function` (e.g. `engineering:code-scaffolding`), and the Registry tab title-cases each segment for display (**Engineering: Code Scaffolding**).

| Meta-category  | Functions                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engineering`  | Library & API Reference · Code Scaffolding · Code Review · Verification · Diagnostics · CI/CD & Deployment · Infrastructure · Data & Analysis |
| `research`     | Investigation · Synthesis · Evaluation                                                                                                                       |
| `business`     | Planning · Process Automation · Communication · Reporting                                                                                                    |
| `creative`     | Writing · Design · Brainstorming                                                                                                                             |
| `productivity` | Focus · Knowledge Management · Decision Support                                                                                                              |

Category assignment is always manual — there's no keyword-matching or suggestion tool. Figuring out what a skill's purpose is resists automation better than domain-tagging does, so this is the one place the app doesn't try to guess for you.

## Tags

A skill can have any number of tags. Unlike categories, tags are fully freeform — there's no predefined vocabulary. Use them for whatever domain or technology signal matters to you (a language, a framework, a workflow name); the tag filter bar and free-text search both match against them.

## Managing labels

Click **Manage Labels** in the Registry tab toolbar to open the label management modal. From here you can view, edit, and organize labels across your entire registry at once.

**Browse and filter** — the skill list supports search by name, filter by category (one at a time) or tags (multi-select), and sort by name, category, or uncategorized-first.

**Inline editing** — click a category badge (or the **Set category** placeholder) to get a dropdown and change the category directly. Tag chips have **✕** buttons to remove them; the **+** button adds a new tag inline. Changes save immediately.

**Bulk clear** — select one or more skills with the checkboxes, then open **Actions → Clear labels**. A confirmation dialog shows the count before executing.

**Open skill [↗]** — each row has a hover-revealed button that opens the skill's full detail drawer above the modal, for richer editing (SKILL.md preview, install, origin, etc.).

## Editing labels per skill

Open any skill in the detail drawer and use the **Labels** section to:

- Change the category with the dropdown (saved immediately)
- Remove a tag with **✕** on its chip
- Add a tag with **+ Add tag**

Label edits are per-skill and persist across registry syncs.
