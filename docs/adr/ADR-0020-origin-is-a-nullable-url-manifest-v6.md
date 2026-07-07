# ADR-0020 — Origin is a nullable URL; manifest schema v6

**Status:** Accepted

## Context

[ADR-0018](./ADR-0018-origin-kind-narrowed-no-undefined-state.md) narrowed `OriginKind` to
`"github" | "local"`. Working the model against real cases broke the enum twice more. First, a
skill adopted into the bank from a non-GitHub remote (private GitLab, self-hosted) fit neither
value — `local` would erase the true fact that it came from somewhere external, falsely bucketing
it `personal`. A proposed third value (`"remote"`) fixed that but exposed the underlying problem:
_host variety is a property of the URL, not an independent axis_. "Is this GitHub?" is
`new URL(url).host === "github.com"` — a derivation, and storing derivable facts as taxonomy is the
same mistake ADR-0019 removed with `source`.

Second, the enum was storing a fact about the _app's capabilities_ (which hosts the fetch/probe
machinery can drive) as if it were a fact about the _skill_. If fetch support widens beyond GitHub
later, an enum forces a schema migration; a URL upgrades to fetchable with no data change at all.

## Decision

### The persisted origin fact is a single nullable URL

```
origin = { url: string | null, skillPath?, hash?, timestamps… }
```

- `url: null` — deliberately stamped "no remote." Written by detach, by authoring-from-scratch, and
  by the first-index scan when no evidence of a remote exists. ADR-0018's no-vacuum invariant
  survives intact: `null` is an explicit stamped answer, never an absence of one.
- `url` matching the linked repo → self → bucket `personal`.
- Any other `url` → external → bucket `vendored` — including non-GitHub hosts, which now bucket
  correctly instead of falsely as `personal`.

`OriginKind` is deleted. Call sites that do GitHub API work (probe, mirror, adopt-PR) guard on "is
this a URL I can drive?" at the call site — a capability check, which is what the enum always was
in disguise. A GitLab-hosted skill is not an error; it's a valid external origin the app can't
re-fetch _yet_, surfaced honestly as such.

`isSelfOrigin` survives as the URL-vs-linkedRepo comparison — still the single self-vs-external
decider (ADR-0012's surviving remnant).

### Bucket derivation runs once, at acquisition

The derivation (`url` null-or-self → `personal`, external → `vendored`) chooses where the folder
_lands_; thereafter the folder location itself is the record, exactly as `walkSkills` already
treats it. Nothing re-derives bucket live against the mutable `linkedRepo`, so re-linking to a
fork or rename moves no folders and relabels nothing — ADR-0012's re-link hazard, resolved by
storing the one bit of acquisition-time memory as the thing itself (placement) rather than as a
field that can drift from it.

### Manifest schema v6

Per-skill: `name`, `origin { url, skillPath, hash }`, `category`, `tags`. Top-level:
`schemaVersion`, `skills`. Removed from the wire: `source` (ADR-0019), `bucket` (derived; importer
holds `linkedRepo` and computes placement itself), `description` (re-derivable from mirrored
SKILL.md; import-progress ghost cards degrade to name-only), `sourceBankVersion` and `registryRoot`
(informational; `schemaVersion` alone governs readability). `origin.kind`/`repo`/`sourceUrl`
collapse into `url`; `skillFolderHash` renames to `hash`, keeping its documented
diagnostic-only role (import never gates on a match).

`COMPARED_FIELDS` becomes `["origin", "category", "tags"]` — every committed per-skill field now
participates in diff; no more fields that are written but can never matter.

In the manifest, `origin.url` is always a real string: rows with `url: null` are filtered at
serialization (see ADR-0021's projection rule), continuing the existing "only restorable skills
are exported" invariant. The nullable form exists only in the live local record.

## Invariants respected

- Metadata-only manifest; content re-mirrored from origin on import.
- Deterministic committed serialization (sorted, stable keys, volatile fields dropped) —
  strengthened, since `bucket`/`description` no longer ride the wire at all.
- Only restorable skills exported.
- No-vacuum (ADR-0018's core): every skill has an explicit, stamped origin answer.
- Single coercion chokepoint: v2–v5 manifests up-convert in `coerceManifestToCurrent`
  (`kind:"github"` + `repo` → URL; `kind:"none"` → `url: null`, filtered); no version branches
  downstream.
- Additive-by-default import; deletions only via the confirmed-removal arm.
- One diff/merge signature (`skillSignature`) shared by both engines.

## Invariants broken — deliberately

- **ADR-0018's enum shape.** The definedness invariant survives; the `github | local` vocabulary
  does not. This ADR amends ADR-0018 in place of a third enum value.
- **"Every non-local origin is GitHub-operable."** Code may no longer assume it; fetch/probe call
  sites gain an explicit capability guard. Honest, since it was always the app's capability being
  described, not the skill's nature.
- **Wire format breaks, not deprecates.** v6 removes and reshapes fields beyond the one-minor-cycle
  deprecation convention. Accepted: all of ADR-0017/0018/0019/this batch into a single schema bump
  with legacy read-through, so the version moves once.
