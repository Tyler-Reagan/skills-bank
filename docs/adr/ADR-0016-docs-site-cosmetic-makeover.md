# ADR-0016 — Cosmetic makeover of the docs site (issue #129)

**Status:** Proposed

## Context

#156 (content-accuracy regression) is closed — the site's claims are now
code-verified. #129 was filed as the deliberately separate presentation-only
follow-on: the site is stock VitePress with zero theme customization,
despite the app having a clear brand identity (green accent `#22c55e`,
`icon.svg`). It scopes to five independent prongs:

1. **Theme/brand** — VitePress theme override (accent, hero gradient, font,
   spacing).
2. **IA/navigation** — thin top nav (no Download CTA, no Reference entry),
   flat 8-guide sidebar, untitled trailing group.
3. **Homepage** — hero + 5 feature cards, no imagery.
4. **Screenshots** — several are stale (e.g. `registry.png` is a dev-build
   artifact); re-shooting requires the packaged app against a populated
   registry, which is a maintainer-only capture task.
5. **Content consistency** — copy/terminology drift and redundant phrasing
   across guide pages (e.g. "linked repo" vs. "linked registry", the
   "Self-hosting" group/page/item text each phrasing the same idea
   differently, guide pages splitting between narrative and declarative
   opening voice). Surfaced by a phase-2 (IA/navigation) cleanup audit.
   Distinct from #156's already-closed content-accuracy work: #156 fixed
   claims that were factually wrong; this prong is about claims that are
   correct but inconsistently or redundantly phrased.

Each prong is independent enough to land as its own PR. This ADR exists to
pin the cross-cutting decisions made _before_ any implementation, so they
don't get re-litigated once work is split across separate PRs and sessions.

## Decision

- **Theme/brand ships first.** It's the highest-leverage lever per #129,
  and the other three prongs (nav styling, homepage layout, screenshot
  framing) all read against whatever theme lands — sequencing them first
  would mean redoing them once the theme exists.
  - **Rejected:** starting with IA or homepage. Both would need rework once
    brand colors/type/spacing land, so they follow theme/brand instead of
    running in parallel.
- **IA/navigation and homepage follow, in either order** — they don't
  block each other.
- **Screenshots are last.** They depend on the other three being settled
  (re-shooting against a UI that's about to change is wasted capture) and
  require the maintainer to drive the packaged app — an agent can produce
  the shot list but not the capture.
- **Content consistency has no fixed slot.** It doesn't depend on
  theme/IA/homepage settling first, and it doesn't need the packaged app —
  it's pure prose editing an agent can do end to end. It can land before,
  after, or interleaved with screenshots; sequence it whenever convenient
  rather than treating it as blocked on anything else in this ADR.
- **Internal review artifacts use Mermaid.** Before/after sidebar-structure
  diagrams and similar aids used to discuss a change before touching any
  file are disposable and never ship. Mermaid's speed (text in, diagram
  out, trivial to revise live during review) outweighs its generic default
  look, since an end user never sees that look.
- **Anything that ships on the published site uses hand-crafted SVG, not
  Mermaid.** Mermaid's default rendering reads as generic docs-tooling
  output — the exact aesthetic #129 is trying to move away from ("reads as
  a product site, not generic docs") — and that doesn't fully wash out even
  with Mermaid theme-variable overrides. SVG's interactivity (hover
  states, linked regions) is a genuine asset for shipped visualizations,
  not just a styling nicety, and is worth leaning into if a prong ends up
  wanting one (e.g. a homepage flow graphic).
  - **Rejected:** theming Mermaid's output to match the brand palette
    instead of hand-crafting SVG. Palette-matched Mermaid still reads as a
    diagramming tool's output at the structural level (node shapes,
    spacing, edge routing) — the problem isn't just color.
  - **Open:** whether any prong actually ends up shipping a visualization
    at all; none of the four prongs' descriptions in #129 currently call
    for one.
- **Each prong is prototyped or diagrammed as a reviewable Artifact before
  any file under `packages/docs` changes.** Theme/homepage mockups use the
  `prototype` skill; IA diagrams use `mermaid-diagrams` /
  `pretty-mermaid`. No implementation lands until the mockup is approved.

## Consequences

- Contributors picking up any one prong later inherit a settled default
  for diagram medium instead of re-deciding SVG vs. Mermaid per PR.
- The four prongs can ship as separate PRs, each carrying its own
  theme/IA/homepage-specific rationale in its PR description per this
  repo's plan-doc convention, without losing the cross-cutting decisions
  recorded here.
- Screenshot re-shoots stay explicitly blocked on the other three prongs
  landing first, so this ADR is the record of _why_ that ordering was
  chosen if it's ever questioned.
