# Bug: in-app Origin Update doesn't synthesize meta.json when upstream lacks one

**Observed:** 2026-05-19 on `feat/skills-flow-fixes` while clearing the post-session working tree (commit `07a8ff4`).

## Symptoms

After running the desktop app's Update action on a vendored skill whose upstream no longer ships a `meta.json`, the local skill folder ends up without a `meta.json`. `pnpm validate` then fails:

```
✖ skills/vendored/grill-with-docs: missing meta.json
Validated 67 skill(s); 1 failure(s).
```

The maintainer workaround per CLAUDE.md's "Heal local maintainer state" guidance is to `git checkout HEAD -- <skill>/meta.json` — but that only works if the file was previously committed under that name. A fresh in-app vendor + edit + update sequence on a meta-less upstream would produce a registry skill with no meta.json from first install onward, with no HEAD to restore from.

## Why it matters

- The bank's invariant (per ADR-0001 Suite 2 and `pnpm validate`) is that every skill ships a `meta.json`. The in-app update path can violate this invariant silently.
- The user-facing impact is "validate fails after my update succeeded," which contradicts the Update toast's success message.
- For non-maintainer users (whose registry isn't a git repo at all), `git restore` isn't an option. They'd hit a validate-fail state on every build:index with no recovery path.

## Hypothesis

`vendor-skill.ts` (the CLI path) has explicit logic to synthesize a `meta.json` from `SKILL.md` frontmatter when the mirrored folder lacks one:

```ts
// Synthesize meta.json if missing (skills installed via the CLI rarely
// ship one). Done after move so we write directly into the registry copy.
const metaPath = path.join(destDir, "meta.json");
if (!fs.existsSync(metaPath)) {
  const meta = readSkillMeta(destDir) ?? { ... };
  fs.writeFileSync(metaPath, JSON.stringify({ ...meta, name: entry.name }, null, 2) + "\n");
}
```

The runtime in-app Update path (`applyOriginUpdate` in `packages/core/src/upstream.ts` → its underlying `mirrorSkillFolder` call) does NOT carry this synthesis step. It mirrors and stops.

## Fix sketch

Extract the meta.json synthesis from `scripts/vendor-skill.ts` into a small helper in `packages/core/src/registry.ts` or `packages/core/src/upstream.ts`:

```ts
export function ensureMetaJson(skillDir: string, fallbackName: string): void {
  const metaPath = path.join(skillDir, "meta.json");
  if (fs.existsSync(metaPath)) return;
  const meta = readSkillMeta(skillDir) ?? {
    name: fallbackName,
    description: "(synthesized via origin update; description missing)",
  };
  fs.writeFileSync(metaPath, JSON.stringify({ ...meta, name: fallbackName }, null, 2) + "\n");
}
```

Call it from both `vendor-skill.ts`'s post-mirror step and from `applyOriginUpdate`'s post-mirror step. Single source of truth for the synthesis contract.

## Workaround until fixed

For maintainers in dev mode: `git checkout HEAD -- skills/<bucket>/<name>/meta.json` after an Update.

For users running packaged app against their own linked repo: no clean workaround. They'd have to manually `touch meta.json` with a minimal `{ name, description }` JSON. Documenting in `user-guide.md` would help but doesn't fix the cause.

## Related

- Companion bug: `applyOriginUpdate` doesn't validate the post-mirror folder against `docs/meta-schema.json` (see [2026-05-19-origin-update-missing-validation.md](2026-05-19-origin-update-missing-validation.md)). A folder with a valid-but-incomplete meta.json (e.g. empty description) suffers the same class of silent failure.
- Bug #1 + Bug #2 together: the Update path needs a "post-mirror invariants check" pass.
