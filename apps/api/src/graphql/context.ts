import {
  APIError,
  type auth,
  getActiveSession,
  OAUTH_ACCESS_TOKEN_PREFIX,
  resolveOAuthAccessToken,
} from '@repo/auth';
import { db, user as userTable } from '@repo/db';
import { eq } from 'drizzle-orm';
import { ACCESS_KEY_PREFIX, type ResolvedAccessKey } from '../releases/keys';
import type { RequestAuth } from '../shared/request-auth';

// The authenticated user of a request (a better-auth session user).
export type SessionUser = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>['user'];

export interface GraphQLContext {
  user: SessionUser;
  auth: RequestAuth;
  // Set instead of a user for a request made with a release pipeline access key, which
  // reaches only the access key operations (anonymous.ts ACCESS_KEY_FIELDS).
  accessKey?: ResolvedAccessKey;
  // Entries a resolver adds to the response's top-level `extensions` (mount.ts
  // resultExtensions), for data Linear's payload types have no field for.
  extensions: Record<string, unknown>;
}

// The release pipeline access key a request carries (`Authorization: Bearer itpr_…`,
// or as `x-api-key`), or null. Such a credential never goes to better-auth's API key
// lookup.
export function accessKeyCredential(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  const credential = authorization
    ? authorization.replace(/^Bearer\s+/i, '').trim()
    : (request.headers.get('x-api-key') ?? '').trim();
  return credential.startsWith(ACCESS_KEY_PREFIX) ? credential : null;
}

export interface ResolvedAuth {
  user: SessionUser;
  auth: RequestAuth;
}

// The user an OAuth access token acts for, or null when the token or its user is not
// valid (unknown, expired, revoked, suspended). Also used by the MCP endpoint.
export async function resolveOAuth(token: string): Promise<ResolvedAuth | null> {
  const grant = await resolveOAuthAccessToken(token);
  if (!grant) return null;
  const [row] = await db.select().from(userTable).where(eq(userTable.id, grant.userId));
  if (!row || row.suspendedAt) return null;
  return {
    user: row as unknown as SessionUser,
    auth: { kind: 'oauth', userId: row.id, clientId: grant.clientId, scopes: grant.scopes },
  };
}

// Who a GraphQL request acts as, and how it authenticated, or null when it carries no
// valid credentials. The Linear SDK sends a personal API key as `Authorization: <key>`
// and an OAuth access token as `Authorization: Bearer <token>`; an API key with
// `Bearer` is accepted too. OAuth tokens are told apart by their prefix. An API key is
// passed to better-auth as `x-api-key`, which resolves it to the owner's session.
// Without an Authorization header the session cookie (or
// x-api-key) is used. Invalid credentials resolve to null, not an error.
export async function resolveGraphQLAuth(request: Request): Promise<ResolvedAuth | null> {
  const headers = new Headers(request.headers);
  const authorization = headers.get('authorization');
  if (authorization) {
    const credential = authorization.replace(/^Bearer\s+/i, '').trim();
    if (credential.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) return resolveOAuth(credential);
    headers.set('x-api-key', credential);
    headers.delete('authorization');
  }
  try {
    const session = await getActiveSession(headers);
    if (!session) return null;
    const kind = headers.get('x-api-key') ? 'apiKey' : 'session';
    return { user: session.user, auth: { kind, userId: session.user.id } };
  } catch (err) {
    // better-auth throws for an unknown, expired or disabled API key.
    if (err instanceof APIError) return null;
    throw err;
  }
}
