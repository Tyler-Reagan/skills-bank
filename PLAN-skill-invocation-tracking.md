> **Transient implementation plan — delete this file on merge / once implemented.**
> Committed so it travels with the branch for a later (possibly cross-machine)
> implementation session. Not permanent documentation; do not link it from the
> docs tree.

# Skill-invocation tracking + Metrics dashboard

**What:** add an opt-in Claude Code `PreToolUse` hook that logs every skill
invocation to a local JSONL file, and a **Metrics** tab that aggregates it into
per-skill usage counts. **How:** hook → local append-only log → core parser →
IPC → renderer, with an app-managed Settings toggle that installs/removes the
hook in `~/.claude/settings.json`. Strictly local, single-machine; no server, no
telemetry egress.

## Context

We want to know which Claude Code skills actually get used, on this machine, over
time — and to lay a clean data foundation for richer usage dashboards later (the
maintainer's stated goal: "get ahead of downstream metrics-related dashboards").

The mechanism is a Claude Code `PreToolUse` hook with `matcher: "Skill"`, which
fires on every skill invocation and receives a JSON payload on stdin
(`tool_name`, `tool_input.{skill,args}`, `session_id`, `cwd`, `transcript_path`,
`permission_mode`). A logging hook (`exit 0`, never blocks) appends each event to
a local file; the app aggregates it and renders a **Metrics** tab.

**Key architectural fact that shaped the whole design:** skills-bank is a purely
local Electron app — **no server, no database**, only JSON files on disk + IPC.
So events go to a **local append-only JSONL log**, not an API. This is **strictly
single-machine personal insight** — there is no fleet/aggregate telemetry now or
planned, so nothing ever leaves the user's machine.

### Decisions locked during design review

1. **Strictly local (A).** No egress, no upload-consent model, no schema-for-transmission.
2. **Substrate: append-only JSONL** at `~/.skills-bank/invocations.jsonl`, **full
   raw payload per line**. Hook is the sole writer; the app is the sole reader and
   does all aggregation. Chosen over a counter file (concurrent read-modify-write
   loses increments / corrupts) and over SQLite (the hook can't write it without a
   dependency). `O_APPEND` of a single line is atomic on POSIX.
3. **User-global `~/.claude/settings.json`, Claude-Code-only.** No per-skill hook
   mechanism exists (matcher keys on the *tool*, not a skill name). Counts **all**
   Skill invocations (authored, vendored, plugin skills like `vercel:deploy`).
4. **Opt-in, app-managed toggle.** "Enabled" is **derived from the settings.json
   file** (single source of truth, marker = `skill-invocation-hook.sh`), not a
   stored flag — so hand-edits never drift, and a dev-mode enable is reversible
   from any build. Enable = non-destructive idempotent merge; disable = remove
   only our entry, **keep the log**. **Refuse to write a malformed settings.json**
   (never clobber); write atomically (temp + rename).
5. **No dev-mode gating.** The toggle works in both dev and packaged builds against
   **real** paths. This is safe precisely because state is file-derived + marked +
   reversible-from-any-build. Metrics deliberately uses real paths regardless of
   `app.isPackaged` (a conscious, documented exception to the dev-sink isolation
   invariant). Broader dev-sink hardening is tracked in a separate GitHub issue.
6. **No log rotation** for v1 — growth is low-single-digit MB/year; documented debt.
7. **Read-on-open + manual refresh**, aggregated in the **main process**, returned
   to the renderer over IPC. No file-watcher / polling.
8. **Hook delivered as a script file** (`~/.skills-bank/skill-invocation-hook.sh`),
   not inlined into settings.json (avoids JSON⊃shell⊃printf quoting fragility,
   keeps it human-inspectable). Command: `sh "<abs-path>"` (POSIX-sh single-quote
   the path so usernames with spaces/apostrophes survive). POSIX-sh only,
   dependency-free (`cat | tr | printf`), `"timeout": 5`. Log created `0600`,
   script `0755`.
9. **Tracking-history ledger** (`~/.skills-bank/tracking-history.json`) records
   on/off **periods** — the app owns the toggle moment, so timestamps are precise;
   a reconcile invariant records an *approximate* transition when the file state
   diverges from the ledger (hand-edit case). This exists primarily so a future
   **gap-respecting timeline view** is possible; the v1 indicator is minimal.

## Approach

### Data model (`~/.skills-bank/`, real home, dev + packaged)

| File | Writer | Shape |
| --- | --- | --- |
| `invocations.jsonl` | hook | one line: `{ "ts": ISO, "payload": <raw stdin> }` |
| `skill-invocation-hook.sh` | app (on enable) | the POSIX-sh logger |
| `tracking-history.json` | app (on toggle / reconcile) | `{ "periods": [{ "enabledAt": ISO, "disabledAt": ISO\|null, "approximate"?: bool }] }` |

`getMetricsDir()` resolves to `os.homedir()/.skills-bank` and **deliberately ignores
`SKILLS_BANK_HOME_OVERRIDE`** (the dev sink) — see `packages/core/src/shared/agents.ts`
for the override it intentionally does *not* use. A `SKILLS_BANK_METRICS_DIR` env
var exists only so tests can point at scratch dirs.

### packages/core — pure, unit-tested (no Electron)

- `src/metrics/invocations.ts` *(new)* — `getMetricsDir()`, `getInvocationLogPath()`,
  `readInvocationStats()` →
  `{ totalEvents, malformedLines, sessions, perSkill: [{skill,count,firstInvokedAt,lastInvokedAt}], logPath, logExists }`.
  Tolerant parser: skips malformed/interleaved lines, missing file = empty result.
- `src/metrics/hook-config.ts` *(new)* — pure transforms on a parsed settings object:
  `buildHookScript(logPath)`, `buildHookCommand(scriptPath)`, `hasSkillHook`,
  `addSkillHook`, `removeSkillHook`; POSIX-sh single-quote helper for paths.
- `src/metrics/coverage.ts` *(new)* — pure deriver: periods ledger → coverage windows,
  gaps, `trackedSince`, current open/closed state. Feeds both the minimal v1 indicator
  and the deferred timeline.
- `src/metrics/test/{invocations,hook-config,coverage}.test.ts` — follow the
  `src/*/test/*.test.ts` convention (scratch dirs under `os.tmpdir()`, see
  `src/registry/test/build.test.ts`). Cover: well-formed / malformed / interleaved /
  empty / missing-file; add-idempotency / remove-only-ours / preserve-other-hooks /
  refuse-on-malformed; period coalescing + gap computation.
- `src/index.ts` — add `export * from "./metrics/invocations.js"` etc.

### packages/desktop/main — file I/O + IPC

- `src/main/skill-tracking.ts` *(new)* — the impure layer over core's pure helpers:
  resolve real `~/.claude/settings.json` and `~/.skills-bank/` paths; `enableTracking()`
  (write script `0755`, create log `0600`, atomic merge settings, open ledger period);
  `disableTracking()` (atomic remove from settings, close ledger period; leave log +
  script); `getTrackingStatus()` → `{ state: "off"|"on"|"needs-repair", coverage,
  settingsPath, scriptPath }` including the **reconcile invariant** (file-vs-ledger
  divergence → approximate transition). Model atomic JSON writes on the existing
  `writeConfig` in `main.ts` (2-space + trailing newline).
- `src/main/main.ts` — three `ipcMain.handle` registrations near the others:
  `getInvocationStats`, `getSkillTrackingStatus`, `setSkillTrackingEnabled(enabled)`.
- `src/shared/ipc.ts` — add the channel constants + `SkillsBankAPI` method signatures
  + result types (`InvocationStats`, `TrackingStatus`).
- `src/main/preload.mts` — expose the three methods on `window.skillsBank`.

### packages/desktop/renderer — Metrics tab + Settings toggle

- `src/renderer/components/MetricsTab.tsx` *(new)* — fetch via `useIpcQuery`
  (see `hooks/useIpcQuery.ts`, already used in `SettingsModal.tsx`). States:
  (1) **off, no history** → full center notice + button to the Settings toggle;
  (2) **off, with history** → same center notice prominent + prior stats below,
  stamped with covered range + "off since {date}";
  (3) **on** → ranked skill list (name, count, last-used, CSS bar — **no chart lib**)
  + summary header (totals/sessions) + **minimal** coverage line. Light registry
  cross-ref: match skill name → registry entry for a description subtitle
  (`window.skillsBank.listRegistry()`); non-registry skills render bare. Manual
  refresh button. Copy is placeholder — to be wordsmithed.
- `src/renderer/components/Tabs.tsx` — add `"metrics"` to `TabId` and a tab entry
  (label **"Metrics"**, positioned **last**).
- `src/renderer/App.tsx` — render `<MetricsTab/>` when active; active-tab persistence
  already handled by `LS_KEYS.tab`.
- `src/renderer/components/SettingsModal.tsx` — new **"Skill usage"** `prefs-group`
  with a toggle "Track Claude Code skill usage" that **acts immediately** (mirrors the
  existing "Finalize now" pattern, not deferred to Save), shows the tri-state status,
  and carries an `InfoTooltip` ("Adds a PreToolUse hook to `~/.claude/settings.json`;
  records skills you invoke, on this machine only — nothing is sent anywhere").

### Docs + meta

- `CHANGELOG.md` — feature entry.
- `CLAUDE.md` — one line in the dev-isolation section noting metrics deliberately uses
  real paths regardless of build.
- **GitHub issue** — [#138](https://github.com/Tyler-Reagan/skills-bank/issues/138)
  "harden the dev sink + its pnpm scripts/docs" (filed alongside this MR), with this
  feature's real-path reliance noted as context.

### Deferred (unblocked by the full-payload + ledger substrate; no hook change needed)

Usage-over-time / gap-respecting timeline, per-project (`cwd`) grouping, per-session
breakdowns, harness metadata, in-bank badges, log rotation, manual "clear history".

## Verification

- **Unit (core):** `pnpm test` — the parser, the settings merge (proves the risky
  `settings.json` logic against temp dirs, never real config), and coverage/gap derivation.
- **CI parity:** `pnpm typecheck && pnpm test && pnpm build`. (`validate` / `build:index`
  skipped — no skill content changes.)
- **Manual end-to-end (maintainer's call, touches real config):** run the app, flip the
  Settings toggle, confirm the `{matcher:"Skill"}` entry + script appear and the log
  `0600` is created; invoke a skill in real Claude Code; confirm the event lands in the
  log and the row appears in the Metrics tab; toggle off and confirm the entry is removed,
  the log persists, and the tab shows the "off" state.

## Scope / process

One PR on `feat/skill-invocation-tracking`. This MR commits the **plan only** — no
implementation yet; a later session implements from this doc and deletes it on merge.
