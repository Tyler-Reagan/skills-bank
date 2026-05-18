# Bug: probe rewrites `fetchedAt` and dirties working tree

**Observed:** 2026-05-18 on `feat/v0.11.4-polish` (post v0.11.3 directory split).

## Symptoms

After running the desktop app, two committed `.skills-bank.json` markers show
unstaged churn whose only delta is the `fetchedAt` timestamp:

- `skills/vendored/react-components/.skills-bank.json` — `fetchedAt`
  bumped from 15:09:38Z → 17:06:11Z; `skillFolderHash` and `installedAt`
  unchanged.
- `skills/vendored/ubiquitous-language/.skills-bank.json` — `fetchedAt`
  bumped from 08:09:53Z → 17:05:16Z (in addition to a legitimate
  `skillFolderHash` correction committed separately).

## Why it matters

Bundled-repo convention: commit `.skills-bank.json`. The probe path
keeps overwriting the file with a fresh wall-clock timestamp, so every
app launch leaves the maintainer's tree dirty even when no upstream
state has changed. CI noise + accidental commits.

## Hypothesis

The probe writes `fetchedAt` unconditionally instead of guarding on
"upstream state actually changed since last probe." Suspect call sites:
`probeUpstream` → writer that persists `.skills-bank.json`. The hash
field already short-circuits in the right way; `fetchedAt` should follow.

## Fix sketch

Either:

1. Only persist `fetchedAt` when something else in the marker changed
   (hash, sha, upstream pointer), OR
2. Move `fetchedAt` out of the committed marker into the gitignored
   `.skills-bank-hash` sidecar (which already encodes "last probe
   state" and is intentionally not shipped).

Option 2 is cleaner — `fetchedAt` is genuinely local state.

## Workaround until fixed

`git restore skills/**/.skills-bank.json` after running the app, or
add a maintainer-side checkout filter.
