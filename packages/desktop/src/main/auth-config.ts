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
// Then copy the resulting Client ID into the constant below.
// The Client ID is NOT a secret — it's safe to commit to source.
//
// Until this is replaced, the LoginScreen surfaces a "GitHub auth not
// configured" message and the Authenticate button is disabled.

export const GITHUB_CLIENT_ID: string = "Ov23liOmNnUsuI3JpRau";

export function isAuthConfigured(): boolean {
  return (
    GITHUB_CLIENT_ID !== "Ov23liOmNnUsuI3JpRau" && GITHUB_CLIENT_ID.length > 0
  );
}

// Scope: read access to private repos (for the M4 registry-replacement
// feature, which lists the user's repos and clones a chosen one).
// "repo" grants more than we strictly need — GitHub doesn't offer a
// finer-grained read-only OAuth App scope. A future migration to a
// GitHub App can tighten this.
export const GITHUB_SCOPE = "repo";
