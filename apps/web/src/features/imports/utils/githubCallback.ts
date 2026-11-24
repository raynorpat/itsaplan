// The GitHub Import App connection. Before sending the admin to GitHub, the Import
// page stores a random state under GITHUB_STATE_KEY in sessionStorage and adds it to
// the install link; GitHub returns it to the callback page with the OAuth code and the
// installation id, and the callback goes on only when it matches, so a callback link
// someone else made cannot connect their installation.

export const GITHUB_STATE_KEY = 'githubImportState';

export type GithubCallback = { code: string; installationId: string } | { error: string };

export function githubCallbackParams(
  params: URLSearchParams,
  storedState: string | null,
): GithubCallback {
  const state = params.get('state');
  if (!storedState || state !== storedState)
    return { error: 'This GitHub connection was not started from this browser. Start it again.' };
  const code = params.get('code');
  const installationId = params.get('installation_id');
  if (!code || !installationId)
    return { error: 'GitHub did not return an authorization. Start the connection again.' };
  return { code, installationId };
}
