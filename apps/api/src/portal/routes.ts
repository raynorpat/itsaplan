import { trustedOrigins } from '@repo/auth';
import { Elysia } from 'elysia';
import { HttpError } from '../shared/lib';
import { canReadBoard } from './access';
import { getBoardBySlug, type BoardRow } from './boards';
import { findBoardIssue, listBoardIssues, similarIssues } from './issues';
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
import { createSuggestion } from './suggestions';
import { castVote, removeVote } from './votes';

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

// The board the visitor may read, or 404 (missing, disabled or restricted to others).
async function readableBoard(slug: string, visitor: Visitor | null): Promise<BoardRow> {
  const board = await getBoardBySlug(slug);
  if (!board || !canReadBoard(board, visitor)) throw new HttpError(404, 'Board not found');
  return board;
}

async function readableIssue(slug: string, identifier: string, visitor: Visitor | null) {
  const board = await readableBoard(slug, visitor);
  const found = await findBoardIssue(board, visitor, identifier);
  if (!found) throw new HttpError(404, 'Issue not found');
  return { board, ...found };
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

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
  )
  .get('/boards/:slug', async ({ request, params }) => {
    const visitor = await visitorFromRequest(request);
    const board = await getBoardBySlug(params.slug);
    if (!board) throw new HttpError(404, 'Board not found');
    const me = visitor ? visitorDto(visitor) : null;
    // A restricted board the visitor cannot read shows only its sign-in form.
    if (!canReadBoard(board, visitor))
      return { name: board.name, access: board.access, canRead: false, visitor: me };
    return {
      name: board.name,
      intro: board.intro,
      access: board.access,
      comments: board.comments,
      suggestionsEnabled: board.suggestionsEnabled,
      showDescription: board.showDescription,
      canRead: true,
      visitor: me,
    };
  })
  .get('/boards/:slug/issues', async ({ request, params, query }) => {
    const visitor = await visitorFromRequest(request);
    const board = await readableBoard(params.slug, visitor);
    const sort = query.sort === 'new' ? 'new' : 'top';
    return { issues: await listBoardIssues(board, visitor, { q: text(query.q), sort }) };
  })
  .get('/boards/:slug/similar', async ({ request, params, query }) => {
    const visitor = await visitorFromRequest(request);
    const board = await readableBoard(params.slug, visitor);
    return { issues: await similarIssues(board, visitor, text(query.q)) };
  })
  .get('/boards/:slug/issues/:identifier', async ({ request, params }) => {
    const visitor = await visitorFromRequest(request);
    return (await readableIssue(params.slug, params.identifier, visitor)).detail;
  })
  .post('/boards/:slug/issues/:identifier/vote', async ({ request, params }) => {
    const visitor = await signedInVisitor(request);
    const { id } = await readableIssue(params.slug, params.identifier, visitor);
    return castVote(id, visitor);
  })
  .delete('/boards/:slug/issues/:identifier/vote', async ({ request, params }) => {
    const visitor = await signedInVisitor(request);
    const { id } = await readableIssue(params.slug, params.identifier, visitor);
    return removeVote(id, visitor);
  })
  .post('/boards/:slug/suggestions', async ({ request, params, body }) => {
    const visitor = await signedInVisitor(request);
    const board = await readableBoard(params.slug, visitor);
    return createSuggestion(board, visitor, fields(body));
  });
