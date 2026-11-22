import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { db, user, verification } from '@repo/db';
import { eq, like } from 'drizzle-orm';
import { app } from '../../app';
import { authedApi } from '../helpers/app';
import { signUpTestUser } from '../helpers/auth';
import { resetDb } from '../helpers/db';

// Passwordless sign-in: an email account is created only when its magic link is used,
// and only for an address that may join (a pending invite, an approved domain, or the
// first user). Password sign-in is gone. With no email provider the link is logged.

const auth = (path: string, body: unknown) =>
  app.handle(
    new Request(`http://localhost/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: process.env.APP_URL!.split(',')[0]! },
      body: JSON.stringify(body),
    }),
  );

// The token of the newest magic link stored for an address.
async function linkToken(email: string): Promise<string | null> {
  const rows = await db
    .select({ identifier: verification.identifier, createdAt: verification.createdAt })
    .from(verification)
    .where(like(verification.value, `%"email":"${email}"%`));
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return rows[0]?.identifier ?? null;
}

async function useLink(email: string): Promise<Response> {
  const token = await linkToken(email);
  if (!token) throw new Error(`no magic link stored for ${email}`);
  return app.handle(
    new Request(`http://localhost/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`),
  );
}

const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');

describe('passwordless sign-in', () => {
  const savedDomains = process.env.APPROVED_EMAIL_DOMAINS;
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    process.env.APPROVED_EMAIL_DOMAINS = savedDomains;
  });

  it('creates an invited account from its magic link', async () => {
    const owner = await signUpTestUser();
    const asOwner = authedApi(owner.cookie);
    await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
    const ops = (await asOwner.teams({ teamKey: 'OPS' }).get()).data!.team.id;
    process.env.APPROVED_EMAIL_DOMAINS = '';
    const invited = await asOwner.invites.post({
      email: 'g@x.test',
      role: 'guest',
      teamIds: [ops],
    });
    expect(invited.status).toBe(201);
    expect((await auth('/sign-in/magic-link', { email: 'g@x.test' })).status).toBe(200);
    const res = await useLink('g@x.test');
    const cookie = cookieOf(res);
    expect(cookie).not.toBe('');
    const [row] = await db
      .select({ role: user.workspaceRole })
      .from(user)
      .where(eq(user.email, 'g@x.test'));
    expect(row?.role).toBe('guest');
    const teams = (await authedApi(cookie).teams.get()).data!;
    expect(teams.map((t) => t.key)).toEqual(['OPS']);
    expect((await asOwner.invites.get()).data).toHaveLength(0);
  });

  it('joins an approved domain as a member', async () => {
    await signUpTestUser();
    process.env.APPROVED_EMAIL_DOMAINS = ' Corp.test , other.test';
    expect((await auth('/sign-in/magic-link', { email: 'a@corp.test' })).status).toBe(200);
    await useLink('a@corp.test');
    const [row] = await db
      .select({ role: user.workspaceRole })
      .from(user)
      .where(eq(user.email, 'a@corp.test'));
    expect(row?.role).toBe('member');
  });

  it('sends nothing for an address that may not join', async () => {
    await signUpTestUser();
    process.env.APPROVED_EMAIL_DOMAINS = 'corp.test';
    const log = spyOn(console, 'info');
    const allowed = await auth('/sign-in/magic-link', { email: 'b@corp.test' });
    const refused = await auth('/sign-in/magic-link', { email: 'z@nowhere.test' });
    expect(refused.status).toBe(allowed.status);
    expect(await refused.json()).toEqual(await allowed.json());
    expect(log.mock.calls.some((c) => String(c.join(' ')).includes('z@nowhere.test'))).toBe(false);
    log.mockRestore();
    expect(await linkToken('z@nowhere.test')).toBeNull();
    expect(await db.$count(user, eq(user.email, 'z@nowhere.test'))).toBe(0);
  });

  it('refuses password sign-in', async () => {
    await signUpTestUser({ email: 'p@example.com' });
    const signIn = await auth('/sign-in/email', {
      email: 'p@example.com',
      password: 'x'.repeat(12),
    });
    expect(signIn.status).not.toBe(200);
    expect(signIn.headers.getSetCookie()).toHaveLength(0);
    const signUp = await auth('/sign-up/email', {
      email: 'q@example.com',
      password: 'x'.repeat(12),
      name: 'Q',
    });
    expect(signUp.status).not.toBe(200);
    expect(await db.$count(user, eq(user.email, 'q@example.com'))).toBe(0);
  });

  it('logs the link when no email provider is configured', async () => {
    const log = spyOn(console, 'info');
    expect((await auth('/sign-in/magic-link', { email: 'first@x.test' })).status).toBe(200);
    const line = log.mock.calls.map((c) => c.join(' ')).find((l) => l.includes('first@x.test'));
    log.mockRestore();
    expect(line).toContain('[auth] magic link for first@x.test');
    expect(line).toContain('/magic-link/verify?token=');
  });
});
