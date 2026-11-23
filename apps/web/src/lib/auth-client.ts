import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields } from 'better-auth/client/plugins';
import { magicLinkClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';
import { apiKeyClient } from '@better-auth/api-key/client';
import { API_URL, ApiError } from '@/lib/graphql';

// The better-auth handler lives on the backend (Elysia), so baseURL is the API origin.
// inferAdditionalFields declares the custom `workspaceRole` column added in
// @repo/auth so the session user is typed with it (the web app never imports server
// packages).
export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [
    inferAdditionalFields({
      user: {
        // Server-assigned (see @repo/auth) — not part of the sign-up input.
        workspaceRole: { type: 'string', input: false },
      },
    }),
    // WebAuthn passkeys: signIn.passkey() and passkey.addPasskey().
    passkeyClient(),
    // Personal API keys: apiKey.create()/list()/delete().
    apiKeyClient(),
    // Sign-in and sign-up by emailed link: signIn.magicLink().
    magicLinkClient(),
  ],
});

export const {
  signIn,
  signOut,
  useSession,
  getSession,
  passkey,
  apiKey,
  updateUser,
  // Connected sign-in providers, managed on the account's Accounts page.
  listAccounts,
  linkSocial,
  unlinkAccount,
} = authClient;

export type SessionUser = typeof authClient.$Infer.Session.user;

// Calls one of the endpoints the API's better-auth instance plugin serves under
// /api/auth/instance/* (sign-in options, version, upload limits, team owner change):
// instance data Linear's GraphQL schema has no place for. A failure throws ApiError
// with the endpoint's message, as GraphQL errors do, so callers and toasts treat
// both alike.
export async function instanceFetch<T>(
  path: string,
  init?: { method?: 'GET' | 'POST'; body?: Record<string, unknown> },
): Promise<T> {
  const { data, error } = await authClient.$fetch<T>(path, {
    method: init?.method ?? 'GET',
    body: init?.body,
    // React Query owns caching; a browser-cached read could be stale after a write.
    cache: 'no-store',
  });
  if (error) throw new ApiError(error.status, error.message ?? error.statusText);
  return data as T;
}
