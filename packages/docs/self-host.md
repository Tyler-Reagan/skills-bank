# Self-hosting Skills Bank

If you want full control over both the app and the registry, fork this repo and ship your own build. This page covers what you need to do.

## What "self-host" means

Self-hosting transfers maintenance of **both the app binary and the registry** to you:

- You publish your own DMG (and update feed) from your fork's GitHub Releases.
- Your fork's `skills/` directory is the canonical registry that your installed app's "Sync" button pulls from.
- You opt out of receiving upstream updates from `Tyler-Reagan/skills-bank`.

> [!NOTE]
> If you only want a different registry (not a different app), you don't need to self-host — sign in with GitHub from Account and link your own repo as the registry source. See [Sign in with GitHub](/guides/sign-in).

## Steps

1. **Fork the repo.** Click _Fork_ on [github.com/Tyler-Reagan/skills-bank](https://github.com/Tyler-Reagan/skills-bank). Use a name that's distinct from `skills-bank` if you plan to distribute.

2. **Update `electron-builder` publish config** to point at your fork.
   In `packages/desktop/package.json`, change:

   ```json
   "publish": {
     "provider": "github",
     "owner": "Tyler-Reagan",
     "repo": "skills-bank",
     "releaseType": "draft"
   }
   ```

   to your fork's `owner` / `repo`.

3. **Update the canonical sync source** in two files — both define these constants independently:

   `packages/desktop/src/main/main.ts`:

   ```ts
   const CANONICAL_OWNER = "Tyler-Reagan";
   const CANONICAL_REPO = "skills-bank";
   ```

   `packages/desktop/src/main/ipc-manifest.ts`:

   ```ts
   const CANONICAL_OWNER = "Tyler-Reagan";
   const CANONICAL_REPO = "skills-bank";
   ```

   Replace with your fork's owner and repo in both files.

4. **(Optional) Register a new GitHub OAuth App** for the auth flow if you want users of your fork to authenticate against a different application identity. See `packages/desktop/src/main/auth-config.ts` for the steps. If you skip this, the Authenticate button on the LoginScreen will be disabled in your build.

5. **(Optional) Code-sign and notarize.** Unsigned DMGs require a right-click → Open on first launch. If you want a smooth Gatekeeper experience, set up an Apple Developer ID and add the `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` secrets to your fork. Then flip `mac.identity` from `null` and add `mac.notarize: true` in `packages/desktop/package.json`. The release workflow already reads these env vars.

6. **Cut a release.** Tag with `v*` (e.g. `git tag v0.3.0 && git push origin v0.3.0`); the release workflow will produce DMGs and create a draft release in your fork. Publish the draft when ready.

7. **Maintain the registry.** Add or remove skills under `skills/<bucket>/<name>/` (e.g. `skills/personal/<name>/`) in your fork. Users who installed your build and chose **Continue without** on the login screen will pull updates from your fork via Sync. You're now responsible for both the skills and any future app releases.

## Things you don't get for free

- **No automatic upstream updates.** If you want to pick up changes from `Tyler-Reagan/skills-bank`, merge them into your fork manually.
- **No support.** This is open source; bugs in your fork are yours.
