import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { auth, emailConfigWarnings } from '@repo/auth';
import { db, user, verification, workspaceInvite } from '@repo/db';
import { eq, like } from 'drizzle-orm';
import { app } from '../../app';
import { requestMagicLink, signUpTestUser } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { gqlData } from '../helpers/graphql';

// Sign-in gaps found in review: the Google return leg and account linking follow the
// allowed sign-in services; a magic-link request does not wait for the mail provider;
// an account is created only from a verified address; a link that cannot be sent is
// logged; a half-configured mail provider is reported.

const call = (path: string, init: { method?: string; cookie?: string; body?: unknown } = {}) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        origin: process.env.APP_URL!.split(',')[0]!,
        ...(init.cookie ? { cookie: init.cookie } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );

const waitFor = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  return check();
};

describe('sign-in review fixes', () => {
  const saved = { ...process.env };
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });

  it('refuses the Google callback and account linking when Google is not allowed', async () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    const owner = await signUpTestUser();
    await gqlData(
      owner,
      'mutation { organizationUpdate(input: { authSettings: { allowedAuthServices: ["email"] } }) { success } }',
    );
    const callback = await call('/api/auth/callback/google?code=x&state=y');
    expect(callback.status).toBe(403);
    const link = await call('/api/auth/link-social', {
      method: 'POST',
      cookie: owner.cookie,
      body: { provider: 'google', callbackURL: '/' },
    });
    expect(link.status).toBe(403);
  });

  it('answers a magic-link request without waiting for the mail provider', async () => {
    await signUpTestUser({ email: 'known@example.com' });
    // An SMTP server that accepts the connection and never answers.
    const server = Bun.listen({
      hostname: '127.0.0.1',
      port: 0,
      socket: { data() {}, open() {} },
    });
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(server.port);
    process.env.EMAIL_FROM = 'it@example.com';
    try {
      const started = Date.now();
      const res = await call('/api/auth/sign-in/magic-link', {
        method: 'POST',
        body: { email: 'known@example.com' },
      });
      expect(res.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(1500);
    } finally {
      server.stop(true);
    }
  });

  it('creates an account only from a verified address', async () => {
    await signUpTestUser();
    const ctx = await auth.$context;
    await expect(
      ctx.internalAdapter.createUser({
        email: 'unverified@example.com',
        name: 'U',
        emailVerified: false,
      }),
    ).rejects.toThrow();
    expect(await db.$count(user, eq(user.email, 'unverified@example.com'))).toBe(0);
    await ctx.internalAdapter.createUser({
      email: 'verified@example.com',
      name: 'V',
      emailVerified: true,
    });
    expect(await db.$count(user, eq(user.email, 'verified@example.com'))).toBe(1);
  });

  it('logs the link when the mail provider fails', async () => {
    await signUpTestUser({ email: 'known@example.com' });
    // Nothing listens on this port, so the send fails at once.
    const probe = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
    const port = probe.port;
    probe.stop(true);
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(port);
    process.env.EMAIL_FROM = 'it@example.com';
    const log = spyOn(console, 'info');
    const res = await call('/api/auth/sign-in/magic-link', {
      method: 'POST',
      body: { email: 'known@example.com' },
    });
    expect(res.status).toBe(200);
    const logged = await waitFor(() =>
      log.mock.calls.some((c) => c.join(' ').includes('[auth] magic link for known@example.com')),
    );
    log.mockRestore();
    expect(logged).toBe(true);
  });

  it('reports a half-configured mail provider and log-only production', () => {
    expect(emailConfigWarnings({ RESEND_API_KEY: 're_x' })).toEqual([
      expect.stringContaining('EMAIL_FROM'),
    ]);
    expect(emailConfigWarnings({ NODE_ENV: 'production' })).toEqual([
      expect.stringContaining('log'),
    ]);
    expect(
      emailConfigWarnings({ SMTP_HOST: 'smtp.example.com', EMAIL_FROM: 'a@example.com' }),
    ).toEqual([]);
  });

  it('redirects a refused magic link to the error page', async () => {
    const owner = await signUpTestUser();
    const web = process.env.APP_URL!.split(',')[0]!;
    await gqlData(
      owner,
      'mutation { organizationInviteCreate(input: { email: "late@x.test", role: user }) { success } }',
    );
    const token = await requestMagicLink('late@x.test');
    expect(token).not.toBeNull();
    // The invite is revoked after the link went out.
    await db.delete(workspaceInvite);
    const res = await app.handle(
      new Request(
        `http://localhost/api/auth/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent(`${web}/`)}&errorCallbackURL=${encodeURIComponent(`${web}/login`)}`,
      ),
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('error')).toBe('NOT_INVITED');
  });

  it('stores magic-link tokens hashed', async () => {
    await signUpTestUser();
    const token = await requestMagicLink('again@example.com');
    const [row] = await db
      .select({ identifier: verification.identifier })
      .from(verification)
      .where(like(verification.value, '%"email":"again@example.com"%'));
    expect(token).not.toBeNull();
    expect(row!.identifier).not.toBe(token);
  });

  it('validates the magic-link request body', async () => {
    const send = (email: unknown) =>
      call('/api/auth/sign-in/magic-link', { method: 'POST', body: { email } });
    expect((await send(5)).status).toBe(400);
    expect((await send('not-an-email')).status).toBe(400);
  });
});
