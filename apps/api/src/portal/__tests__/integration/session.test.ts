import { beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { db, portalSignInToken } from '@repo/db';
import { eq } from 'drizzle-orm';
import { app } from '../../../app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createTeam, signUpAs } from '../../../__tests__/helpers/graphql';
import { ORIGIN } from '../../../__tests__/helpers/oauth';
import { getBoardBySlug } from '../../boards';
import { canReadBoard } from '../../access';
import { visitorFromRequest } from '../../session';

// Portal sign-in: a visitor asks for a link on a board, confirms it on the confirm page
// and gets a portal session (cookie `portal_session`) tied to their requester. The
// session works only on /portal/*; access to restricted boards is checked per request.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// With no mail provider the API logs each portal sign-in link; this records them by
// address and keeps every other line printed.
const links = new Map<string, string>();
const PREFIX = '[portal] sign-in link for ';
const previousInfo = console.info;
console.info = (...args: unknown[]) => {
  const line = args.map(String).join(' ');
  if (line.startsWith(PREFIX)) {
    const [email, url] = line.slice(PREFIX.length).split(': ');
    if (email && url) links.set(email, url);
    return;
  }
  previousInfo(...args);
};

// Rate limits live in memory for the process, so each test uses its own addresses.
let n = 0;
const address = (domain = 'example.com') => `visitor-${++n}-${Date.now()}@${domain}`;

function portal(
  path: string,
  init: { body?: unknown; cookie?: string; origin?: string | null; method?: string } = {},
) {
  const headers = new Headers();
  if (init.origin !== null) headers.set('origin', init.origin ?? ORIGIN);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  return app.handle(
    new Request(`http://localhost/portal/${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

function instance(path: string, as: TestUser, body?: unknown, query?: Json) {
  const headers = new Headers({ origin: ORIGIN, cookie: as.cookie });
  if (body !== undefined) headers.set('content-type', 'application/json');
  const qs = query ? `?${new URLSearchParams(query)}` : '';
  return app.handle(
    new Request(`http://localhost/api/auth/instance/${path}${qs}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

async function ok(res: Response): Promise<Json> {
  const text = await res.text();
  if (res.status !== 200) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text) as Json;
}

const tokenFor = (email: string) => {
  const url = links.get(email);
  return url ? new URL(url).searchParams.get('token') : null;
};

const sessionCookie = (res: Response) => {
  const set = res.headers.getSetCookie().find((c) => c.startsWith('portal_session='));
  return set ? set.split(';')[0]! : null;
};

async function requestLink(email: string, board: string) {
  return ok(await portal('auth/link', { body: { email, board } }));
}

// Requests a link and confirms it; returns the session cookie.
async function signIn(email: string, board: string, name = 'Visitor'): Promise<string> {
  await requestLink(email, board);
  const token = tokenFor(email);
  if (!token) throw new Error(`no link for ${email}`);
  const res = await portal('auth/confirm', { body: { token, name } });
  if (res.status !== 200) throw new Error(`${res.status}: ${await res.text()}`);
  return sessionCookie(res)!;
}

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const member = await signUpAs('member', { name: 'Member' });
  const eng = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  const createBoard = async (body: Json) =>
    (await ok(await instance('portal/boards/create', owner, { teamId: eng.team.id, ...body })))
      .board as Json;
  const open = await createBoard({ slug: 'open', name: 'Open' });
  const acme = await createBoard({
    slug: 'acme',
    name: 'Acme',
    access: 'restricted',
    allowedDomains: ['acme.test'],
    allowedEmails: ['friend@other.test'],
  });
  return { owner, member, eng, open, acme };
}

describe('portal sign-in', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('answers the same for allowed, disallowed and unknown boards, mailing only allowed', async () => {
    await setup();
    const allowed = address('acme.test');
    const refused = address('other.test');
    expect(await requestLink(allowed, 'acme')).toEqual({ ok: true });
    expect(await requestLink(refused, 'acme')).toEqual({ ok: true });
    expect(await requestLink(address(), 'missing')).toEqual({ ok: true });
    expect(tokenFor(allowed)).toBeTruthy();
    expect(tokenFor(refused)).toBeNull();
    // An address on the board's email list is allowed whatever its domain.
    await requestLink('friend@other.test', 'acme');
    expect(tokenFor('friend@other.test')).toBeTruthy();
  });

  it('stores only the hash of the token', async () => {
    await setup();
    const email = address();
    await requestLink(email, 'open');
    const token = tokenFor(email)!;
    const rows = await db
      .select()
      .from(portalSignInToken)
      .where(eq(portalSignInToken.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
  });

  it('limits links per address', async () => {
    await setup();
    const email = address();
    for (let i = 0; i < 5; i++) await requestLink(email, 'open');
    const res = await portal('auth/link', { body: { email, board: 'open' } });
    expect(res.status).toBe(429);
  });

  it('creates a requester with the given name on confirm', async () => {
    const { owner } = await setup();
    const email = address();
    await requestLink(email, 'open');
    const token = tokenFor(email)!;
    expect(await ok(await portal(`auth/link-info?token=${token}`))).toEqual({ needsName: true });
    const res = await portal('auth/confirm', { body: { token, name: 'Jane Doe' } });
    expect(res.status).toBe(200);
    const cookie = sessionCookie(res)!;
    expect(res.headers.getSetCookie()[0]).toContain('HttpOnly');
    expect(res.headers.getSetCookie()[0]).toContain('Path=/portal');
    const me = await ok(await portal('me', { cookie }));
    expect(me.displayName).toBe('Jane Doe');
    const people = await ok(await instance('requesters', owner, undefined, { q: email }));
    expect(people.requesters).toHaveLength(1);
    expect(people.requesters[0].name).toBe('Jane Doe');
  });

  it('reuses the requester an email already has, whatever its case', async () => {
    const { owner } = await setup();
    const email = address();
    const known = await ok(
      await instance('requesters/create', owner, { name: 'Known Person', email }),
    );
    await requestLink(email.toUpperCase(), 'open');
    const token = tokenFor(email)!;
    expect(await ok(await portal(`auth/link-info?token=${token}`))).toEqual({ needsName: false });
    const res = await portal('auth/confirm', { body: { token } });
    expect(res.status).toBe(200);
    const me = await ok(await portal('me', { cookie: sessionCookie(res)! }));
    expect(me.id).toBe(known.requester.id);
  });

  it('asks for a name before using the token of a new address', async () => {
    const { owner } = await setup();
    const email = address();
    await requestLink(email, 'open');
    const token = tokenFor(email)!;
    const first = await portal('auth/confirm', { body: { token } });
    expect(first.status).toBe(400);
    expect(await first.text()).toContain('name required');
    expect(
      await ok(await portal('auth/confirm', { body: { token, name: 'Late Name' } })),
    ).toBeTruthy();
    const people = await ok(await instance('requesters', owner, undefined, { q: email }));
    expect(people.requesters).toHaveLength(1);
  });

  it('refuses a used or expired token', async () => {
    await setup();
    const email = address();
    await requestLink(email, 'open');
    const token = tokenFor(email)!;
    await ok(await portal('auth/confirm', { body: { token, name: 'Once' } }));
    expect((await portal('auth/confirm', { body: { token, name: 'Twice' } })).status).toBe(400);
    expect((await portal(`auth/link-info?token=${token}`)).status).toBe(400);

    const other = address();
    await requestLink(other, 'open');
    const late = tokenFor(other)!;
    await db
      .update(portalSignInToken)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(portalSignInToken.email, other));
    expect((await portal('auth/confirm', { body: { token: late, name: 'Late' } })).status).toBe(
      400,
    );
  });

  it('accepts only the portal session on /portal and never on /graphql', async () => {
    const { member } = await setup();
    const cookie = await signIn(address(), 'open');
    expect((await portal('me', { cookie })).status).toBe(200);
    // A member's better-auth session is not a portal session.
    expect((await portal('me', { cookie: member.cookie })).status).toBe(401);
    const res = await app.handle(
      new Request('http://localhost/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, origin: ORIGIN },
        body: JSON.stringify({ query: '{ viewer { id } }' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('changes only the display name', async () => {
    const { owner } = await setup();
    const email = address();
    const cookie = await signIn(email, 'open', 'Real Name');
    const me = await ok(await portal('me', { cookie, body: { displayName: 'Nick' } }));
    expect(me.displayName).toBe('Nick');
    const people = await ok(await instance('requesters', owner, undefined, { q: email }));
    expect(people.requesters[0].name).toBe('Real Name');
    expect(people.requesters[0].displayName).toBe('Nick');
  });

  it('signs out', async () => {
    await setup();
    const cookie = await signIn(address(), 'open');
    await ok(await portal('auth/sign-out', { cookie, body: {} }));
    expect((await portal('me', { cookie })).status).toBe(401);
  });

  it('checks a restricted board on every request', async () => {
    const { owner, acme } = await setup();
    const cookie = await signIn(address('acme.test'), 'acme');
    const request = () => new Request('http://localhost/portal/me', { headers: { cookie } });
    const board = (await getBoardBySlug('acme'))!;
    expect(canReadBoard(board, await visitorFromRequest(request()))).toBe(true);
    expect(canReadBoard((await getBoardBySlug('open'))!, null)).toBe(true);
    expect(canReadBoard(board, null)).toBe(false);
    await ok(
      await instance('portal/boards/update', owner, { id: acme.id, allowedDomains: ['else.test'] }),
    );
    const changed = (await getBoardBySlug('acme'))!;
    expect(canReadBoard(changed, await visitorFromRequest(request()))).toBe(false);
  });

  it('blocks a requester: sessions end, links stop, owners and admins only', async () => {
    const { owner, member } = await setup();
    const email = address();
    const cookie = await signIn(email, 'open');
    const me = await ok(await portal('me', { cookie }));
    const refused = await instance('portal/block', member, { requesterId: me.id, blocked: true });
    expect(refused.status).toBe(403);
    await ok(await instance('portal/block', owner, { requesterId: me.id, blocked: true }));
    expect((await portal('me', { cookie })).status).toBe(401);
    const person = await ok(await instance('requester', owner, undefined, { id: me.id }));
    expect(person.requester.portalBlocked).toBe(true);
    links.delete(email);
    expect(await requestLink(email, 'open')).toEqual({ ok: true });
    expect(tokenFor(email)).toBeNull();
    await ok(await instance('portal/block', owner, { requesterId: me.id, blocked: false }));
    await requestLink(email, 'open');
    expect(tokenFor(email)).toBeTruthy();
  });

  it('refuses a cookie POST without a trusted Origin', async () => {
    await setup();
    const cookie = await signIn(address(), 'open');
    const res = await portal('me', {
      cookie,
      body: { displayName: 'X' },
      origin: 'https://evil.test',
    });
    expect(res.status).toBe(403);
    const none = await portal('auth/link', {
      body: { email: address(), board: 'open' },
      origin: null,
    });
    expect(none.status).toBe(403);
  });
});
