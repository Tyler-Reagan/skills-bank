// GitHub OAuth App Client ID for Device Flow.
//
// To enable authentication, register an OAuth App at
//   https://github.com/settings/applications/new
// with these settings:
//   - Application name:  Skills Bank (or your fork's name)
//   - Homepage URL:      https://github.com/Tyler-Reagan/skills-bank
//   - Authorization callback URL: any value (Device Flow ignores it)
//   - Enable Device Flow: ✅ (required)
//
// Then assign your Client ID to GITHUB_CLIENT_ID below.
// The Client ID is NOT a secret — it's safe to commit to source.
//
// IMPORTANT: only edit the GITHUB_CLIENT_ID line. Do NOT find-replace
// the literal placeholder string elsewhere in this file — the
// PLACEHOLDER constant must keep that exact value because
// isAuthConfigured() compares against it to detect "user has set a
// real value." A bulk find-replace will break that check and the
// LoginScreen Authenticate button will stay disabled.

const PLACEHOLDER = "REPLACE_WITH_OAUTH_APP_CLIENT_ID";

export const GITHUB_CLIENT_ID: string = "Ov23liOmNnUsuI3JpRau";

export function isAuthConfigured(): boolean {
  return GITHUB_CLIENT_ID !== PLACEHOLDER && GITHUB_CLIENT_ID.length > 0;
}

// Scope: read access to private repos (for the M4 registry-replacement
// feature, which lists the user's repos and clones a chosen one).
// "repo" grants more than we strictly need — GitHub doesn't offer a
// finer-grained read-only OAuth App scope. A future migration to a
// GitHub App can tighten this.
export const GITHUB_SCOPE = "repo";
