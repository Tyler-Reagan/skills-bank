# ADR-0005 — Disable `toggleDevTools` in packaged builds

**Status:** Accepted (v0.11.8)

## Context

Electron's default application menu — which Skills Bank inherits via
`Menu.setApplicationMenu(null)`'s absence and the default `View` menu
construction — includes a `toggleDevTools` role
(`main.ts:1178`). In packaged builds this gives every end user a
menu-accessible way to open DevTools (Cmd/Ctrl+Alt+I, or
View → Toggle Developer Tools).

The pro: any user can self-diagnose by reading the renderer console.
The con: **"paste this into the console" is one of the more durable
social-engineering vectors against non-technical users.** A user on
Discord, Slack, or a forum is shown a screenshot and prompted to
paste an exfiltration payload into the DevTools console; once in,
the script has `window.skillsBank` access to every IPC method —
listRegistry, exportRegistry, every token-touching call.

Three options were considered:

- **(a) Keep as-is.** Maintainer-friendly; user-hostile under the
  social-engineering threat model. Rejected.
- **(b) Env-flag gate + warning toast.** Power-user opt-in. Adds
  ceremony (env var, on-screen warning) for ~1% of users.
- **(c) Remove the menu role when `app.isPackaged`. Keep in dev.**
  The maintainer-diagnostic case is already covered by the existing
  `SKILLS_BANK_DEVTOOLS=1` env var that auto-opens DevTools on a
  packaged build's boot (`main.ts:1223`). End users get no
  console-paste vector.

## Decision

**Adopt (c).** When `app.isPackaged === true`, filter the `View`
menu's `submenu` to drop entries whose role is `toggleDevTools`.
In development (`!app.isPackaged`), the role stays.

Implementation:

```ts
// Default View menu, minus toggleDevTools in packaged builds.
const viewSubmenu: MenuItemConstructorOptions[] = [
  { role: "reload" },
  { role: "forceReload" },
  ...(app.isPackaged ? [] : [{ role: "toggleDevTools" } as const]),
  { type: "separator" },
  // ... existing entries
];
```

The existing `SKILLS_BANK_DEVTOOLS=1` env-var auto-open path is
unchanged — a maintainer debugging a packaged build sets the env
var when launching the .app bundle and DevTools opens
automatically. No menu surface required.

## Consequences

- End users on packaged builds can't open DevTools via the menu
  or its keyboard shortcut. Removes the console-paste social-
  engineering vector entirely.
- Power users with a legitimate need to inspect (e.g. file a
  detailed bug report) can still do so by launching the app with
  `SKILLS_BANK_DEVTOOLS=1`. The path is documented in CLAUDE.md.
- Developers (`pnpm dev`, `pnpm start`) see no change — the menu
  role stays in non-packaged builds.
- The keyboard shortcut (Cmd/Ctrl+Alt+I) is bound to the menu
  role; removing the role removes the binding. Confirmed via
  Electron's menu semantics — there's no global keyboard handler
  to re-strip separately.

## Re-opening this decision

A future revisit is warranted if:

1. The product gains an in-app diagnostic surface (a packaged
   "view logs" pane, an embedded crash reporter, etc.) that
   replaces the legitimate "I need to see what the renderer just
   did" use case. At that point DevTools isn't even the right
   answer — the in-app surface is.
2. The threat model shifts (e.g. we ship to a sandboxed corporate
   environment where the social-engineering vector is mitigated
   externally and the maintainer-friendly menu surface is more
   valuable).

Otherwise: removed-in-packaged is the long-term answer.
