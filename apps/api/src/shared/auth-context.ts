import { AsyncLocalStorage } from 'node:async_hooks';
import { Elysia } from 'elysia';
import { auth, getActiveSession } from '@repo/auth';
import { HttpError } from './lib';

// GET routes that need no session. The raw attachment and avatar bytes routes
// must work in <img>/<video> and external fetches. The invite lookup
// (`GET /invites/:token`) renders the accept screen for a logged-out invitee, who
// signs up from there; only accept/reject (POST) require a session. All ids are
// unguessable.
const PUBLIC_GET =
  /^\/attachments\/[^/]+\/raw$|^\/avatars\/[^/]+\/raw$|^\/uploads\/[^/]+\/raw$|^\/invites\/[^/]+$/;

type SessionResult = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

// The authenticated user carried on the request context.
export type SessionUser = SessionResult['user'];

// Session plugin shared by the planner. Resolves the better-auth session once and
// puts `user` on the context, so handlers and the access guards read it instead
// of calling getSession again. A missing session is a 401, except on the public
// raw-attachment route, which carries no user.
//
// planner.ts uses this as the runtime backstop, so every planner route is
// session-gated. A feature also uses it directly when its handlers or local
// macros reference `user`, which is what makes the `user` type flow there. The
// plugin is named, so its resolve runs once per request (dedup).
// The user an MCP tool call made with an OAuth token runs as (mcp/dispatch.ts). The
// tool runs a REST route in process; REST takes no OAuth token, so the MCP endpoint,
// which checked the token, passes the user through this store around that in-process
// request only. Nothing an outside request carries can set it.
const mcpCaller = new AsyncLocalStorage<SessionUser>();

export function runAsMcpCaller<T>(user: SessionUser, run: () => T): T {
  return mcpCaller.run(user, run);
}

export const authContext = new Elysia({ name: 'auth-context' }).resolve(
  { as: 'scoped' },
  async ({ request, path }): Promise<{ user: SessionUser | null }> => {
    const caller = mcpCaller.getStore();
    if (caller) return { user: caller };
    const session = await getActiveSession(request.headers);
    if (session) return { user: session.user };
    // The public raw-attachment route has no session and needs none.
    if (request.method === 'GET' && PUBLIC_GET.test(path)) return { user: null };
    // A signed upload URL carries its own credential, the single-use token.
    if (request.method === 'PUT' && /^\/uploads\/[^/]+$/.test(path)) return { user: null };
    throw new HttpError(401, 'Authentication required');
  },
);
