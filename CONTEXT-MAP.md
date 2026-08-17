# Context map

System-wide ADRs live in `docs/adr/`.

The product glossary currently lives in root `CONTEXT.md`. Create a package `CONTEXT.md` (and scoped `docs/adr/`) lazily when `/domain-modeling` first resolves language for that context. Until a row's file exists, use the root glossary and `docs/adr/`.

| Context | Glossary | Scoped ADRs |
| --- | --- | --- |
| core | `packages/core/CONTEXT.md` | `packages/core/docs/adr/` |
| desktop | `packages/desktop/CONTEXT.md` | `packages/desktop/docs/adr/` |
| claude | `packages/claude/CONTEXT.md` | `packages/claude/docs/adr/` |
| cursor | `packages/cursor/CONTEXT.md` | `packages/cursor/docs/adr/` |
