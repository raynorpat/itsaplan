import { AsyncLocalStorage } from 'node:async_hooks';
import type { OAuthScope } from '@repo/auth';

// How the current request authenticated. A session cookie and an API key act with the
// user's full rights; an OAuth token acts within its scopes. Set around the GraphQL
// execution of a request (graphql/mount.ts), so code far from the request (the
// workspace role check in shared/access.ts) can apply the token's scopes.
export type RequestAuth =
  | { kind: 'session' | 'apiKey'; userId: string }
  | { kind: 'oauth'; userId: string; clientId: string; scopes: OAuthScope[] };

const storage = new AsyncLocalStorage<RequestAuth>();

export function runWithAuth<T>(auth: RequestAuth, run: () => T): T {
  return storage.run(auth, run);
}

export function currentAuth(): RequestAuth | undefined {
  return storage.getStore();
}

// Whether the request may use the user's admin rights: always, except an OAuth token
// without the `admin` scope (Linear's rule for admin operations).
export function mayUseAdminRights(userId: string): boolean {
  const auth = currentAuth();
  if (!auth || auth.kind !== 'oauth' || auth.userId !== userId) return true;
  return auth.scopes.includes('admin');
}
