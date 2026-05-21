# ADR-0004 — `safeStorage` tier with explicit notice (Linux)

**Status:** Accepted (v0.11.8)

## Context

`packages/desktop/src/main/auth.ts` persists the GitHub OAuth token via
Electron's `safeStorage`. On macOS and Windows that's Keychain /
DPAPI — strong, OS-managed encryption. On Linux it depends on a
`libsecret`-providing keyring (`gnome-keyring`, `kwallet`, etc.).
**When no keyring is available, Electron's `safeStorage` silently
falls back to a `basic_text` backend that "encrypts" with a hardcoded
seed.** This is obfuscation, not encryption — anyone with file-read
access on the user's machine can recover the token.

`safeStorage.isEncryptionAvailable()` returns `true` even when only the
`basic_text` fallback is in play, so the pre-v0.11.8 code path
(`auth.ts:162`) silently admitted the weak encryption case. The user
was unaware their token was effectively stored in cleartext.

Three options were considered:

- **(a) Accept fallback, document.** Lowest cost; quiet failure mode
  the user can't reason about. Rejected — silently admits a security
  posture we wouldn't otherwise allow.
- **(b) Require native keychain (`keytar` or hard error on Linux
  without libsecret).** Locks out legitimate users on headless
  servers, containers, minimal window managers, and CI runners.
  Heavy-handed. Rejected.
- **(c) Tier with explicit user notice.** Token still gets stored
  (basic_text encryption); the renderer surfaces a one-time toast
  the first time the fallback is detected, telling the user the
  encryption is weak and recommending Sign out when done.

## Decision

**Adopt (c).** The detection key is
`safeStorage.getSelectedStorageBackend()` — values `"basic_text"`
on Linux without a keyring indicate the obfuscation fallback. Other
return values (`"gnome_libsecret"`, `"kwallet"`, `"keychain"`,
`"dpapi"`) are real OS-managed encryption.

Implementation outline:

- On token write, capture the backend value and persist it in
  `config.json` alongside the encrypted token blob.
- On boot, if `backend === "basic_text"` and the user hasn't already
  dismissed the warning for this storage realm, the renderer
  surfaces a sticky error toast: _"Your system has no usable keyring
  — the GitHub token is stored with weak encryption. Sign out when
  you're done."_ Toast carries a Sign-out action that routes to the
  same handler the account modal uses.
- Dismissal is persistent (`weakStorageNoticeDismissedFor: <backend>`
  in `config.json`). Re-shown if the backend changes (e.g. user
  installed a keyring later).
- `safeStorage.encrypt`/`decrypt` calls themselves don't change —
  they keep using whatever backend Electron picks. The ADR is
  purely about user-facing notice.

## Consequences

- Linux users on minimal systems get a working app + an honest
  notice. They can install a keyring (recommended path) or accept
  the weak encryption with eyes open.
- macOS / Windows users see nothing — the notice fires only when
  `basic_text` is detected.
- The detection is cheap (one IPC call at boot); the toast is the
  only UI surface.
- Future hardening (M3 — encrypt device-flow.json) is independent;
  this ADR governs the _user notice_ policy, not the _what gets
  encrypted_ policy.

## Re-opening this decision

A future revisit is warranted if:

1. Electron's `safeStorage` API gains a "fail loudly when no real
   keyring" mode, in which case the current basic_text-silently-on
   default could become opt-in.
2. We start storing genuinely sensitive secrets beyond the GitHub
   OAuth token (e.g. private-key material, billing credentials),
   in which case the policy may need to tighten to "no token
   storage at all on `basic_text` systems."

Otherwise: tier-with-notice is the long-term answer.
