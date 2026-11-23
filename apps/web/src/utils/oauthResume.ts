// A sign-in that starts from an OAuth authorization: the API's OAuth provider sends a
// browser without a session to the login page with its signed authorization query,
// and after the sign-in the web app resumes that authorization (/oauth/resume).

// Whether a page's query string is the plugin's signed authorization query.
export function isOAuthQuery(search: string): boolean {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return params.has('client_id') && params.has('sig');
}

// Where the login page sends the browser after a sign-in that started from an
// authorization: the page that resumes it. Null outside an authorization.
export function oauthResumePath(search: string): string | null {
  if (!isOAuthQuery(search)) return null;
  const query = search.startsWith('?') ? search.slice(1) : search;
  return `/oauth/resume?${query}`;
}
