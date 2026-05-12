# MR Writing Examples

These are illustrative examples drawn from a multi-version data-loader refactor. Use them as calibration for tone, specificity, and structure — the file names, function names, and module boundaries are fictional but the structural pattern is real.

---

## MR Description Example

### Title

```
Data loader v3 pipeline, source architecture convergence, and codebase cleanup
```

**Why this title works:**

- No verbs; all noun phrases
- Three distinct themes in priority order (new capability → architectural change → cleanup)
- Specific enough to convey scale without being verbose

---

### Description (viewer-shared)

```
Integrates the v3 data-loading pipeline into the shared viewer and converges
v1/v2/v3 loading under a standardized, versioned data-flow architecture.

**Cross-version orchestration convergence:**

- `viewer-data-layer.ts` is now the canonical orchestration boundary for viewer loading.
- `loadViewFromSource(...)` acts as the single high-level load entrypoint for v1/v2/v3.
- Version divergence is isolated to loader dispatch (`loadV2Source` vs `loadV3Source`)
  while preserving a normalized output shape (`view`, `image`, optional `overlayContext`).

**New data-layer domain model for v3 support:**

- Added `archive-data-layer.ts` to own format metadata parsing, v2/v3 image loading,
  and v3 composite pyramid construction.
- Added `overlay-data-layer.ts` to own query adapter responsibilities
  (shapes/points SQL + response normalization).
- Added `transform-data-layer.ts` to own coordinate/geometry transforms
  (placement normalization, affine mapping, geometry parsing, label remapping).
- Added `query-data-layer.ts` contract definitions used across overlay/transform/query boundaries.

**Format standardization and transform wiring:**

- Standardized terminology and metadata handling across v2-style and v3-style archive structures.
- Refactored v3 placement/transform handling around explicit format-derived contracts
  (`regionPlacement`, transform stacks), replacing ambiguous intermediary wiring.
- Unified coordinate logic across boundaries, points, viewport filtering, and labels
  so they use the same transform path.

**Viewer/layer pipeline convergence for v3 usability:**

- Converged layer composition in `viewer-layers.tsx` to a unified version-aware path.
- Kept `viewer-visualizer.tsx` focused on viewport/render orchestration while moving
  data/transform/query logic into data-layer domains.
- Preserved legacy-viewer image rendering for v3 via composed multiscale abstraction
  while enabling query-backed overlays.

**Operational and quality outcomes:**

- Improved v3 density/points performance (including parquet row-group pruning path improvements).
- Reduced dead code and duplicated pathways across viewer/store/components.
- Updated data-layer comments and module docs to reflect final ownership boundaries and flow.
```

**Annotations:**

- Opening sentence names the system-level achievement — no verbs in the sentence, but the statement is complete
- Theme groups are ordered: new capability → architecture → standard → layer convergence → cleanup/quality
- Every bullet references a real file (`viewer-data-layer.ts`) or function (`loadViewFromSource`)
- Parentheticals provide specificity without their own bullets: `(placement normalization, affine mapping, ...)`

---

## Technical Reviewer Guide Example

```markdown
# v3 Pipeline Convergence (Technical Reviewer Summary)

**Baseline:** branch point with `main` (`merge-base(origin/main, HEAD)` = `<merge-base-sha>`)
**Range reviewed:** `<merge-base-sha>..<head-sha>`
**Scope:** `viewer-shared/viewer/*`

## End-State Delta From Main

### 1) Canonical cross-version orchestration boundary is now explicit

- `viewer/viewer-data-layer.ts` is the load orchestration boundary for v1/v2/v3.
- `loadViewFromSource(...)` is the canonical entrypoint that resolves version/source
  and returns normalized output (`view`, `image`, optional `overlayContext`).
- Version divergence is isolated to loader dispatch (`loadV2Source` vs `loadV3Source`)
  rather than spread across store/UI code paths.

### 2) Data-layer domains are now cleanly separated by responsibility

- Integration work converged into distinct domains:
  - `viewer/viewer-data-layer.ts` (orchestration)
  - `viewer/archive-data-layer.ts` (format parsing + image loading/composition)
  - `viewer/overlay-data-layer.ts` (query adapters)
  - `viewer/transform-data-layer.ts` (coordinate/geometry transforms)
- This is the stable end-state after intermediate exploratory files/flows were converged or removed.

### 3) Format metadata standardization was completed for v2 + v3 paths

- `viewer/archive-data-layer.ts` aligns v2-style and v3-style metadata handling under one format-oriented model.
- v2/v3 are treated as corollary topologies:
  - v2: singleton multiscale image source.
  - v3: per-region multiscale sources with composed viewer pyramid.
- Public contracts communicate region placement/transform intent explicitly
  (`regionPlacement`, format transform structures).

### 4) v3 transform wiring is now based on format contracts

- `viewer/transform-data-layer.ts` consumes standardized transform metadata from archive source data.
- Placement normalization, affine transform mapping, and label remapping are aligned to the same
  transform contract.
- Reduces prior ambiguity between placement fields and transform derivation paths.

### 5) v3 image compatibility with the legacy viewer flow is preserved via composition

- `viewer/archive-data-layer.ts` composes per-region v3 image pyramids into a single viewer-facing
  multiscale abstraction.
- Enables shared viewport/image rendering while supporting v3's per-region data topology.

### 6) Layer and viewer pipeline converged to a unified operational path

- `viewer/components/viewer-layers.tsx` is the unified layer pipeline endpoint
  (post intermediate v2/v3 split).
- `viewer/components/viewer-visualizer.tsx` remains focused on viewport/render orchestration
  with data responsibilities pushed into data-layer domains.
- Boundary/points/labels behavior reflects improved v2/v3 parity, with v3 using
  query + transform paths.

### 7) Store + overlay integration reflects standardized contracts

- `viewer/store.ts` consumes normalized load outputs and v3 `overlayContext` from the canonical pipeline.
- `viewer/overlay-data-layer.ts` encapsulates query adapter logic
  (shapes/points SQL generation + normalization), keeping query behavior decoupled from UI/state.

### 8) Quality/perf/cleanup deltas bundled into final architecture

- Mainline delta includes extensive cleanup and convergence
  (dead code removal, deduplication, cast narrowing, hook/order fixes).
- Notable v3-impacting outcomes include heatmap latency improvement (row-group pruning),
  improved transform consistency, and stabilized feature gating/parity behavior.
- Comments across data-layer modules were updated to document current ownership boundaries and flow.

## Reviewer Focus Areas

- Confirm `loadViewFromSource` remains the single high-level load orchestration surface.
- Validate v3 transform parity across image placement, boundary transforms, point transforms,
  viewport filtering, and label remapping.
- Confirm v2 behavior remains stable under unified orchestration and shared layer path.
- Confirm no cross-domain regressions (UI/state concerns leaking back into data-layer
  query/transform modules).
```

**Annotations:**

- Header block always includes exact SHAs — do not omit
- Numbered section titles use past/present tense factual statement format: "X is now Y", "X was completed"
- Reviewer Focus Areas are 4 items here: one per major risk surface (orchestration contract, transform correctness, v2 regression, domain isolation)
- Each focus area starts with `Confirm` or `Validate` — never a question
