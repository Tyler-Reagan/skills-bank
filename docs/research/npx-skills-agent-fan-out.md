# Research: `npx skills add` global fan-out — Cursor vs Claude Code

For [issue #221](https://github.com/Tyler-Reagan/skills-bank/issues/221).

Primary sources only:

- [vercel-labs/skills](https://github.com/vercel-labs/skills) source, `git clone --depth 1` at commit `c6f69c6` (2026-08-10), matching published npm `skills@1.5.22` (`npm view skills version`).
- [Cursor: Agent Skills docs](https://cursor.com/docs/skills) (live fetch, this session).
- AFX `~/.agents/core/references/skill-projection.md` (read directly), as a second, independent primary source for Cursor's discovery constraints. AFX is evidence, not a template Skills Bank must copy.

The prior note, [`docs/research/npx-skills-cli-mechanics.md`](./npx-skills-cli-mechanics.md), says agent directories "get a symlink" and universal agents "skip the redundant symlink." That is correct but incomplete: it does not name which agents are universal. This note fills that gap and confirms **Cursor is universal; Claude Code is not.**

## Answer, in short

`npx skills add <pkg> -g` writes skill content to exactly one real location: the canonical global store `~/.agents/skills/<skill>/`. What happens to each agent's own directory then splits into three behaviors, and Cursor and Claude Code land in different buckets:

| Agent | Global directory (`skills/src/agents.ts`) | What `add` does to it | Why |
| --- | --- | --- | --- |
| **Cursor** | `~/.cursor/skills` (the `globalSkillsDir` field) | **Nothing.** No file, no symlink, no directory. | `isUniversalAgent('cursor')` is `true` (see below), so `installSkillForAgent`/`installRemoteSkillForAgent`/`installWellKnownSkillForAgent`/`installBlobSkillForAgent` all hit the same short-circuit: `if (isGlobal && isUniversalAgent(agentType)) return { ...canonicalDir only... }` and return before ever calling `createSymlink`. |
| **Claude Code** | `~/.claude/skills` (or `$CLAUDE_CONFIG_DIR/skills`) | **Real directory symlink**: `~/.claude/skills/<skill>` → `~/.agents/skills/<skill>` | `isUniversalAgent('claude-code')` is `false`, so the code falls through to `createSymlink(canonicalDir, agentDir)`, which calls Node's `symlink()` on the whole skill directory. |

Cursor is not "skipped" in the sense of being left out. It is skipped in the sense that vercel-labs' installer never touches `~/.cursor/skills` at all, because Cursor's own client already reads `~/.agents/skills` directly — writing a second copy there would be redundant, not missing.

## Why Cursor counts as "universal" — the exact code path

`skills/src/agents.ts` defines each agent's `skillsDir` (the **project-relative** path used for project-scope installs) separately from `globalSkillsDir` (the **absolute** path used for global-scope installs and for `list`/`remove` cleanup):

```255:263:src/agents.ts
cursor: {
  name: 'cursor',
  displayName: 'Cursor',
  skillsDir: '.agents/skills',
  globalSkillsDir: join(home, '.cursor/skills'),
  detectInstalled: async () => {
    return existsSync(join(home, '.cursor'));
  },
},
```

Compare Claude Code:

```143:151:src/agents.ts
'claude-code': {
  name: 'claude-code',
  displayName: 'Claude Code',
  skillsDir: '.claude/skills',
  globalSkillsDir: join(claudeHome, 'skills'),
  detectInstalled: async () => {
    return existsSync(claudeHome);
  },
},
```

`isUniversalAgent()` checks only the `skillsDir` field, not `globalSkillsDir`:

```858:863:src/agents.ts
export function isUniversalAgent(type: AgentType): boolean {
  return agents[type].skillsDir === '.agents/skills';
}
```

Cursor's `skillsDir` is `'.agents/skills'`, the same string used by Amp, Cline, Codex, OpenCode, and about fifteen other agents. So Cursor is `isUniversalAgent === true`, even though it has its own non-`.agents` `globalSkillsDir`.

`getAgentBaseDir()` — the function that decides where an install actually lands — reads that flag first and, for a universal agent, ignores `globalSkillsDir` entirely:

```121:149:src/installer.ts
export function getAgentBaseDir(
  agentType: AgentType,
  global: boolean,
  cwd?: string,
  eveSubagent?: string
): string {
  if (isUniversalAgent(agentType)) {
    return getCanonicalSkillsDir(global, cwd);
  }
  // ... eve subagent case ...
  const agent = agents[agentType];
  const baseDir = global ? homedir() : cwd || process.cwd();
  if (global) {
    if (agent.globalSkillsDir === undefined) {
      return join(baseDir, agent.skillsDir);
    }
    return agent.globalSkillsDir;
  }
  return join(baseDir, agent.skillsDir);
}
```

For Cursor with `global: true`, this returns `getCanonicalSkillsDir(true)` = `~/.agents/skills` — not `~/.cursor/skills`. So `agentBase === canonicalBase` for Cursor. `installSkillForAgent` then short-circuits before any symlink call:

```358:372:src/installer.ts
// Symlink mode: copy to canonical location and symlink to agent location
await cleanAndCreateDirectory(canonicalDir);
await copyDirectory(skill.path, canonicalDir, agentType);

// For universal agents with global install, the skill is already in the canonical
// ~/.agents/skills directory. Skip creating a symlink to the agent-specific global dir
// (e.g. ~/.copilot/skills) to avoid duplicates.
if (isGlobal && isUniversalAgent(agentType)) {
  return {
    success: true,
    path: canonicalDir,
    canonicalPath: canonicalDir,
    mode: 'symlink',
  };
}
```

The comment names GitHub Copilot as the example, but Cursor hits the identical branch. `~/.cursor/skills` (the `globalSkillsDir` field) is left completely unused by every install function — the only places that field is read are `add.ts` (to build the interactive picker's hint text and to filter which agents support `-g` at all) and `remove.ts` (to scan for stale content during removal/cleanup, e.g. from an older `skills` version or a `--copy` install). Confirmed by searching all `globalSkillsDir` reads in the source: `src/add.ts:479,501,744,1539` and `src/remove.ts:99-100,229-230` are the only non-declaration, non-`installer.ts`-internal usages.

For Claude Code, `isUniversalAgent` is `false`, so `getAgentBaseDir` returns `agent.globalSkillsDir` (`~/.claude/skills`) unchanged, `agentDir !== canonicalDir`, and the code proceeds to:

```391:405:src/installer.ts
const symlinkCreated = await createSymlink(canonicalDir, agentDir);

if (!symlinkCreated) {
  // Symlink failed, fall back to copy
  await cleanAndCreateDirectory(agentDir);
  await copyDirectory(skill.path, agentDir, agentType);
  return { success: true, path: agentDir, canonicalPath: canonicalDir, mode: 'symlink', symlinkFailed: true };
}
```

`createSymlink` (`src/installer.ts:197-263`) calls Node's `fs.promises.symlink(relativePath, linkPath)` on the **whole skill directory** — a directory symlink, not a per-file symlink and not a copy. Only if `symlink()` throws does the code fall back to a full recursive `copyDirectory` and report `symlinkFailed: true` in the result (and, in the CLI output, that agent is bucketed under "copied:" rather than "symlinked:", per `buildResultLines` in `src/add.ts:363-397`).

## Confirmed from Cursor's own docs, independent of the installer's assumption

`vercel-labs/skills` assumes Cursor already reads `~/.agents/skills` and therefore needs nothing written to `~/.cursor/skills`. [cursor.com/docs/skills](https://cursor.com/docs/skills) (fetched live this session) confirms that assumption directly, under "Skill directories":

> | Location | Scope |
> | --- | --- |
> | `.agents/skills/` | Project-level |
> | `.cursor/skills/` | Project-level |
> | `~/.agents/skills/` | User-level (global) |
> | `~/.cursor/skills/` | User-level (global) |
>
> For compatibility, Cursor also loads skills from Claude and Codex directories: `.claude/skills/`, `.codex/skills/`, `~/.claude/skills/`, and `~/.codex/skills/`.

So Cursor natively scans four global paths, `~/.agents/skills` among them. Writing only to `~/.agents/skills` is sufficient for Cursor to discover the skill — no compatibility gap.

## Second primary source: AFX's Cursor mirror shows why a plain directory symlink is not universally safe

AFX (`~/.agents/core`, this machine's cross-IDE agent framework) independently arrived at a Cursor/Claude split, but for a different reason and with a different mechanism. Per `references/skill-projection.md` (read directly, not summarized secondhand):

- **Claude Code**: AFX projects skills as a **plain directory symlink** — `~/.claude/skills/<name>` → the core skill directory — citing [Claude Code's skills docs](https://code.claude.com/docs/en/skills), which state a skill folder "can be a symlink to a directory elsewhere on disk" and that Claude Code follows it.
- **Cursor**: AFX projects skills as a **"mirror"** — a real `~/.cursor/skills/<name>/` directory whose individual files are symlinks into the core skill. Not a directory-level symlink.

AFX's stated reason: in the shipped `cursor-agent` 2026.01.23 bundle it inspected, the discovery walk does `readdir(dir, { withFileTypes: true })` and checks `dirent.isDirectory()` to decide whether to descend into a skill folder. A `Dirent` for a symlinked directory reports `isSymbolicLink() === true` and `isDirectory() === false`, so a plain directory symlink would be **silently skipped** by that walk — even though a later `stat()` on the inner `SKILL.md` does follow symlinks. AFX's mirror mode keeps the outer directory real (passes the `isDirectory()` check) while every file inside is a link, satisfying both a strict, non-symlink-following walk and a permissive one. AFX flags this as a measured-but-possibly-stale constraint: the doc notes the current Cursor docs describe a **recursive** skills walk (unlike the old bundle), so the current app may already follow symlinked directories — in which case AFX's `mirror` and Claude's `symlink` modes are meant to collapse into the same one-word `settings.json` config change, "no code edit."

**This does not mean Skills Bank should copy AFX's mirror mode.** AFX is evidence that a naive directory symlink into `~/.cursor/skills` was, at some past point on this machine's Cursor build, a real discoverability risk. vercel-labs/skills sidesteps that particular risk by a different route: it never symlinks *into* `~/.cursor/skills` at all for a global install, because it treats `~/.agents/skills` (confirmed above as one of Cursor's four native scan paths) as sufficient. Whether that is safe depends only on whether Cursor's *current* build reliably scans `~/.agents/skills` — which the live docs fetch above says it does — not on whether directory symlinks into `~/.cursor/skills` specifically are walk-safe.

## `-a`/`-y` fan-out mechanics (confirms/extends the prior note)

From `src/cli.ts`'s embedded help text and `src/add.ts`'s target-resolution logic:

- `-a, --agent <agents...>` accepts explicit agent ids (e.g. `--agent claude-code cursor`) or the literal `'*'` to mean every one of the 70+ registered agents.
- `-y, --yes` skips prompts. Combined with `-a`, or alone with agents already detected, it drives which agents are targeted without an interactive picker.
- `--all` is sugar for `--skill '*' --agent '*' -y`.
- When no `-a` is given and agents are auto-selected (one agent detected, or `-y` with any number detected), `ensureUniversalAgents()` (`src/add.ts:350-361`) force-appends **every** universal agent — Cursor included — to the target list, regardless of whether `~/.cursor` was actually detected on disk:

  ```350:361:src/add.ts
  function ensureUniversalAgents(targetAgents: AgentType[]): AgentType[] {
    const universalAgents = getUniversalAgents();
    const result = [...targetAgents];
    for (const ua of universalAgents) {
      if (!result.includes(ua)) {
        result.push(ua);
      }
    }
    return result;
  }
  ```

  Practical effect: an auto-selected or `-y` install always populates `~/.agents/skills`, whether or not Cursor is actually installed on the machine — it is treated as an always-on target, not a detected one.
- The **interactive** picker (`selectAgentsInteractive`, `src/add.ts:475-535`) makes this visible to the user: universal agents (including Cursor) render in a **locked** section titled `"Universal (.agents/skills)"` and cannot be deselected; only non-universal agents (including Claude Code) are toggleable checkboxes.
- Explicit `-a claude-code` (naming only non-universal agents, no `'*'`) does **not** call `ensureUniversalAgents` — `targetAgents` is exactly what was passed. So a user can choose to install *only* to Claude Code's directory and skip populating `~/.agents/skills`/Cursor, by being explicit.
- The CLI's own post-install summary (`buildResultLines`, `src/add.ts:363-397`) labels results in three buckets: `universal:` (Cursor and friends — no symlink attempted), `symlinked:` (Claude Code and other non-universal agents where `symlink()` succeeded), `copied:` (non-universal agents where `symlink()` threw and the code fell back to a full copy).

## `--copy` mode changes the picture, but not the Cursor/Claude split

`--copy` forces `installMode = 'copy'` for every install function. In that mode, `installSkillForAgent` writes directly to each `agentDir` via `copyDirectory`, bypassing the canonical store and the universal-agent short-circuit entirely (`src/installer.ts:336-346`). That means with `--copy`, a universal agent's directory (Cursor's project-relative `.agents/skills`, or, if selected, any non-universal agent's own dir) each get an **independent full copy** — no linking of any kind, canonical or otherwise. This is orthogonal to the Cursor/Claude distinction: `--copy` copies to whatever `agentDir` `getAgentBaseDir` resolves to per agent, and for Cursor that is still the same `.agents/skills` path (global or project), not `~/.cursor/skills` — `--copy` does not make Cursor stop being universal, it only changes symlink vs. copy for the *installer's own file-write*, and Cursor's `globalSkillsDir` field is still never consulted for the write.

## Corrections to the prior note

[`docs/research/npx-skills-cli-mechanics.md`](./npx-skills-cli-mechanics.md) is directionally correct but should be read together with this note:

- Its claim `'Universal' agents skip the redundant symlink and read the canonical directory directly` is accurate, but it does not name Cursor as one of those agents. This note confirms Cursor is universal (`skillsDir === '.agents/skills'`) and Claude Code is not.
- Add: Cursor's own `globalSkillsDir` field (`~/.cursor/skills`) exists in the agent registry only for UI hints and removal/cleanup scanning — the actual global install path for Cursor never writes there.
- Everything else in the prior note (lockfile schema, `sourceUrl` field, copy-mode fallback-on-symlink-failure, multi-harness auto-detection being install-time-only) still checks out against this session's re-read of the same v1.5.22 source and is not contradicted here.

## Answer to the issue's literal question

> When `npx skills add` runs globally, which agent directories does it write, and how (dir-symlink, file copy, skip)?

- **Cursor: skip.** No write to `~/.cursor/skills` at all — content lands only in `~/.agents/skills/<skill>`, which Cursor's own client scans natively (confirmed on Cursor's docs page, independent of the installer's source).
- **Claude Code: dir-symlink.** `~/.claude/skills/<skill>` is created as a real directory symlink pointing at `~/.agents/skills/<skill>`, falling back to a full recursive file copy only if the OS `symlink()` call itself fails.
- **Every other non-universal, detected agent** (Cline's `.cline`-gated dir, Windsurf, Codex's CLI-specific compat dirs, etc.): same dir-symlink-with-copy-fallback pattern as Claude Code, keyed off each agent's own `globalSkillsDir`.
- **`--copy` flag**: turns every target (universal or not) into an independent full-directory copy, no canonical store involved.
