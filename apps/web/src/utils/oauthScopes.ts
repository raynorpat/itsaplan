// Linear's OAuth scopes in the words the consent screen and the authorized-apps lists
// show. `actor:app` (the API's marker for an install with actor=app) and
// `offline_access` (refresh tokens) are internal and never shown.

const APP_INSTALL_SCOPE = 'actor:app';
const HIDDEN = new Set([APP_INSTALL_SCOPE, 'offline_access']);

const LABELS: Record<string, string> = {
  read: 'Read your issues, projects, documents and workspace data',
  write: 'Create and change issues, comments, projects and documents',
  'issues:create': 'Create issues and their attachments',
  'comments:create': 'Create comments',
  admin: 'Act with your admin rights',
  'app:assignable': 'Be delegated issues',
  'app:mentionable': 'Be mentioned',
};

export interface ScopeDescription {
  scope: string;
  label: string;
}

export function describeScopes(scopes: string[]): ScopeDescription[] {
  const seen = new Set<string>();
  const result: ScopeDescription[] = [];
  for (const scope of scopes) {
    if (HIDDEN.has(scope) || seen.has(scope)) continue;
    seen.add(scope);
    result.push({ scope, label: LABELS[scope] ?? scope });
  }
  return result;
}

// Whether an authorization installs the application as an app user (actor=app).
export function isAppInstall(scopes: string[]): boolean {
  return scopes.includes(APP_INSTALL_SCOPE);
}
