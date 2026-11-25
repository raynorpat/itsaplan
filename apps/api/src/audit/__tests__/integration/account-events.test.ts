import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { auth } from '@repo/auth';
import { auditEntry, db, passkey, session, workspaceInvite } from '@repo/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { app } from '../../../app';
import { requestMagicLink, signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gqlData } from '../../../__tests__/helpers/graphql';
import { ORIGIN } from '../../../__tests__/helpers/oauth';
import { currentAuditRequest, withAuditRequest } from '../../context';
import { recordLoginFailed } from '../../store';

// Sign-in and account events (better-auth hooks and the extra email store): each
// sign-in, refused sign-in, sign-out, session revoke, passkey and API key change, and
// extra address change leaves an audit entry, with no secret in it.

type Row = typeof auditEntry.$inferSelect;

async function rows(type: string): Promise<Row[]> {
  return db
    .select()
    .from(auditEntry)
    .where(eq(auditEntry.type, type))
    .orderBy(asc(auditEntry.createdAt));
}

// The confirmation links the email store logs, by address.
const links = new Map<string, string>();
const LINK_PREFIX = '[auth] email confirmation link for ';
const previousInfo = console.info;
console.info = (...args: unknown[]) => {
  const line = args.map(String).join(' ');
  if (line.startsWith(LINK_PREFIX)) {
    const [email, url] = line.slice(LINK_PREFIX.length).split(': ');
    if (email && url) links.set(email, url);
    return;
  }
  previousInfo(...args);
};

function instanceCall(path: string, cookie: string | null, body?: unknown) {
  const headers = new Headers({ origin: ORIGIN });
  if (cookie) headers.set('cookie', cookie);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return app.handle(
    new Request(`http://localhost/api/auth/instance/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

// A magic-link sign-in through the HTTP route, so the request's details are read.
async function signInByLink(email: string, ip: string): Promise<Response> {
  const token = await requestMagicLink(email);
  if (!token) throw new Error(`no link for ${email}`);
  return app.handle(
    new Request(`http://localhost/api/auth/magic-link/verify?token=${token}`, {
      headers: { 'x-forwarded-for': ip, 'user-agent': 'audit-test' },
      redirect: 'manual',
    }),
  );
}

function requestLink(
  email: string,
  ip: string,
  extra: Record<string, string> = {},
): Promise<Response> {
  return app.handle(
    new Request('http://localhost/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        'x-forwarded-for': ip,
        ...extra,
      },
      body: JSON.stringify({ email }),
    }),
  );
}

const details = (ip: string | null) => ({
  ip,
  countryCode: null,
  userAgent: null,
  method: 'session' as const,
});

describe('audit: sign-in and account events', () => {
  let owner: TestUser;
  const previousProxy = process.env.TRUST_PROXY;

  beforeEach(async () => {
    await resetDb();
    links.clear();
    owner = await signUpTestUser({ name: 'Owner' });
    process.env.TRUST_PROXY = 'true';
  });

  afterEach(() => {
    process.env.TRUST_PROXY = previousProxy;
  });

  it('records a magic-link sign-in with its method, person and IP', async () => {
    const res = await signInByLink(owner.email, '203.0.113.7');
    expect(res.status).toBeLessThan(400);
    const logins = (await rows('login')).filter((r) => r.ip === '203.0.113.7');
    expect(logins).toHaveLength(1);
    expect(logins[0]!.actorId).toBe(owner.userId);
    expect(logins[0]!.metadata).toMatchObject({ method: 'magicLink', entityId: owner.userId });
    expect(logins[0]!.requestInformation).toMatchObject({ userAgent: 'audit-test' });
  });

  it('records a refused link request for an address that may not join', async () => {
    const res = await requestLink('stranger@not-approved.test', '198.51.100.1');
    expect(res.status).toBe(200);
    const [entry] = await rows('loginFailed');
    expect(entry!.actorId).toBeNull();
    expect(entry!.metadata).toMatchObject({
      address: 'stranger@not-approved.test',
      reason: 'notInvited',
      attempts: 1,
    });
  });

  it('records a sign-in refused because the account is suspended', async () => {
    const member = await signUpTestUser({ name: 'Member' });
    await gqlData(owner, `mutation($id: String!) { userSuspend(id: $id) { success } }`, {
      id: member.userId,
    });
    const res = await signInByLink(member.email, '198.51.100.2');
    expect(res.status).toBeGreaterThanOrEqual(300);
    const refused = (await rows('loginFailed')).filter(
      (r) => (r.metadata as Record<string, unknown>).address === member.email,
    );
    expect(refused).toHaveLength(1);
    expect(refused[0]!.metadata).toMatchObject({ reason: 'accountSuspended' });
  });

  it('folds repeated refused attempts from one address and IP into one entry', async () => {
    for (let i = 0; i < 25; i += 1) await requestLink('flood@not-approved.test', '198.51.100.9');
    await requestLink('flood@not-approved.test', '198.51.100.10');
    const refused = await rows('loginFailed');
    expect(refused).toHaveLength(2);
    const byIp = new Map(refused.map((r) => [r.ip, r.metadata as Record<string, unknown>]));
    expect(byIp.get('198.51.100.9')!.attempts).toBe(25);
    expect(byIp.get('198.51.100.10')!.attempts).toBe(1);
  });

  it('lets a sign-in go ahead when its entry cannot be written, and says so in the next', async () => {
    await db.execute(sql`ALTER TABLE audit_entry RENAME TO audit_entry_away`);
    let res: Response;
    try {
      res = await signInByLink(owner.email, '203.0.113.20');
    } finally {
      await db.execute(sql`ALTER TABLE audit_entry_away RENAME TO audit_entry`);
    }
    expect(res.status).toBeLessThan(400);
    expect(res.headers.getSetCookie().some((c) => c.includes('session_token'))).toBe(true);
    await signInByLink(owner.email, '203.0.113.21');
    const [next] = (await rows('login')).filter((r) => r.ip === '203.0.113.21');
    expect(next!.metadata).toMatchObject({ missedEntries: 1 });
  });

  it('records sign-out and session revokes', async () => {
    const second = await signUpTestUser({ email: owner.email });
    await auth.api.revokeOtherSessions({ headers: new Headers({ cookie: second.cookie }) });
    const [revoked] = await rows('sessionRevoked');
    expect(revoked!.actorId).toBe(owner.userId);
    expect(revoked!.metadata).toMatchObject({ scope: 'others' });

    await auth.api.signOut({ headers: new Headers({ cookie: second.cookie }) });
    const [out] = await rows('logout');
    expect(out!.actorId).toBe(owner.userId);
  });

  it('records API key creation and deletion with the key id and name, never the key', async () => {
    const created = (await auth.api.createApiKey({
      body: { name: 'CI key' },
      headers: new Headers({ cookie: owner.cookie }),
    })) as { id: string; key: string };
    const [entry] = await rows('apiKeyCreated');
    expect(entry!.actorId).toBe(owner.userId);
    expect(entry!.metadata).toMatchObject({
      entityType: 'apiKey',
      entityId: created.id,
      name: 'CI key',
    });
    expect(JSON.stringify(entry)).not.toContain(created.key);

    await auth.api.deleteApiKey({
      body: { keyId: created.id },
      headers: new Headers({ cookie: owner.cookie }),
    });
    const [deleted] = await rows('apiKeyDeleted');
    expect(deleted!.metadata).toMatchObject({ entityId: created.id });
  });

  it('records removing a passkey', async () => {
    const [key] = await db
      .insert(passkey)
      .values({
        name: 'Laptop',
        publicKey: 'pk',
        userId: owner.userId,
        credentialID: 'cred-1',
        counter: 0,
        deviceType: 'singleDevice',
        backedUp: false,
      })
      .returning();
    await auth.api.deletePasskey({
      body: { id: key!.id },
      headers: new Headers({ cookie: owner.cookie }),
    });
    const [entry] = await rows('passkeyRemoved');
    expect(entry!.actorId).toBe(owner.userId);
    expect(entry!.metadata).toMatchObject({ entityType: 'passkey', entityId: key!.id });
  });

  it('records adding, confirming and removing an extra address', async () => {
    const added = await instanceCall('account/emails/add', owner.cookie, {
      email: 'second@example.org',
    });
    expect(added.status).toBe(200);
    const id = ((await added.json()) as { email: { id: string } }).email.id;
    const token = new URL(links.get('second@example.org')!).searchParams.get('token')!;
    const confirmed = await instanceCall('account/emails/confirm', null, { token });
    expect(confirmed.status).toBe(200);
    const removed = await instanceCall('account/emails/remove', owner.cookie, { id });
    expect(removed.status).toBe(200);

    for (const type of ['emailAdded', 'emailConfirmed', 'emailRemoved']) {
      const [entry] = await db
        .select()
        .from(auditEntry)
        .where(and(eq(auditEntry.type, type), eq(auditEntry.actorId, owner.userId)));
      expect(entry?.metadata).toMatchObject({ email: 'second@example.org' });
      expect(JSON.stringify(entry)).not.toContain(token);
    }
  });

  it('records a refused sign-up once, under its address', async () => {
    await gqlData(
      owner,
      'mutation { organizationInviteCreate(input: { email: "late@x.test", role: user }) { success } }',
    );
    const token = await requestMagicLink('late@x.test');
    await db.delete(workspaceInvite);
    await app.handle(
      new Request(`http://localhost/api/auth/magic-link/verify?token=${token}`, {
        headers: { 'x-forwarded-for': '198.51.100.30' },
        redirect: 'manual',
      }),
    );
    const refused = await rows('loginFailed');
    expect(refused).toHaveLength(1);
    expect(refused[0]!.metadata).toMatchObject({ address: 'late@x.test', reason: 'notInvited' });
  });

  it('marks the request once a refusal is recorded, so the after hook adds no second one', async () => {
    await withAuditRequest(details('198.51.100.31'), async () => {
      await recordLoginFailed('someone@not-approved.test', 'notInvited');
      expect(currentAuditRequest().refusalRecorded).toBe(true);
    });
  });

  it('folds addresses past 20 from one IP into one entry for the IP', async () => {
    for (let i = 0; i < 25; i += 1)
      await requestLink(`spray-${i}@not-approved.test`, '198.51.100.40');
    const refused = (await rows('loginFailed')).filter((r) => r.ip === '198.51.100.40');
    const byAddress = refused.filter((r) => (r.metadata as Record<string, unknown>).address);
    expect(byAddress).toHaveLength(20);
    const forIp = refused.filter((r) => (r.metadata as Record<string, unknown>).scope === 'ip');
    expect(forIp).toHaveLength(1);
    expect(forIp[0]!.metadata).toMatchObject({ addresses: 5, attempts: 5 });
  });

  it('keeps at most 320 characters of an attempted address', async () => {
    await withAuditRequest(details('198.51.100.41'), () =>
      recordLoginFailed(`${'a'.repeat(400)}@x.test`, 'notInvited'),
    );
    const [entry] = await rows('loginFailed');
    expect(((entry!.metadata as Record<string, string>).address ?? '').length).toBe(320);
  });

  it('keeps every reason a folded attempt gave, the latest as its reason', async () => {
    await withAuditRequest(details('198.51.100.42'), async () => {
      await recordLoginFailed('mixed@not-approved.test', 'notInvited');
      await recordLoginFailed('mixed@not-approved.test', 'badPasskey');
    });
    const [entry] = await rows('loginFailed');
    expect(entry!.metadata).toMatchObject({
      reason: 'badPasskey',
      reasons: ['notInvited', 'badPasskey'],
      attempts: 2,
    });
  });

  it('ignores a forwarded IP without TRUST_PROXY, in the log and in better-auth', async () => {
    process.env.TRUST_PROXY = 'false';
    const res = await signInByLink(owner.email, '203.0.113.50');
    expect(res.status).toBeLessThan(400);
    const [login] = (await rows('login')).slice(-1);
    expect(login!.ip).toBeNull();
    const ips = (await db.select({ ip: session.ipAddress }).from(session)).map((r) => r.ip);
    expect(ips).not.toContain('203.0.113.50');

    await requestLink('spoof@not-approved.test', '198.51.100.60');
    await requestLink('spoof@not-approved.test', '198.51.100.61');
    const refused = await rows('loginFailed');
    expect(refused).toHaveLength(1);
    expect(refused[0]!.ip).toBeNull();
    expect(refused[0]!.metadata).toMatchObject({ attempts: 2 });
  });

  it('records no IP that is not an address, and the country from the configured header', async () => {
    const previous = process.env.AUDIT_COUNTRY_HEADER;
    process.env.AUDIT_COUNTRY_HEADER = 'x-geo-country';
    try {
      await requestLink('geo@not-approved.test', 'not-an-ip', {
        'x-geo-country': 'de',
        'cf-ipcountry': 'FR',
      });
    } finally {
      if (previous === undefined) delete process.env.AUDIT_COUNTRY_HEADER;
      else process.env.AUDIT_COUNTRY_HEADER = previous;
    }
    const [entry] = await rows('loginFailed');
    expect(entry!.ip).toBeNull();
    expect(entry!.countryCode).toBe('DE');
  });
});
