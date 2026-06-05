# Skill metadata

A skill's metadata — the name, description, and tags shown in the Registry tab — lives in the **YAML frontmatter at the top of `SKILL.md`**. The app reads it automatically on refresh.

> [!NOTE]
> As of **v1.15.0**, SKILL.md frontmatter is the **sole** source of skill metadata. Earlier versions also read a sibling `meta.json` as a fallback ("shim"); that read path was removed. A `meta.json` may still appear inside a skill folder, but only as an app-**synthesized** artifact (generated from the frontmatter for agents that expect one) — you never author or edit it, and it is not read back as a source of truth.

## Example

```markdown
---
name: frontend-design
description: Expert UI/UX guidance for React and Tailwind projects.
tags: [frontend, react, design]
version: 1.2.0
author: your-github-username
---

Your skill prompt content here…
```

The frontmatter is delimited by `---` lines and must be the first thing in the file. Everything after the closing `---` is the skill's prose, which the agent reads at runtime.

## Fields

| Field         | Type       | Required | Description                                                                                                |
| ------------- | ---------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `name`        | `string`   | **Yes**  | Skill identifier. Must match the folder name. Pattern: `^[a-z0-9][a-z0-9-]*$`, max 64 characters.          |
| `description` | `string`   | **Yes**  | Short description shown on the card and in the detail dialog.                                              |
| `tags`        | `string[]` | No       | Array of tag strings. Used by the Registry tag filters. Each tag: min 1, max 64 characters. No duplicates. |
| `version`     | `string`   | No       | Semver string (e.g. `1.0.0` or `2.1.0-beta.1`).                                                            |
| `author`      | `string`   | No       | Author name or GitHub username.                                                                            |

See [Skill labels](/reference/labels) for the full list of categories and tags the app recognizes.

## Validation

Run `pnpm validate` from the repo root to validate every skill's `SKILL.md` frontmatter against the schema. It fails a skill that is missing frontmatter or whose frontmatter violates the schema. CI runs this on every push.

The full JSON schema is at [`docs/meta-schema.json`](https://github.com/Tyler-Reagan/skills-bank/blob/main/docs/meta-schema.json) on GitHub — it now describes the frontmatter fields above.
