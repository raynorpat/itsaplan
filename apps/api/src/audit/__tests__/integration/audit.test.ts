import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { auditEntry, db } from '@repo/db';
import { sql } from 'drizzle-orm';
import { app } from '../../../app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gqlData, signUpAs } from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { bearer, createClient, obtainTokens, ORIGIN } from '../../../__tests__/helpers/oauth';
import { cleanupAuditEntries } from '../../retention';
import { recordAudit, recordLoginFailed } from '../../store';
import { withAuditRequest } from '../../context';

// The audit log core: entries read through Linear's auditEntries / auditEntryTypes by
// owners and admins, the retention setting (/api/auth/instance/audit-settings*,
// owners change it) and its clean-up, the request details an entry carries, and the
// fail-open write outside a transaction.

const ENTRIES = `query($filter: AuditEntryFilter, $first: Int, $after: String) {
  auditEntries(filter: $filter, first: $first, after: $after) {
    nodes { id type actorId actor { id } ip countryCode metadata requestInformation createdAt }
    pageInfo { hasNextPage endCursor }
  }
}`;

type Entry = {
  id: string;
  type: string;
  actorId: string | null;
  ip: string | null;
  countryCode: string | null;
  metadata: Record<string, unknown> | null;
  requestInformation: Record<string, unknown> | null;
  createdAt: string;
};

async function entries(as: TestUser, filter?: unknown): Promise<Entry[]> {
  const data = await gqlData(as, ENTRIES, { filter, first: 100 });
  return data.auditEntries.nodes;
}

async function errorCode(headers: Record<string, string>, query: string) {
  const res = await gql(headers, query);
  return res.body.errors?.[0]?.extensions?.code;
}

function settingsRequest(
  as: TestUser,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<Response> {
  const headers = new Headers({ origin: ORIGIN, cookie: as.cookie, ...extra });
  if (body !== undefined) headers.set('content-type', 'application/json');
  return app.handle(
    new Request(
      `http://localhost/api/auth/instance/audit-settings${body === undefined ? '' : '/save'}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    ),
  );
}

const system = { ip: null, countryCode: null, userAgent: null, method: 'system' as const };

describe('audit log', () => {
  beforeEach(resetDb);

  const previousProxy = process.env.TRUST_PROXY;
  afterEach(() => {
    process.env.TRUST_PROXY = previousProxy;
  });

  it('owners and admins read entries newest first', async () => {
    const owner = await signUpTestUser();
    const admin = await signUpAs('admin');
    await withAuditRequest(system, () => recordAudit('teamCreated', { name: 'One' }));
    await withAuditRequest(system, () => recordAudit('teamDeleted', { name: 'Two' }));
    for (const as of [owner, admin]) {
      const list = await entries(as);
      expect(list.map((e) => e.type)).toEqual(['teamDeleted', 'teamCreated']);
      expect(list[0]!.metadata).toEqual({ name: 'Two' });
      expect(list[0]!.requestInformation).toMatchObject({ method: 'system' });
    }
  });

  it('filters by type, actor, date and IP', async () => {
    const owner = await signUpTestUser();
    const other = await signUpAs('admin');
    const details = { ...system, ip: '203.0.113.9', method: 'session' as const };
    await withAuditRequest(details, () =>
      recordAudit('teamCreated', { name: 'Mine' }, { actorId: owner.userId }),
    );
    await withAuditRequest(system, () =>
      recordAudit('teamDeleted', { name: 'Theirs' }, { actorId: other.userId }),
    );

    expect((await entries(owner, { type: { eq: 'teamCreated' } })).length).toBe(1);
    const byActor = await entries(owner, { actor: { id: { eq: other.userId } } });
    expect(byActor.map((e) => e.type)).toEqual(['teamDeleted']);
    expect(byActor[0]!.actorId).toBe(other.userId);
    expect((await entries(owner, { ip: { eq: '203.0.113.9' } })).map((e) => e.type)).toEqual([
      'teamCreated',
    ]);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    expect(await entries(owner, { createdAt: { gt: tomorrow } })).toEqual([]);
    expect((await entries(owner, { createdAt: { lt: tomorrow } })).length).toBe(2);
  });

  it('auditEntryTypes lists every type with a description', async () => {
    const owner = await signUpTestUser();
    const data = await gqlData(owner, `{ auditEntryTypes { type description } }`);
    const types = data.auditEntryTypes as { type: string; description: string }[];
    const login = types.find((t) => t.type === 'login');
    expect(login?.description.length).toBeGreaterThan(0);
    for (const type of ['loginFailed', 'userRoleChanged', 'dataExported', 'auditRetentionChanged'])
      expect(types.some((t) => t.type === type)).toBe(true);
  });

  it('members, guests and OAuth tokens without admin cannot read the log', async () => {
    const owner = await signUpTestUser();
    const member = await signUpAs('member');
    const guest = await signUpAs('guest');
    const query = `{ auditEntries { nodes { id } } }`;
    expect(await errorCode({ cookie: member.cookie }, query)).toBe('FORBIDDEN');
    expect(await errorCode({ cookie: guest.cookie }, query)).toBe('FORBIDDEN');
    expect(await errorCode({ cookie: member.cookie }, `{ auditEntryTypes { type } }`)).toBe(
      'FORBIDDEN',
    );

    const client = await createClient(owner.cookie);
    const readOnly = await obtainTokens(owner.cookie, client, 'read');
    expect(await errorCode(bearer(readOnly.access_token), query)).toBe('FORBIDDEN');
    const admin = await obtainTokens(owner.cookie, client, 'read,admin');
    expect(await errorCode(bearer(admin.access_token), query)).toBeUndefined();
  });

  it('offers no operation that edits or deletes an entry', async () => {
    const owner = await signUpTestUser();
    const data = await gqlData(owner, `{ __schema { mutationType { fields { name } } } }`);
    const names = (data.__schema.mutationType.fields as { name: string }[]).map((f) => f.name);
    expect(names.filter((n) => n.toLowerCase().includes('audit'))).toEqual([]);
  });

  it('keeps entries 30 days by default and only owners change it', async () => {
    const owner = await signUpTestUser();
    const admin = await signUpAs('admin');
    const member = await signUpAs('member');

    const read = await settingsRequest(admin);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ retention: '30d' });
    expect((await settingsRequest(member)).status).toBe(403);

    expect((await settingsRequest(admin, { retention: '1y' })).status).toBe(403);
    expect((await settingsRequest(owner, { retention: '5y' })).status).toBe(400);
    const saved = await settingsRequest(owner, { retention: '90d' });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ retention: '90d' });

    const changed = await entries(owner, { type: { eq: 'auditRetentionChanged' } });
    expect(changed.length).toBe(1);
    expect(changed[0]!.actorId).toBe(owner.userId);
    expect(changed[0]!.metadata).toEqual({ from: '30d', to: '90d' });
    expect(changed[0]!.requestInformation).toMatchObject({ method: 'session' });
  });

  it('refuses a retention change without a trusted Origin', async () => {
    const owner = await signUpTestUser();
    const res = await app.handle(
      new Request('http://localhost/api/auth/instance/audit-settings/save', {
        method: 'POST',
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ retention: '1y' }),
      }),
    );
    expect(res.status).toBe(403);
    expect(await (await settingsRequest(owner)).json()).toEqual({ retention: '30d' });
  });

  it('removes entries older than the retention period, and none with forever', async () => {
    const owner = await signUpTestUser();
    await withAuditRequest(system, () => recordAudit('teamCreated', { name: 'Old' }));
    await withAuditRequest(system, () => recordAudit('teamCreated', { name: 'New' }));
    await db.execute(
      sql`UPDATE ${auditEntry} SET created_at = now() - interval '40 days' WHERE metadata->>'name' = 'Old'`,
    );

    expect(await cleanupAuditEntries(new Date())).toBe(1);
    expect((await entries(owner)).map((e) => e.metadata?.name)).toEqual(['New']);

    expect((await settingsRequest(owner, { retention: 'forever' })).status).toBe(200);
    await db.execute(sql`UPDATE ${auditEntry} SET created_at = now() - interval '10 years'`);
    expect(await cleanupAuditEntries(new Date())).toBe(0);
  });

  it('the clean-up route needs the worker token', async () => {
    const previous = process.env.WORKER_INTERNAL_TOKEN;
    process.env.WORKER_INTERNAL_TOKEN = 'test-worker-token';
    try {
      const post = (headers: Record<string, string>) =>
        app.handle(
          new Request('http://localhost/internal/audit/cleanup', { method: 'POST', headers }),
        );
      expect((await post({})).status).toBe(401);
      const res = await post({ 'x-worker-token': 'test-worker-token' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ removed: 0 });
    } finally {
      process.env.WORKER_INTERNAL_TOKEN = previous;
    }
  });

  it('reads the IP and country from proxy headers only behind a trusted proxy', async () => {
    const owner = await signUpTestUser();
    const proxy = { 'x-forwarded-for': '198.51.100.7, 10.0.0.1', 'cf-ipcountry': 'NZ' };

    process.env.TRUST_PROXY = 'false';
    expect((await settingsRequest(owner, { retention: '90d' }, proxy)).status).toBe(200);
    process.env.TRUST_PROXY = 'true';
    expect((await settingsRequest(owner, { retention: '1y' }, proxy)).status).toBe(200);

    const list = await entries(owner, { type: { eq: 'auditRetentionChanged' } });
    expect(list.map((e) => [e.ip, e.countryCode])).toEqual([
      ['198.51.100.7', 'NZ'],
      [null, null],
    ]);
  });

  it('lets an action go ahead when its entry cannot be written, and says so next time', async () => {
    const owner = await signUpTestUser();
    // A BigInt cannot be stored as JSON, so this write fails.
    await withAuditRequest(system, () => recordAudit('teamCreated', { size: 1n }));
    await withAuditRequest(system, () => recordAudit('teamDeleted', { name: 'After' }));
    const list = await entries(owner);
    expect(list.map((e) => e.type)).toEqual(['teamDeleted']);
    expect(list[0]!.metadata).toEqual({ name: 'After', missedEntries: 1 });
  });

  it('folds repeated failed sign-ins from one address and IP into one entry', async () => {
    const owner = await signUpTestUser();
    const from = (ip: string) => ({ ...system, ip, method: 'session' as const });
    for (let i = 0; i < 3; i++)
      await withAuditRequest(from('192.0.2.1'), () =>
        recordLoginFailed('Someone@Example.com', 'unknownAddress'),
      );
    await withAuditRequest(from('192.0.2.2'), () =>
      recordLoginFailed('someone@example.com', 'unknownAddress'),
    );
    const list = await entries(owner, { type: { eq: 'loginFailed' } });
    expect(list.map((e) => [e.ip, e.metadata?.attempts])).toEqual([
      ['192.0.2.2', 1],
      ['192.0.2.1', 3],
    ]);
    expect(list[1]!.metadata).toMatchObject({
      address: 'someone@example.com',
      reason: 'unknownAddress',
    });
  });
});
