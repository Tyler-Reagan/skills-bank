# Two-axis skill labeling with function-oriented categories

Skills Bank previously categorized skills by technology domain (`frontend`, `backend`, etc.), which conflated what a skill *touches* with what it *does*. We redesigned the label system around a **function** axis drawn from Anthropic's published skill taxonomy, moving domain signal to freeform tags.

## Decision

Adopt a two-axis labeling system:

1. **Category** — a single structured slot using compound `meta:function` slugs (e.g., `engineering:code-scaffolding`). The taxonomy is fixed at 21 functions across 5 meta-categories; users may define their own beyond these.
2. **Tags** — fully freeform, user-defined domain and technology signals. No predefined vocabulary.

Category assignment is always manual. Auto-Generate is removed — keyword matching cannot reliably infer function from vocabulary, and an LLM-powered replacement is a distinct feature not retrofitted here.

## Taxonomy

| Meta-category | Functions |
|---|---|
| `engineering` | `library-api-reference` · `code-scaffolding` · `code-review` · `verification` · `diagnostics` · `ci-cd-deployment` · `infrastructure` · `data-analysis` |
| `research` | `investigation` · `synthesis` · `evaluation` |
| `business` | `planning` · `process-automation` · `communication` · `reporting` |
| `creative` | `writing` · `design` · `brainstorming` |
| `productivity` | `focus` · `knowledge-management` · `decision-support` |

Category slugs follow the pattern `meta:function`. Display names title-case each segment: `engineering:code-scaffolding` → **Engineering: Code Scaffolding**.

## Migration

Existing `labels.json` entries with unrecognized slugs (all prior flat domain categories) are treated as uncategorized on next load. No coercion — old domain categories have no reliable 1:1 mapping to function categories. Users re-label via the Manage Labels modal.

## Considered options

**One structured axis vs. two.** A single function category without tags would lose domain signal entirely. Tags carry domain without requiring a second structured field or filter dimension.

**Keyword-based category suggestion (old Auto-Generate) vs. manual assignment.** Keyword matching worked for domain categories because technology terms are unambiguous. Function categories require understanding a skill's purpose, which resists keyword heuristics. The LLM-powered alternative is a future feature, not a retrofit.

**Coerce old slugs on migration vs. silent drop.** Best-effort coercion (e.g., `testing` → `engineering:verification`) produces confidently wrong labels. Silent drop + uncategorized is honest; the existing bulk re-label flow handles remediation.

## Consequences

- `categoryRules` keyword arrays are removed; the category list becomes a flat slug + display-name registry.
- `tagRules` and `deriveLabels` are removed entirely.
- The Auto-Generate UI flow (three-step modal) is removed in a follow-on PR alongside free-text category input support.
- Design philosophy: **user enablement over opinionated constraint**. The function taxonomy is the one axis where the system is opinionated; everything else defers to the user.
