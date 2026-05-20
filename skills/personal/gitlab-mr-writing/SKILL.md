---
name: gitlab-mr-writing
description: Author GitLab merge request descriptions and technical reviewer guides for large-scale engineering changes. Use when the user asks to write an MR description, merge request body, PR description, technical reviewer summary, or reviewer guide — especially for refactors, architecture changes, or multi-package merges.
---

# GitLab MR Writing

## Calibrate scope before drafting

**Default to brief.** Most MRs are focused bug fixes, single-file refactors, or
small features — those deserve a description that fits on one screen, not a
reviewer guide. Reach for the verbose form only when the change is genuinely
architectural (cross-package convergence, new service boundary, multi-week
refactor lands as one merge, etc.).

Calibrate by classifying the change before drafting:

| Class | Examples | Description target |
|---|---|---|
| **Focused** | Bug fix, single helper, one-component frontend change, doc-only update | ~20–30 lines. Motivation + headline changes + 1–2 references. No theme-group bullets, no reviewer-focus checklist. |
| **Multi-theme** | New feature touching 2–3 packages, refactor with cleanup, infra rollout | ~50–80 lines. Theme groups become useful here. Still no reviewer guide unless requested. |
| **Architectural** | Cross-package convergence, new service, version migration, multi-week deep change | The full structure below — opening framing, theme groups, optional Technical Reviewer Guide. |

When the user gives an explicit length or shape constraint in the prompt
("keep under 25 lines", "brief", "just motivation"), that override is
authoritative regardless of class. Do not pad to fill structure.

The "Body structure", "Theme group labels", and "Technical Reviewer Guide"
sections below are written for the Architectural class. For Focused MRs,
drop them — a one-paragraph motivation, a short bullet list of headline
changes, and 1–2 references is sufficient.

## One, possibly two, artifacts

Every significant merge produces up to two documents, but at least one:

1. **MR Description** — one per package/repo being merged; consumed by the GitLab MR UI
2. **Technical Reviewer Guide** — one optional document covering the full change; consumed by an assigned reviewer doing a deep review

Produce only the MR Description unless the user specifies otherwise.
The Technical Reviewer Guide is for Architectural-class changes; do not
generate one for Focused or Multi-theme MRs even when running this skill.

---

## Step 1: Establish the delta baseline

Before writing either artifact, determine the diff scope:

```
merge-base(origin/main, HEAD)..HEAD
```

State this explicitly in the reviewer guide header. All claims must describe the end-state delta — not intermediate commits, not exploratory branches, not work that was reverted.

---

## MR Description

### Title

- Noun phrases only, no verbs.
- **Focused MR:** 4–10 words, one topic. Optional `[TICKET-ID]` prefix when the work links to a tracker issue. Examples:
  - `[SW-26047] chat-server inline rendering of MCP image artifacts`
  - `chatbff API key resolver revalidation`
- **Architectural MR:** 8–15 words, comma-separated themes in priority order. Examples:
  - `Data pipeline v3 integration, source architecture convergence, and codebase cleanup`
  - `Loader v3 integration, credential centralization, and tiered codebase cleanup`

Do not invent comma-separated themes to make a Focused MR look bigger than it is.

### Body structure

```
[Opening framing sentence — 1–2 sentences only]

**[Theme group label]:**

- [Specific bullet referencing actual files, functions, or modules]
- [Specific bullet]
- [Specific bullet]

**[Next theme group]:**

- ...
```

#### Opening sentence rules

- State what the MR accomplishes at a systems level
- One to two sentences maximum
- No "This MR..." opener — start with the subject directly

#### Theme group labels

- Bold, present-tense noun phrase ending with colon
- Order: architecture/structural changes first, then operational, then cleanup
- Examples: `Cross-version orchestration convergence:`, `Operational and quality outcomes:`

#### Bullet rules

- Start with a verb or direct noun reference — no fluff
- Reference real file paths, function names, and module names when relevant (use backtick formatting inline)
- One idea per bullet; do not combine unrelated points
- Use em-dash (`—`) to separate the subject from the consequence when needed
- Never use "we", "our", "the team", or passive voice

#### Multi-package MRs

Write a separate titled section per repo/package (`## viewer-shared`, `## viewer (desktop)`, etc.), each with its own title and description block.

---

## Technical Reviewer Guide

### Header block

```markdown
**Baseline:** branch point with `main` (`merge-base(origin/main, HEAD)` = `<sha>`)
**Range reviewed:** `<merge-base-sha>..<head-sha>`
**Scope:** `<package>/<subdirectory>/*`
```

### Body structure

```markdown
## End-State Delta From Main

### 1) [Short declarative title]

- [Bullet: specific end-state fact]
- [Bullet: specific end-state fact]

### 2) [Short declarative title]

...

## Reviewer Focus Areas

- [Validation checkpoint — confirm/validate/verify language]
- [Validation checkpoint]
```

#### Numbered section rules

- Title is a short declarative statement in past or present tense: `"Canonical orchestration boundary is now explicit"`
- 2–5 bullets per section; each describes a concrete, verifiable end-state fact
- Reference specific files, exports, and function names
- No narrative — state facts only

#### Reviewer Focus Areas

- 4–6 bullets maximum
- Use action verbs: `Confirm`, `Validate`, `Verify`
- Each item maps to a risk area that a reviewer should actively check
- Focus on: contract stability, cross-domain isolation, regression surface, behavioral parity

---

## Tone and style

| Do                                           | Don't                                                |
| -------------------------------------------- | ---------------------------------------------------- |
| Reference real file paths and function names | Use vague abstractions ("the service", "the helper") |
| State end-states as facts                    | Describe intermediate steps or history               |
| Use active, direct language                  | Use passive voice                                    |
| Be thorough within scope                     | Pad to fill structure; combine unrelated concerns    |
| Match technical depth to the audience        | Over-explain well-known concepts                     |
| Trust the diff — say what's NOT obvious      | Restate what the diff already shows file-by-file     |
| Limit brittle references (md plan docs etc.) | Add cross-doc paths that rot when files move         |

---

## Workflow

### Step 1: Run the diff summary script

From the repo root, run:

```bash
python ~/.cursor/skills/gitlab-mr-writing/scripts/extract-diff-summary.py
```

Options:

- `--base <ref>` — base branch to diff against (default: `origin/main`)
- `--scope <path>` — limit output to a subdirectory (e.g. `packages/viewer`)

The script outputs:

- Full SHAs for the merge-base and HEAD (copy these into the reviewer guide header)
- Files grouped by directory, sorted by change volume, with `[added]`/`[deleted]` labels
- A pre-formatted reviewer header block ready to paste

For multi-package repos, run once per package using `--scope`:

```bash
python ~/.cursor/skills/gitlab-mr-writing/scripts/extract-diff-summary.py --scope packages/viewer-shared
python ~/.cursor/skills/gitlab-mr-writing/scripts/extract-diff-summary.py --scope app
```

### Step 2: Group by architectural responsibility

From the script output, assign each directory cluster to a theme group:

- New files → identify the domain they establish (orchestration, data-layer, transport, etc.)
- High-churn modified files → identify the convergence or refactor they represent
- Deleted files → note what was removed and why (cleanup, superseded, dead code)

### Step 3: Classify and draft the MR description

Before drafting, classify the change per the "Calibrate scope before drafting"
table above. Pick the matching shape and length target. If the diff summary
shows ≤2 files modified in a single package, default to **Focused**. If 3–5
files across one package, default to **Multi-theme**. Only ≥6 files across
multiple packages, or a stated cross-cutting architectural intent in the
user's prompt, triggers **Architectural**.

For Focused MRs: motivation paragraph → 3–5 bullets of headline changes →
1–2 references. No theme-group headers, no reviewer-focus checklist.

For Multi-theme / Architectural MRs: use the Body structure above. Reference
real file paths from the diff summary as raw material for bullets.

### Step 4: If requested, draft the technical reviewer guide

Copy the `Suggested Reviewer Header` block from the script output verbatim.
Map each theme group from Step 2 to a numbered section. Close with 4–6 Reviewer Focus Areas targeting the highest-risk changes (contract changes, behavioral parity, domain boundary integrity).

### Step 5: Verify specificity

Every bullet should be traceable to a real file or function visible in the script output.
Remove any bullet that cannot be grounded in the diff.

## Additional resources

- For annotated examples of both artifacts, see [examples.md](examples.md)
- Script source: [`scripts/extract-diff-summary.py`](scripts/extract-diff-summary.py)
