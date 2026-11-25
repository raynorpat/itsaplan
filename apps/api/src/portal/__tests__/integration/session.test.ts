import { beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { db, portalSignInToken } from '@repo/db';
import { eq } from 'drizzle-orm';
import { app } from '../../../app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createTeam, signUpAs } from '../../../__tests__/helpers/graphql';
import { ORIGIN } from '../../../__tests__/helpers/oauth';
import { portalLinks as links } from '../helpers';

// Portal sign-in: a visitor asks for a link on a board, confirms it on the confirm page
// and gets a portal session (cookie `portal_session`) tied to their requester. The
// session works only on /portal/*; access to restricted boards is checked per request.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Rate limits live in memory for the process, so each test uses its own addresses.
let n = 0;
const address = (domain = 'example.com') => `visitor-${++n}-${Date.now()}@${domain}`;

function portal(
  path: string,
  init: {
    body?: unknown;
    cookie?: string;
    origin?: string | null;
    method?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const headers = new Headers(init.headers);
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

// The link is mailed (here: logged) after the response; waits up to `ms` for it.
async function linkFor(email: string, ms = 1000): Promise<string | null> {
  for (const end = Date.now() + ms; Date.now() < end;) {
    const token = tokenFor(email);
    if (token) return token;
    await Bun.sleep(10);
  }
  return null;
}

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
  const token = await linkFor(email);
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
    expect(await linkFor(allowed)).toBeTruthy();
    expect(await linkFor(refused, 200)).toBeNull();
    // An address on the board's email list is allowed whatever its domain.
    await requestLink('friend@other.test', 'acme');
    expect(await linkFor('friend@other.test')).toBeTruthy();
  });

  it('stores only the hash of the token', async () => {
    await setup();
    const email = address();
    await requestLink(email, 'open');
    const token = (await linkFor(email))!;
    const rows = await db
      .select()
      .from(portalSignInToken)
      .where(eq(portalSignInToken.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
  });

  it('limits links per address without telling', async () => {
    await setup();
    const email = address();
    for (let i = 0; i < 5; i++) await requestLink(email, 'open');
    links.delete(email);
    expect(await requestLink(email, 'open')).toEqual({ ok: true });
    expect(await linkFor(email, 200)).toBeNull();
  });

  it('trusts the proxy address only when TRUST_PROXY is on', async () => {
    await setup();
    const ip = `203.0.113.${++n % 250}`;
    const fromProxy = () =>
      portal('auth/link', {
        body: { email: address(), board: 'open' },
        headers: { 'x-forwarded-for': ip },
      });
    for (let i = 0; i < 21; i++) expect((await fromProxy()).status).toBe(200);
    process.env.TRUST_PROXY = 'true';
    try {
      for (let i = 0; i < 20; i++) expect((await fromProxy()).status).toBe(200);
      expect((await fromProxy()).status).toBe(429);
    } finally {
      delete process.env.TRUST_PROXY;
    }
  });

  it('answers before the sign-in mail is sent', async () => {
    await setup();
    // An SMTP server that accepts the connection and never greets.
    const server = Bun.listen({
      hostname: '127.0.0.1',
      port: 0,
      socket: { data() {}, open() {} },
    });
    const saved = { ...process.env };
    Object.assign(process.env, {
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(server.port),
      EMAIL_FROM: 'portal@example.com',
    });
    try {
      const started = Date.now();
      expect(await requestLink(address(), 'open')).toEqual({ ok: true });
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      for (const key of ['SMTP_HOST', 'SMTP_PORT', 'EMAIL_FROM'])
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      server.stop(true);
    }
  });

  it('creates a requester with the given name on confirm', async () => {
    const { owner } = await setup();
    const email = address();
    await requestLink(email, 'open');
    const token = (await linkFor(email))!;
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
    const token = (await linkFor(email))!;
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
    const token = (await linkFor(email))!;
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
    const token = (await linkFor(email))!;
    await ok(await portal('auth/confirm', { body: { token, name: 'Once' } }));
    expect((await portal('auth/confirm', { body: { token, name: 'Twice' } })).status).toBe(400);
    expect((await portal(`auth/link-info?token=${token}`)).status).toBe(400);

    const other = address();
    await requestLink(other, 'open');
    const late = (await linkFor(other))!;
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
    const issues = (board: string, cookie?: string) => portal(`boards/${board}/issues`, { cookie });
    expect((await issues('acme', cookie)).status).toBe(200);
    expect((await issues('open')).status).toBe(200);
    expect((await issues('acme')).status).toBe(404);
    await ok(
      await instance('portal/boards/update', owner, { id: acme.id, allowedDomains: ['else.test'] }),
    );
    expect((await issues('acme', cookie)).status).toBe(404);
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
    expect(await linkFor(email, 200)).toBeNull();
    await ok(await instance('portal/block', owner, { requesterId: me.id, blocked: false }));
    await requestLink(email, 'open');
    expect(await linkFor(email)).toBeTruthy();
  });

  it('reads restricted boards with the address that signed in, and ends sessions on merge', async () => {
    const { owner } = await setup();
    const gmail = address('gmail.test');
    const a = await signIn(gmail, 'open', 'A');
    const b = await signIn(address('acme.test'), 'acme', 'B');
    const aId = (await ok(await portal('me', { cookie: a }))).id;
    const bId = (await ok(await portal('me', { cookie: b }))).id;
    await ok(await instance('requesters/merge', owner, { fromId: aId, intoId: bId }));
    expect((await portal('me', { cookie: a })).status).toBe(401);
    expect((await portal('me', { cookie: b })).status).toBe(401);
    const again = await signIn(gmail, 'open');
    expect((await ok(await portal('me', { cookie: again }))).id).toBe(bId);
    expect((await ok(await portal('boards/acme', { cookie: again }))).canRead).toBe(false);
    expect((await portal('boards/acme/issues', { cookie: again })).status).toBe(404);
  });

  it('ends the sessions of a person whose email the team changes', async () => {
    const { member } = await setup();
    const cookie = await signIn(address('acme.test'), 'acme');
    const me = await ok(await portal('me', { cookie }));
    await ok(
      await instance('requesters/update', member, { id: me.id, email: address('other.test') }),
    );
    expect((await portal('me', { cookie })).status).toBe(401);
  });

  it('refuses a link issued before the person was blocked', async () => {
    const { owner } = await setup();
    const email = address();
    const cookie = await signIn(email, 'open');
    const me = await ok(await portal('me', { cookie }));
    links.delete(email);
    await requestLink(email, 'open');
    const token = await linkFor(email);
    await ok(await instance('portal/block', owner, { requesterId: me.id, blocked: true }));
    expect((await portal('auth/confirm', { body: { token } })).status).toBe(400);
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
