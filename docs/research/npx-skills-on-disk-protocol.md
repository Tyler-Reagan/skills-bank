# Research: on-disk protocol for `npx skills` (global add/update/remove)

Question source: [issue #220](https://github.com/Tyler-Reagan/skills-bank/issues/220).

## Sources read

- Repo: [vercel-labs/skills](https://github.com/vercel-labs/skills), cloned at commit `c6f69c631292444cc541ac6d91e2226b0ff247da` (2026-08-10).
- `package.json` at that commit reports version `1.5.22`.
- `npm view skills version` returns `1.5.22`. `npm view skills dist-tags` shows `latest: 1.5.22`. The clone matches the published `latest` tag.
- No blog posts or training-data recall are used as evidence. Every claim below cites a file path and line range in the clone above.

This note supersedes the older [`npx-skills-cli-mechanics.md`](./npx-skills-cli-mechanics.md) (issue #183) on lockfile and directory details. The command-surface and copy-vs-symlink sections of that note still match current source; the sections below are the re-verified, current-version detail.

## 1. Global lockfile: `.skill-lock.json`

Source: `src/skill-lock.ts`.

### Path

`getSkillLockPath()` picks one of two paths (`src/skill-lock.ts:67-73`):

1. If `$XDG_STATE_HOME` is set: `$XDG_STATE_HOME/skills/.skill-lock.json`.
2. Otherwise: `~/.agents/.skill-lock.json`.

There is no merge of the two locations. The tool picks exactly one path per run, based on the environment at that moment.

### Schema (current version: 3)

`CURRENT_VERSION = 3` (`src/skill-lock.ts:8`). Comment on the same line: "Bumped from 2 to 3 for folder hash support (GitHub tree SHA)".

Top-level shape, `SkillLockFile` (`src/skill-lock.ts:51-60`):

- `version: number`
- `skills: Record<string, SkillLockEntry>` — keyed by skill name.
- `dismissed?: DismissedPrompts` — tracks whether the user already dismissed the "install find-skills" prompt.
- `lastSelectedAgents?: string[]` — remembers the last agent picks for future prompts.

Per-skill entry, `SkillLockEntry` (`src/skill-lock.ts:13-38`):

| Field | Type | Purpose |
| --- | --- | --- |
| `source` | `string` | Normalized source id, e.g. `"owner/repo"`. |
| `sourceType` | `string` | `"github"`, `"mintlify"`, `"huggingface"`, `"local"`, `"git"`, `"well-known"`, etc. |
| `sourceUrl` | `string` | The original URL used to install. Used to re-fetch on update. |
| `ref?` | `string` | Branch or tag used at install time. Used again on update. |
| `skillPath?` | `string` | Subpath to `SKILL.md` inside the source repo. |
| `skillFolderHash` | `string` | GitHub tree SHA for the whole skill folder. Changes when any file in the folder changes. |
| `installedAt` | `string` | ISO timestamp, set once. |
| `updatedAt` | `string` | ISO timestamp, refreshed on every write. |
| `pluginName?` | `string` | Set if installed via a Claude Code plugin marketplace manifest. |
| `sourceBaseUrl?` | `string` | Base URL for `well-known` sources (skills.sh-style directories). |
| `wellKnownDigest?` | `string` | Content digest for `well-known` sources, used to detect upstream changes. |

### Hash algorithm

Two different algorithms exist, and the choice depends on lockfile scope, not on a single global rule:

- **Global lock (`skillFolderHash`):** a **GitHub tree SHA**, fetched through the GitHub Trees API (`fetchSkillFolderHash`, `src/skill-lock.ts:162-172`, delegating to `fetchRepoTree` / `getSkillFolderHashFromTree` in `src/blob.ts`). This is Git's own SHA-1 tree hash, not a hash the CLI computes itself, for GitHub sources.
- **Fallback / non-GitHub-API path:** when the GitHub API is unavailable, `updateGlobalSkills` clones the repo and calls `computeSkillFolderHash` instead (`src/update.ts:622-625`), which is the same SHA-256-over-file-contents function the project lock uses (see below). So the global lock's `skillFolderHash` field can hold either a Git tree SHA (40 hex chars) or a SHA-256 hex digest, and update code distinguishes them with a regex check for a 40-char hex string (`src/update.ts:622`: `/^[0-9a-f]{40}$/i.test(entry.skillFolderHash)`).
- **`computeContentHash`** (`src/skill-lock.ts:123-125`) is a plain **SHA-256** of a string, used elsewhere for content hashing (e.g. well-known digests), separate from `computeSkillFolderHash`.

### `ref`

Stored verbatim as the branch/tag string used at install time (`src/skill-lock.ts:21`). `update` re-reads this `ref` and re-fetches from the same `ref`, so a skill pinned to a branch stays pinned to that branch across updates; it is not resolved to a commit SHA at install time.

### Wipe of older lockfile versions

`readSkillLock()` (`src/skill-lock.ts:80-103`):

1. Reads the file. If it does not exist or fails to parse, returns a fresh, empty lockfile (`createEmptyLockFile()`).
2. If `version` is missing or not a number, or `skills` is missing: returns empty.
3. **If `parsed.version < CURRENT_VERSION` (i.e. an old-format lockfile): wipes it and returns empty.** Comment: "If old version, wipe and start fresh (backwards incompatible change). v3 adds skillFolderHash — we want fresh installs to populate it." (`src/skill-lock.ts:92-96`)

This wipe happens **in memory only** at read time — the old file on disk is not deleted until the next `writeSkillLock()` call overwrites it. A user who has a v2 lockfile and never runs another `add`/`update`/`remove` keeps the v2 file on disk; the first mutating command replaces it with a fresh v3 file that starts empty (all prior tracked skills lose their lock entries, though the skill folders themselves are untouched).

## 2. Project (local) lockfile: `skills-lock.json`

Source: `src/local-lock.ts`. Not the question's main focus, but relevant since `update`/`remove` scope resolution depends on it.

- Path: `./skills-lock.json` in the project root (`getLocalLockPath`, `src/local-lock.ts:65-67`). Not inside `.agents/`.
- `CURRENT_VERSION = 1` (`src/local-lock.ts:6`). Same wipe-on-old-version rule as the global lock (`src/local-lock.ts:86-88`).
- Per-skill entry (`LocalSkillLockEntry`, `src/local-lock.ts:15-46`) has no `installedAt`/`updatedAt` timestamps by design — the doc comment says this is deliberate, to keep the file diff-friendly for git ("Two branches adding different skills produce non-overlapping JSON keys that git can auto-merge cleanly," `src/local-lock.ts:11-14`).
- Hash field is `computedHash`: **SHA-256 over the concatenation of every file's relative path and content**, sorted by path for determinism (`computeSkillFolderHash`, `src/local-lock.ts:145-160`). This is a real content hash the CLI computes itself, unlike the global lock's GitHub-API-sourced tree SHA.
- Written with sorted skill keys and a trailing newline (`src/local-lock.ts:106-123`), explicitly for clean diffs.

## 3. Canonical directory layout

Source: `src/constants.ts` and `src/installer.ts`.

- `AGENTS_DIR = '.agents'`, `SKILLS_SUBDIR = 'skills'` (`src/constants.ts:1-2`).
- `getCanonicalSkillsDir(global, cwd)` (`src/installer.ts:98-101`):
  - Global: `~/.agents/skills/`
  - Project: `<cwd>/.agents/skills/`
- Each skill lives at `<canonical-dir>/<sanitized-skill-name>/`, e.g. `~/.agents/skills/my-skill/SKILL.md`.
- `sanitizeName()` (`src/installer.ts:50-65`) lowercases the name, replaces any run of characters outside `[a-z0-9._]` with a single hyphen, strips leading/trailing dots and hyphens, and truncates to 255 characters. This is a directory-traversal guard as well as a display-name-to-folder-name mapping (e.g. a plugin skill named `ce:review` becomes the folder `ce-review`).
- Agent-specific directories (`.claude/skills/`, `.cursor/skills/`, etc.) hold either a **symlink** to the canonical directory (default mode) or an **independent copy** (`--copy` flag or symlink-creation failure). See `installSkillForAgent` (`src/installer.ts:265-421`).
- "Universal" agents (agents whose skill directory IS `.agents/skills`) read the canonical directory directly and get no separate symlink (`isUniversalAgent` check, e.g. `src/installer.ts:365-372`).
- Eve agent subagents get a project-scoped variant: `<cwd>/agent/subagents/<name>/skills/` (`getEveSubagentSkillsDir`, `src/installer.ts:108-111`), independent of the `--global` flag.

## 4. Add / update / remove write behavior

### Add

`installSkillForAgent` and its `installRemoteSkillForAgent` / `installWellKnownSkillForAgent` / `installBlobSkillForAgent` siblings (`src/installer.ts`) all follow the same pattern for the canonical directory:

1. `cleanAndCreateDirectory(canonicalDir)` (`src/installer.ts:163-170`): `rm(path, { recursive: true, force: true })` then `mkdir(path, { recursive: true })`. This is a **destroy-then-recreate**, not an incremental sync — every file that existed under the old canonical directory is gone before the new content is written, whether or not the new content overlaps.
2. Copy or write the new skill's files into the now-empty directory.
3. Symlink (or copy) the agent-specific directory to the canonical directory, replacing any existing entry at that path (`createSymlink`, `src/installer.ts:197-263`).
4. Only after all of that succeeds, for global installs: `addSkillToLock(skillName, entry)` (`src/add.ts:1879-1887`, wrapping `src/skill-lock.ts:177-193`). This does a full **read-modify-write** of the whole `.skill-lock.json`: `readSkillLock()` → merge in the new entry, preserving `installedAt` if the skill already existed → `writeSkillLock(lock)`.
5. For project-scoped installs, the equivalent is `addSkillToLocalLock` (`src/add.ts:1916-1928`) against `skills-lock.json`.

Lock-file writes are wrapped in a `try/catch` that swallows errors — "Don't fail installation if lock file update fails" (`src/add.ts:1888-1890`). A failed lock write leaves the skill folder installed with no lock entry.

### Update

`update` never mutates the lockfile or skill folder directly. It:

1. Reads the lockfile (global: `readSkillLock()`; project: `readLocalLock()`), determines what changed by re-fetching the GitHub tree (or cloning) and comparing hashes (`src/update.ts:478-720` for global, `:722-927` for project).
2. For each skill that changed, **spawns a child process**: `node <cli.mjs> add <installUrl> --skill <name> -g -y` (`src/update.ts:693-707` global, `:891-913` project), i.e. it shells out to the exact same `add` code path described above, including the destroy-then-recreate directory write and the lock read-modify-write.
3. `spawnSync` is used with `shell: false` explicitly, to avoid command injection through attacker-influenced `ref`/URL values from the lockfile (comment at `src/update.ts:699-705` and `:907-911`).

So "update" write behavior is identical to "add" write behavior, run once per changed skill, sequentially, each as its own full read-modify-write of the lockfile.

### Remove

`removeCommand` (`src/remove.ts:61-361`):

1. Scans canonical dir + every known agent's skills dir (+ Eve subagents for project scope) for skill folders, and separately reads the lockfile's keys — a skill can exist as a stale lock entry with no folder, or a folder with no lock entry, and both are candidates.
2. For each skill being removed, deletes every agent-specific path except the canonical path first (`src/remove.ts:216-260`), then removes the canonical path itself only if no other currently-installed agent still needs it (`src/remove.ts:262-279`, guarding issue #287 in that repo — removing one agent's symlink should not break a still-linked agent).
3. Only after that, and only if the skill is no longer used by any agent, removes the lock entry: `removeSkillFromLock` (global) or `removeSkillFromLocalLock` (project) (`src/remove.ts:287-302`). Each of these is again a full read-modify-write (`delete lock.skills[name]` then `writeSkillLock`/`writeLocalLock`; `src/skill-lock.ts:198-208`, `src/local-lock.ts:202-212`).

The comment at `src/remove.ts:284-286` states the intentional invariant directly: "The lock entry tracks the canonical path, so it survives for as long as that path does. Dropping it while another installed agent still links the skill leaves the skill in place but no longer updatable."

## 5. Atomicity and two-writer behavior

There is **no file locking, no temp-file-plus-rename, and no advisory locking** anywhere in this codebase for either lockfile or for skill-folder writes. Evidence:

- `writeSkillLock` (`src/skill-lock.ts:109-118`) and `writeLocalLock` (`src/local-lock.ts:106-123`) both call `writeFile(lockPath, content, 'utf-8')` directly on the final path — a single `write(2)`-backed call, not a write-to-temp-then-`rename(2)` pattern. Node's `fs.writeFile` truncates-and-writes; it is not atomic against readers, and a crash mid-write can leave a partially-written or empty file.
- A grep for lock-related terms (`flock`, `proper-lockfile`, "advisory lock") across `package.json` and every `src/*.ts` file found no hits outside comments referring to `.skill-lock.json`/`skills-lock.json` themselves as "the lockfile" (i.e. no actual concurrency-control library or primitive is used).
- Every lockfile mutation (`addSkillToLock`, `removeSkillFromLock`, `dismissPrompt`, `saveSelectedAgents`, and their local-lock equivalents) follows the same **read-entire-file → mutate in memory → write-entire-file** pattern with no revision check in between. Two concurrent `npx skills` processes (e.g. two agents both running `add`/`remove` against the same global scope at once) can race: the second process's read happens before the first process's write, so the second process's write **silently discards** the first process's change. This is last-write-wins with no detection or warning.
- Directory writes for skill content have the same shape: `cleanAndCreateDirectory` (delete, then `mkdir`) followed by non-atomic file copies (`copyDirectory`, `src/installer.ts:462-514`, or the per-file `writeFile` loops in the `install*SkillForAgent` functions). A process reading a skill folder mid-install can observe a transient empty or partially-populated directory; a crash mid-copy leaves a partial skill folder with no automatic recovery on the next run (the next `add` will `rm -rf` and redo it; there is no separate corruption-detection step).

There is no `.lock`/PID-file mechanism guarding either the lockfile or the canonical skills directory against concurrent CLI invocations. The tool assumes single-writer usage.

## 6. `list --json -g` as a read API

Confirmed present in current source, `src/list.ts`:

- `parseListOptions` recognizes `--json` (`src/list.ts:62`) and `-g`/`--global` (`src/list.ts:60-61`) as independent flags — they combine freely, so `list --json -g` is a valid invocation covered directly by this parser.
- `runList` (`src/list.ts:76-129`): when `options.json` is true, it builds an array from `listInstalledSkills({ global: scope, agentFilter })` (an on-disk directory scan, `src/installer.ts:1078-1312`), joined with lockfile data (`getAllLockedSkills()` for global scope, `readLocalLock(cwd)` for project scope), and does one `console.log(JSON.stringify(jsonOutput, null, 2))`. No ANSI styling in this branch.
- JSON shape per skill (`src/list.ts:115-126`):

```json
{
  "name": "string",
  "path": "string (canonicalPath)",
  "scope": "global | project",
  "agents": ["Display Name", "..."],
  "source": "string | null",
  "sourceUrl": "string | null",
  "sourceType": "string | null"
}
```

- Empty-result case: with `--json` and zero installed skills, it prints the literal string `[]` (`src/list.ts:133-136`) rather than the human-readable "No skills found" message, so scripted callers get valid JSON in every case.
- This is a genuine read API: it does not touch the lockfile or skill folders, only reads them (`listInstalledSkills` does `readdir`/`stat`/`access` calls; `getAllLockedSkills`/`readLocalLock` are plain file reads). A caller (such as skills-bank) could shell out to `npx skills list --json -g` to get a snapshot of what `npx skills` currently believes is installed globally, without needing to parse `.skill-lock.json` directly.

## Summary of what changed vs. the older note

The prior note ([`npx-skills-cli-mechanics.md`](./npx-skills-cli-mechanics.md), written against an earlier commit) got the big picture right: symlink-by-default into `.agents/skills`, a v3 lockfile at `~/.agents/.skill-lock.json` (or XDG), keyed by skill name, with `source`/`sourceType`/`sourceUrl`/`ref`/`skillPath`/`skillFolderHash`. Re-reading current source (`1.5.22`, commit `c6f69c6`) adds detail that note did not have:

- The exact hash algorithm split: GitHub tree SHA for the global lock's fast path, falling back to a self-computed SHA-256 when the GitHub API path isn't used, with a 40-hex-char regex used at update time to tell the two apart.
- No file locking or atomic-rename anywhere; both lockfiles and skill folders are read-modify-write / delete-then-recreate with no protection against concurrent writers.
- `update` does not have its own write path — it shells out to `add` per changed skill.
- `list --json -g` exists exactly as expected and returns `source`/`sourceUrl`/`sourceType` per skill, which is a ready-made read API for external tools that don't want to parse `.skill-lock.json` themselves.
