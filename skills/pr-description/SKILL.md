---
name: pr-description
description: "Generate a GitHub PR description with proper issue linkage syntax. Use when the user asks for a PR description, wants to open a pull request, or says /pr-description. Inspects branch commits and open issues to produce Closes/Related/Follow-on sections automatically."
---

# PR Description Generator

Produce a structured GitHub PR description with correct issue linkage syntax from the current branch's commits and the repository's open issues.

## When to use this skill

- User asks "give me a PR description"
- User says `/pr-description`
- User is about to open a pull request and wants a pre-filled body

## Step-by-step procedure

Execute these steps in order. Run independent shell commands in parallel where possible.

### Step 1 — Gather context

Run all of the following in parallel:

```bash
# Commits on this branch not yet on the base branch
git log --oneline origin/master..HEAD         # or origin/main if master doesn't exist

# Full diff summary (files changed)
git diff --stat origin/master..HEAD

# Open issues (number + title + labels)
gh issue list --limit 60 --json number,title,labels,createdAt \
  | jq -r '.[] | "#\(.number) [\(.labels | map(.name) | join(","))] \(.title)"'

# When the branch diverged (approximate date, used to flag newly opened issues)
git log --oneline --reverse origin/master..HEAD | head -1
```

If `origin/master` doesn't exist, substitute `origin/main`.

### Step 2 — Map commits → issues

1. Parse commit messages for milestone markers (e.g. `M9.0`, `M9.3`, `[M6.2]`) and keywords.
2. For each open issue, check whether its title contains a matching marker or keyword that appears in a commit message.
3. Classify each matched issue:
   - **Closes** — the commit message directly implements what the issue describes (same milestone tag, or verb match like "add", "implement", "fix")
   - **Related** — the issue is adjacent or partially addressed but not fully resolved
   - **Follow-on** — the issue was created *after* the branch's first commit (i.e. filed *during* this PR's work as future tracking). Use `gh issue view N --json createdAt` to confirm if needed.
   - **Unrelated** — skip entirely

### Step 3 — Group commits into logical sections

Scan commit subjects and group them by theme (not by raw commit). Each group becomes a section under "What's in this PR". Use the commit message detail (not just the subject line) for section content.

Typical groupings: type system / data model changes, new UI components, new library/parser code, persistence/export, UX/polish, docs, tests.

### Step 4 — Write the description

Output exactly this structure as a markdown code block the user can paste into GitHub:

```markdown
## <one-sentence summary of the PR's main purpose>

<one short paragraph expanding on the summary — what problem it solves, what domains/features it touches>

---

### What's in this PR

**<Group name>**
<2-4 bullet points describing the changes in plain language. Mention file names or component names where helpful.>

**<Next group>**
...

---

### Closes

- Closes #N — <issue title>
- Closes #N — <issue title>

### Related

- Related to #N — <issue title>

### Follow-on issues opened

- #N — <issue title>
```

Omit any section that has no entries (e.g. if there are no follow-on issues, drop that section entirely).

## Linkage syntax rules

| Relationship | Syntax | Effect on merge |
|---|---|---|
| This PR fully resolves the issue | `Closes #N` | Issue auto-closes when PR merges |
| Partial / adjacent work | `Related to #N` | Links but does not close |
| Issue was opened *as part of* this PR (future work) | `#N — title` under Follow-on | No auto-close; just a reference |

`Fixes #N` and `Resolves #N` are aliases for `Closes #N` — use `Closes` for consistency.

## Quality checks before outputting

- Every issue in Closes must be genuinely resolved by the commits — do not close issues that still have open sub-tasks
- Do not list the same issue in both Closes and Related
- Issue titles in the output should match the actual GitHub title exactly (copy from `gh issue list` output)
- The "What's in this PR" sections should be written for a reviewer who hasn't seen the branch — no internal jargon, no references to conversation context
