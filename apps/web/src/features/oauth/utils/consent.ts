// The OAuth consent step. The API's OAuth provider sends the browser to the consent
// page (and, without a session, to the login page first) with its signed
// authorization query in the URL; the page posts the person's answer back with that
// query unchanged, and the API checks its signature.

export function requestedScopes(oauthQuery: string): string[] {
  const scope = new URLSearchParams(oauthQuery).get('scope') ?? '';
  return scope.split(' ').filter(Boolean);
}

// The teams an application installed with actor=app may use: every public team
// (including ones created later) and the listed teams.
export interface InstallSelection {
  publicTeams: boolean;
  teamIds: string[];
}

// The body of the plugin's consent endpoint. Accepting grants every requested scope;
// an install also carries its team selection, which the API checks.
export function consentBody(input: {
  accept: boolean;
  oauthQuery: string;
  install?: InstallSelection;
}): Record<string, unknown> {
  const body: Record<string, unknown> = { accept: input.accept, oauth_query: input.oauthQuery };
  if (input.accept && input.install) {
    body.app_public_teams = input.install.publicTeams;
    body.app_team_ids = input.install.teamIds;
  }
  return body;
}
