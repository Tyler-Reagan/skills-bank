# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- Root **`CONTEXT.md`** until a package glossary exists for that context. The map says when to fall back.
- **`docs/adr/`** — read ADRs that touch the area you are about to work in. Also check `packages/<context>/docs/adr/` for context-scoped decisions.

If any of these files do not exist, **proceed silently**. Do not flag their absence. Do not suggest creating them up front. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Multi-context repo (presence of `CONTEXT-MAP.md` at the root):

```
/
├── CONTEXT-MAP.md
├── CONTEXT.md                         ← living product glossary until split
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
