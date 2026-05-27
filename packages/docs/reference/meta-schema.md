# meta.json schema

Each skill folder can contain an optional `meta.json` file that adds metadata visible in the Registry tab. The app picks it up automatically on refresh.

## Example

```json
{
  "name": "frontend-design",
  "description": "Expert UI/UX guidance for React and Tailwind projects.",
  "tags": ["frontend", "react", "design"],
  "version": "1.2.0",
  "author": "your-github-username"
}
```

## Fields

| Field         | Type       | Required | Description                                                                                                |
| ------------- | ---------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `name`        | `string`   | **Yes**  | Skill identifier. Must match the folder name. Pattern: `^[a-z0-9][a-z0-9-]*$`, max 64 characters.          |
| `description` | `string`   | **Yes**  | Short description shown on the card and in the detail dialog.                                              |
| `tags`        | `string[]` | No       | Array of tag strings. Used by the Registry tag filters. Each tag: min 1, max 64 characters. No duplicates. |
| `version`     | `string`   | No       | Semver string (e.g. `1.0.0` or `2.1.0-beta.1`).                                                            |
| `author`      | `string`   | No       | Author name or GitHub username.                                                                            |

## Validation

Run `pnpm validate` from the repo root to validate all `meta.json` files in `skills/` against the schema. CI runs this on every push.

The full JSON schema is at [`docs/meta-schema.json`](https://github.com/Tyler-Reagan/skills-bank/blob/main/docs/meta-schema.json) on GitHub.

## SKILL.md frontmatter

`SKILL.md` can also carry YAML frontmatter as an alternative to `meta.json`. The app reads either form:

```markdown
---
name: frontend-design
description: Expert UI/UX guidance for React and Tailwind projects.
---

Your skill prompt content here...
```

If both `meta.json` and `SKILL.md` frontmatter are present, `meta.json` takes precedence.
