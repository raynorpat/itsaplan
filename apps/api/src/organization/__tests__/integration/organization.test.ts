import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { db, verification } from '@repo/db';
import { like } from 'drizzle-orm';
import { app } from '../../../app';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { signUpWithRole } from '../../../__tests__/helpers/roles';

// The workspace's Organization over REST (the web's workspace settings page): read by
// anyone signed in, changed by admins and owners; sign-in services limited by
// allowedAuthServices; upload limits from the environment.

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

const linkStored = async (email: string) =>
  (
    await db
      .select({ id: verification.id })
      .from(verification)
      .where(like(verification.value, `%"email":"${email}"%`))
  ).length > 0;

describe('organization settings', () => {
  const saved = { ...process.env };
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    process.env.MAX_ATTACHMENT_MB = saved.MAX_ATTACHMENT_MB;
    process.env.APPROVED_EMAIL_DOMAINS = saved.APPROVED_EMAIL_DOMAINS;
  });

  it('reads and updates the organization', async () => {
    await signUpTestUser();
    const admin = await signUpWithRole('admin');
    const member = await signUpWithRole('member');
    const patch = {
      name: 'Acme',
      urlKey: 'acme',
      logoUrl: 'https://example.com/logo.png',
      allowedFileUploadContentTypes: ['image/*'],
    };
    const updated = await call('/organization', {
      method: 'PATCH',
      cookie: admin.cookie,
      body: patch,
    });
    expect(updated.status).toBe(200);
    const read = (await (await call('/organization', { cookie: member.cookie })).json()) as Record<
      string,
      unknown
    >;
    expect(read).toMatchObject(patch);
    expect(read.approvedDomains).toEqual(expect.any(Array));
    expect(typeof read.version).toBe('string');
    const refused = await call('/organization', {
      method: 'PATCH',
      cookie: member.cookie,
      body: { name: 'Nope' },
    });
    expect(refused.status).toBe(403);
  });

  it('limits sign-in services, keeping the owner a magic link', async () => {
    const owner = await signUpTestUser();
    const member = await signUpWithRole('member');
    await call('/organization', {
      method: 'PATCH',
      cookie: owner.cookie,
      body: { allowedAuthServices: ['google'] },
    });
    await db.delete(verification);
    const ask = (email: string) =>
      call('/api/auth/sign-in/magic-link', { method: 'POST', body: { email } });
    expect((await ask(member.email)).status).toBe(200);
    expect(await linkStored(member.email)).toBe(false);
    expect((await ask(owner.email)).status).toBe(200);
    expect(await linkStored(owner.email)).toBe(true);
    const passkey = await call('/api/auth/passkey/generate-authenticate-options');
    expect(passkey.status).toBe(403);
  });

  it('uses upload limits from the environment', async () => {
    process.env.MAX_ATTACHMENT_MB = '1';
    const owner = await signUpTestUser();
    const limits = (await (await call('/settings/storage', { cookie: owner.cookie })).json()) as {
      maxAttachmentMb: number;
    };
    expect(limits.maxAttachmentMb).toBe(1);
    // The size check runs before the object store, so this needs no running store.
    const api = authedApi(owner.cookie);
    await api.teams.post({ key: 'MKT', name: 'Marketing' });
    const stateId = (await api.teams({ teamKey: 'MKT' }).get()).data!.states[0]!.id;
    const issueId = (await api.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'T' })).data!
      .id;
    const big = new File([new Uint8Array(2 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    const res = await api.issues({ issueId }).attachments.post({ file: big });
    expect(res.status).toBe(413);
  });

  it('keeps the workspace settings from guests and limits field lengths', async () => {
    const owner = await signUpTestUser();
    const guest = await signUpWithRole('guest');
    expect((await call('/organization', { cookie: guest.cookie })).status).toBe(403);
    const long = await call('/organization', {
      method: 'PATCH',
      cookie: owner.cookie,
      body: { name: 'x'.repeat(256) },
    });
    expect(long.status).toBe(400);
    const longLogo = await call('/organization', {
      method: 'PATCH',
      cookie: owner.cookie,
      body: { logoUrl: `https://example.com/${'x'.repeat(2048)}` },
    });
    expect(longLogo.status).toBe(400);
  });
});
