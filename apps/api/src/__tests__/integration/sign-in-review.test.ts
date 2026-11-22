import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { auth, emailConfigWarnings } from '@repo/auth';
import { db, user } from '@repo/db';
import { eq } from 'drizzle-orm';
import { app } from '../../app';
import { signUpTestUser } from '../helpers/auth';
import { resetDb } from '../helpers/db';

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
    await call('/organization', {
      method: 'PATCH',
      cookie: owner.cookie,
      body: { allowedAuthServices: ['email'] },
    });
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
});
