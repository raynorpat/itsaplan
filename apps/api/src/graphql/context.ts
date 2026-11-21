import { APIError, auth } from '@repo/auth';
import type { SessionUser } from '../shared/auth-context';

export interface GraphQLContext {
  user: SessionUser;
}

// The user a GraphQL request acts as, or null when it carries no valid
// credentials. The Linear SDK sends a personal API key as `Authorization: <key>`;
// `Authorization: Bearer <key>` is accepted too. The key is passed to better-auth
// as `x-api-key`, which resolves it to the owner's session the same way REST does.
// Without an Authorization header the session cookie (or x-api-key) is used. An
// invalid key resolves to null, not an error.
export async function resolveGraphQLUser(request: Request): Promise<SessionUser | null> {
  const headers = new Headers(request.headers);
  const authorization = headers.get('authorization');
  if (authorization) {
    headers.set('x-api-key', authorization.replace(/^Bearer\s+/i, '').trim());
    headers.delete('authorization');
  }
  try {
    const session = await auth.api.getSession({ headers });
    return session?.user ?? null;
  } catch (err) {
    // better-auth throws for an unknown, expired or disabled API key.
    if (err instanceof APIError) return null;
    throw err;
  }
}
