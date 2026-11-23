import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { signInOptions } from './instance';

// Instance information that Linear's GraphQL schema has no place for, served by
// better-auth under /api/auth/instance/*:
//
// - GET  /instance/sign-in-options  public: { emailEnabled, google, passkey }
// - GET  /instance/version          signed in: { version }
// - GET  /instance/upload-limits    signed in: the upload limits
// - POST /instance/team-owner       team managers: { teamId, userId, owner } makes a
//   team member a team owner or a plain member, answering the same body. With a
//   session cookie the request's Origin must be one of the app's origins.
//
// Linear's schema exposes TeamMembership.owner but no input that sets it, and the
// vendored schema is never edited, so the owner change lives here too.
//
// The version, the upload limits and the owner change need the API's own session and
// access rules (apps/api), which this package cannot import (the dependency graph is
// api → auth → db). The API registers them at startup with provideInstanceHandlers.
// A handler signals a refusal by throwing an error with an HTTP `status`.

export interface TeamOwnerChange {
  teamId: string;
  userId: string;
  owner: boolean;
}

export interface InstanceHandlers {
  version(headers: Headers): Promise<{ version: string }>;
  uploadLimits(headers: Headers): Promise<object>;
  setTeamOwner(headers: Headers, body: unknown): Promise<TeamOwnerChange>;
}

let handlers: InstanceHandlers | null = null;

export function provideInstanceHandlers(provided: InstanceHandlers): void {
  handlers = provided;
}

// Runs a registered handler, turning an error with an HTTP `status` into better-auth's
// error of that status and message. Anything else is an unexpected failure (500).
async function run<T>(call: (h: InstanceHandlers) => Promise<T>): Promise<T> {
  if (!handlers) throw new Error('Instance handlers are not registered');
  try {
    return await call(handlers);
  } catch (err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number' && status >= 400 && status < 600)
      throw new APIError(status as ConstructorParameters<typeof APIError>[0], {
        message: (err as Error).message,
      });
    throw err;
  }
}

// A write authenticated by the session cookie must come from a trusted origin, so
// another site cannot make a signed-in browser change a team owner (CSRF). better-auth
// does not check the request origin on plugin endpoints. A request without a cookie
// (an API key) carries no ambient credential and is not checked.
function assertTrustedOrigin(headers: Headers | undefined, trusted: string[]): void {
  if (!headers?.get('cookie')) return;
  const origin = headers.get('origin');
  if (!origin || !trusted.includes(origin))
    throw new APIError('FORBIDDEN', { message: 'This request must come from the app' });
}

export const instancePlugin = (options: { trustedOrigins: string[] }) =>
  ({
    id: 'instance',
    endpoints: {
      instanceSignInOptions: createAuthEndpoint(
        '/instance/sign-in-options',
        { method: 'GET' },
        async (ctx) => ctx.json(await signInOptions()),
      ),
      instanceVersion: createAuthEndpoint('/instance/version', { method: 'GET' }, async (ctx) =>
        ctx.json(await run((h) => h.version(ctx.headers ?? new Headers()))),
      ),
      instanceUploadLimits: createAuthEndpoint(
        '/instance/upload-limits',
        { method: 'GET' },
        async (ctx) => ctx.json(await run((h) => h.uploadLimits(ctx.headers ?? new Headers()))),
      ),
      instanceTeamOwner: createAuthEndpoint(
        '/instance/team-owner',
        { method: 'POST' },
        async (ctx) => {
          assertTrustedOrigin(ctx.headers, options.trustedOrigins);
          return ctx.json(await run((h) => h.setTeamOwner(ctx.headers ?? new Headers(), ctx.body)));
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
