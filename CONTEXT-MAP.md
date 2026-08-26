# Context map

System-wide ADRs live in `docs/adr/`.

These glossaries are the post-inversion language. The running tree still implements the pre-inversion Registry until that work is specified and built.

| Context | Glossary | Scoped ADRs |
| --- | --- | --- |
| core | [packages/core/CONTEXT.md](./packages/core/CONTEXT.md) | `packages/core/docs/adr/` |
| desktop | [packages/desktop/CONTEXT.md](./packages/desktop/CONTEXT.md) | `packages/desktop/docs/adr/` |
| claude | [packages/claude/CONTEXT.md](./packages/claude/CONTEXT.md) | `packages/claude/docs/adr/` |
| cursor | [packages/cursor/CONTEXT.md](./packages/cursor/CONTEXT.md) | `packages/cursor/docs/adr/` |

`packages/docs` is the docs site, not a domain context. Scoped ADR directories are created lazily when a context-specific decision needs one.

## Relationships

- **core** owns the Store, the Lock, Origin, the writer verbs Add and Delete, Extract, Snapshot, and Snapshot remote. **Skill** is defined once here. Other contexts use that word; they do not redefine it.
- **desktop** owns the Label overlay, Discover, Agents (working tab name), and Metrics. Labels are not Lock fields. Metrics consumes harness machinery; it does not own Hook or Tracking.
- **claude** owns Projection, Unproject, Conflict, Hook, Invocation, Tracking, and Plugin. Plugin already exists in the product as a read-only Claude Code surface. Focused handling waits until the claude package is built.
- **cursor** is a native reader of the Store. Skills Bank does not Project into `~/.cursor/skills`. Cursor-only objects belong here when the cursor package is built; they are not named yet. Metrics will consume that machinery the same way it consumes Claude's.
