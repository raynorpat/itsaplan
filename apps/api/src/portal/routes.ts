import { trustedOrigins } from '@repo/auth';
import { Elysia } from 'elysia';
import { HttpError } from '../shared/lib';
import {
  confirmSignIn,
  requestSignInLink,
  sessionCookie,
  signInLinkInfo,
  signOut,
  updateDisplayName,
  visitorDto,
  visitorFromRequest,
  type Visitor,
} from './session';

// The portal's own routes (/portal/*), for people outside the workspace. They accept
// only the portal session cookie (session.ts): a better-auth session or API key means
// nothing here, and the portal cookie means nothing anywhere else. Every POST must come
// from the web app's origin (the cookie would otherwise let another site act for the
// visitor).

const fields = (body: unknown): Record<string, unknown> =>
  body && typeof body === 'object' ? (body as Record<string, unknown>) : {};

// The client address from the proxy headers, when the API runs behind one.
function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || null;
}

export async function signedInVisitor(request: Request): Promise<Visitor> {
  const visitor = await visitorFromRequest(request);
  if (!visitor) throw new HttpError(401, 'Sign in to continue');
  return visitor;
}

export const portalRoutes = new Elysia({ name: 'portal', prefix: '/portal' })
  .onBeforeHandle(({ request }) => {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS')
      return;
    const origin = request.headers.get('origin');
    if (!origin || !trustedOrigins.includes(origin))
      throw new HttpError(403, 'This request must come from the portal');
  })
  .post('/auth/link', async ({ request, body }) => {
    const input = fields(body);
    await requestSignInLink(input.email, input.board, clientIp(request));
    return { ok: true };
  })
  .get('/auth/link-info', ({ query }) => signInLinkInfo(query.token))
  .post('/auth/confirm', async ({ body, set }) => {
    const input = fields(body);
    const { sessionToken, visitor } = await confirmSignIn(input.token, input.name);
    set.headers['set-cookie'] = sessionCookie(sessionToken);
    return { visitor: visitorDto(visitor) };
  })
  .post('/auth/sign-out', async ({ request, set }) => {
    await signOut(request);
    set.headers['set-cookie'] = sessionCookie(null);
    return { ok: true };
  })
  .get('/me', async ({ request }) => visitorDto(await signedInVisitor(request)))
  .post('/me', async ({ request, body }) =>
    visitorDto(await updateDisplayName(await signedInVisitor(request), fields(body).displayName)),
  );
