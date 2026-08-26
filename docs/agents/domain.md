# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area you are about to work in. Also check `packages/<context>/docs/adr/` for context-scoped decisions.

The package glossaries are the post-inversion language. The running tree still implements the pre-inversion Registry until that work is specified and built. Do not rename running code to match the new glossary in an unrelated session.

If a listed glossary or ADR directory does not exist, **proceed silently**. Do not flag their absence. Do not suggest creating them up front. The `/domain-modeling` skill creates them lazily when terms or decisions actually get resolved.

## File structure

Multi-context repo (presence of `CONTEXT-MAP.md` at the root):

```
/
├── CONTEXT-MAP.md
├── CONTEXT.md                         ← pointer to the map; no Language section
├── docs/adr/                          ← system-wide decisions
└── packages/
    ├── core/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← context-specific decisions
    ├── desktop/
    ├── claude/
    └── cursor/
```

See `CONTEXT-MAP.md` for the live table. Package glossaries and scoped ADRs are created lazily. `packages/docs` is the docs site, not a domain context.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

If the concept you need is not in the glossary yet, that is a signal — either you are inventing language the project does not use (reconsider) or there is a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
