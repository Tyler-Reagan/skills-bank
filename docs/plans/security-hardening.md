# Security hardening (v0.11.8)

Picks up the seven deferred items from the v0.11.4 electron-security audit (`docs/audits/v0.11.4-electron-security.md` §D1–D7). Theme: **pre-production security hardening.**

The v0.11.4 audit confirmed the baseline posture is already strong (`contextIsolation: true`, `nodeIntegration: false`, `safeStorage` on OAuth token, CSP, sandbox on Discover view, allowlists on `openPath` / `openExternal`). These items trade off against UX, packaging, or maintenance cost — they want maintainer judgement.

## Milestones

1. **Stricter CSP — eliminate `'unsafe-inline'` for styles.** Renderer uses inline `style` attributes from React + the design system. Tighten to nonce-based or hashed inline-style policy; coordinate with Vite. Possibly extract any remaining inline `<style>` elements to CSS Modules / classnames first.
2. **`safeStorage` decision.** On Linux without a libsecret-providing keyring, `safeStorage` falls back to basic obfuscation. Either: (a) accept the fallback and document the policy; (b) switch to `keytar` with explicit native-keychain requirement; (c) implement a tiered storage with explicit user-facing notice when the system can't keychain. Make the call; commit it as ADR-0004.
3. **Encrypt `device-flow.json` at rest.** `auth.ts:127–128` writes mid-flow recovery state as plaintext JSON. Encrypt via `safeStorage` if M2 keeps it. Cost: breaks the documented "user can inspect and clear" affordance — decide whether the trade-off is worth it given device codes are short-lived (~15 min).
4. **Disable `toggleDevTools` in packaged builds.** `main.ts:~1170` includes `role: "toggleDevTools"` in the View menu in packaged builds. Pro: power-user diagnosability. Con: social-engineering vector ("paste this into the console"). Either remove from packaged builds or gate behind an env flag + warning toast. Decision goes into ADR-0005.
5. **Guardrails on `pickCustomSkillsDir` / `setRegistryRoot`.** Both let the user point the app at any directory the OS allows. Add a soft validator (warn but allow) when the chosen path is at a system root, the user's home, or a path with >N skills children that don't have valid `meta.json` (suggesting the user picked the wrong dir).
6. **CSP on embedded Discover view.** We trust skills.sh's own response headers today. Add a `webRequest.onHeadersReceived` interceptor to enforce a minimum CSP on the Discover view's responses — defense-in-depth in case skills.sh ever ships content we want to constrain. Optional; gate behind whether a real concern surfaces.
7. **GitHub App migration (D4).** Out of scope for v0.11.8 — tracked in the existing `github-mode-coherence` / `github-first-onboarding` plans. Just note the cross-reference here.

## Conflict audit

- **vs v0.11.5 a11y, v0.11.6 renderer state.** Different surfaces. Independent.
- **vs v0.11.7 core tests.** v0.11.7 lands first so IPC handler changes here can leverage the core test net.
- **vs v0.11.9 core refactor.** v0.11.9 also touches `main.ts`. Sequence v0.11.8 → v0.11.9 so the security hardening is in the baseline when v0.11.9 starts moving handlers around.
- **vs v0.11.10 Origin rename.** Identifier-level. Independent of security mechanics.

## Risk

Medium-high. M1 (stricter CSP) can break renderer rendering; M2 (storage migration) can break sign-in on certain Linux configs. Each milestone gets its own commit; revert plan is simple per-commit.

## Exit criteria

- All deferred items either landed or explicitly re-deferred with a noted threat-model justification.
- ADR-0004 (storage decision) and ADR-0005 (devtools decision) written.
- Sign-in works on macOS + at least one Linux config (Ubuntu Desktop with gnome-keyring).
- `pnpm typecheck && pnpm validate && pnpm build:index && pnpm test && pnpm knip && pnpm build` clean.
