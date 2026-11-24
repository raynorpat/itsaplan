import { beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { db, userEmail } from '@repo/db';
import { eq } from 'drizzle-orm';
import { app } from '../../../app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { ORIGIN } from '../../../__tests__/helpers/oauth';
import { memberEmails } from '../../emails';

// Extra email addresses (/api/auth/instance/account/emails*): added by their owner,
// confirmed through a link mailed to the address, used only to match people during
// an issue import (memberEmails).

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// With no mail provider configured the API logs each confirmation link; this records
// them by address and keeps every other line printed.
const links = new Map<string, string>();
const PREFIX = '[auth] email confirmation link for ';
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

function call(path: string, init: { cookie?: string; body?: unknown; origin?: boolean } = {}) {
  const headers = new Headers(init.origin === false ? {} : { origin: ORIGIN });
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  return app.handle(
    new Request(`http://localhost/api/auth/instance/${path}`, {
      method: init.body === undefined ? 'GET' : 'POST',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: 'manual',
    }),
  );
}

async function ok(res: Response): Promise<Json> {
  const text = await res.text();
  if (res.status !== 200) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text) as Json;
}

const list = async (as: TestUser) =>
  (await ok(await call('account/emails', { cookie: as.cookie }))).emails as Json[];

const add = (as: TestUser, email: string) =>
  call('account/emails/add', { cookie: as.cookie, body: { email } });

const tokenFor = (email: string) => new URL(links.get(email)!).searchParams.get('token')!;

// The confirmation page posts the token from its link; it needs no session.
const confirm = (token: string) =>
  call('account/emails/confirm', { body: { token }, origin: false });

describe('extra email addresses', () => {
  let owner: TestUser;
  let other: TestUser;

  beforeEach(async () => {
    await resetDb();
    links.clear();
    owner = await signUpTestUser({ name: 'Owner' });
    other = await signUpTestUser({ name: 'Other' });
  });

  it('adds an address as pending and mails a confirmation link', async () => {
    await ok(await add(owner, 'Pat@Old-Work.example'));
    expect(links.has('pat@old-work.example')).toBe(true);
    const emails = await list(owner);
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ email: 'pat@old-work.example', verified: false });
  });

  it('confirms with the token from the link and stores only its hash', async () => {
    await ok(await add(owner, 'pat@old-work.example'));
    const token = tokenFor('pat@old-work.example');
    const [row] = await db.select().from(userEmail).where(eq(userEmail.userId, owner.userId));
    expect(row!.tokenHash).not.toBe(token);
    expect(row!.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));

    const res = await ok(await confirm(token));
    expect(res).toEqual({ email: 'pat@old-work.example' });
    expect((await list(owner))[0]).toMatchObject({ verified: true });
  });

  it('refuses a wrong or expired token', async () => {
    await ok(await add(owner, 'pat@old-work.example'));
    const wrong = await confirm('not-a-token');
    expect(wrong.status).toBe(400);
    expect((await list(owner))[0]).toMatchObject({ verified: false });

    const token = tokenFor('pat@old-work.example');
    await db
      .update(userEmail)
      .set({ tokenExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(userEmail.userId, owner.userId));
    const expired = await confirm(token);
    expect(expired.status).toBe(400);
    expect((await list(owner))[0]).toMatchObject({ verified: false });
  });

  it("refuses another user's sign-in or confirmed extra address", async () => {
    expect((await add(owner, other.email)).status).toBe(400);
    await ok(await add(other, 'shared@old-work.example'));
    expect((await confirm(tokenFor('shared@old-work.example'))).status).toBe(200);
    expect((await add(owner, 'shared@old-work.example')).status).toBe(400);
    expect((await add(owner, owner.email)).status).toBe(400);
  });

  it('mails a link to the confirmation page, which a GET does not confirm', async () => {
    await ok(await add(owner, 'pat@old-work.example'));
    const link = new URL(links.get('pat@old-work.example')!);
    expect(link.pathname).toBe('/confirm-email');
    const token = link.searchParams.get('token')!;
    // A mail scanner following links only reads: the address stays pending.
    await call(`account/emails/confirm?token=${encodeURIComponent(token)}`, { origin: false });
    const info = await ok(
      await call(`account/emails/confirm-info?token=${encodeURIComponent(token)}`, {
        origin: false,
      }),
    );
    expect(info).toEqual({ email: 'pat@old-work.example' });
    expect((await list(owner))[0]).toMatchObject({ verified: false });
    expect(
      (await call('account/emails/confirm-info?token=not-a-token', { origin: false })).status,
    ).toBe(400);
  });

  it('sends a new link for a pending address at most once a minute', async () => {
    await ok(await add(owner, 'pat@old-work.example'));
    expect((await add(owner, 'pat@old-work.example')).status).toBe(429);
    await db
      .update(userEmail)
      .set({ tokenExpiresAt: new Date(Date.now() + 24 * 3_600_000 - 61_000) })
      .where(eq(userEmail.userId, owner.userId));
    await ok(await add(owner, 'pat@old-work.example'));
  });

  it('allows at most 10 extra addresses', async () => {
    for (let i = 0; i < 10; i++) await ok(await add(owner, `a${i}@old-work.example`));
    expect((await add(owner, 'a10@old-work.example')).status).toBe(400);
  });

  it('removes an address; another user can neither list nor remove it', async () => {
    await ok(await add(owner, 'pat@old-work.example'));
    const [entry] = await list(owner);
    expect(await list(other)).toHaveLength(0);
    expect(
      (await call('account/emails/remove', { cookie: other.cookie, body: { id: entry!.id } }))
        .status,
    ).toBe(404);
    await ok(
      await call('account/emails/remove', { cookie: owner.cookie, body: { id: entry!.id } }),
    );
    expect(await list(owner)).toHaveLength(0);
  });

  it('memberEmails gives the sign-in address and confirmed extras only', async () => {
    await ok(await add(owner, 'Confirmed@Old-Work.example'));
    await ok(await add(owner, 'pending@old-work.example'));
    await confirm(tokenFor('confirmed@old-work.example'));
    const map = await memberEmails([owner.userId, other.userId]);
    expect(map.get(owner.userId)?.sort()).toEqual(
      [owner.email.toLowerCase(), 'confirmed@old-work.example'].sort(),
    );
    expect(map.get(other.userId)).toEqual([other.email.toLowerCase()]);
  });

  it('needs a session', async () => {
    expect((await call('account/emails')).status).toBe(401);
  });
});
