import { beforeEach, describe, expect, it } from 'bun:test';
import { db, webhook } from '@repo/db';
import { eq } from 'drizzle-orm';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  createIssue,
  createTeam,
  gqlData,
  signUpAs,
  type Data,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';

// Webhooks: creation with a generated secret, URL and resource type checks,
// updates, delivery fan-out, re-enabling, all-teams webhooks and access through
// the team and the workspace role.

const MISSING = '00000000-0000-4000-8000-000000000000';
const HOOK = 'id url resourceTypes label enabled allPublicTeams secret team { id }';

type Res = Awaited<ReturnType<typeof gql>>;
const code = (res: Res) => res.body.errors?.[0]?.extensions?.code;

async function setup() {
  const owner = await signUpTestUser();
  const view = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  return { owner, teamId: view.team.id, stateId: view.states[0]!.id };
}

function create(u: TestUser, input: Record<string, unknown>) {
  return gql(
    { cookie: u.cookie },
    `mutation ($input: WebhookCreateInput!) { webhookCreate(input: $input) { webhook { ${HOOK} } } }`,
    { input },
  );
}

async function created(u: TestUser, input: Record<string, unknown>) {
  const res = await create(u, input);
  if (res.body.errors) throw new Error(res.body.errors[0]!.message);
  return (res.body.data as { webhookCreate: { webhook: Data } }).webhookCreate.webhook;
}

// A webhook on the team for these resource types.
const teamHook = async (
  u: TestUser,
  teamId: string,
  resourceTypes: string[],
  extra: Record<string, unknown> = {},
) =>
  (await created(u, { url: 'https://example.com/hook', teamId, resourceTypes, ...extra }))
    .id as string;

function update(u: TestUser, id: string, input: Record<string, unknown>) {
  return gql(
    { cookie: u.cookie },
    `mutation ($id: String!, $input: WebhookUpdateInput!) {
      webhookUpdate(id: $id, input: $input) { webhook { ${HOOK} } } }`,
    { id, input },
  );
}

const remove = (u: TestUser, id: string) =>
  gql({ cookie: u.cookie }, `mutation ($id: String!) { webhookDelete(id: $id) { success } }`, {
    id,
  });

const listed = async (u: TestUser) =>
  (await gqlData(u, '{ webhooks { nodes { id } } }')).webhooks.nodes.map(
    (w: { id: string }) => w.id,
  );

describe('webhooks', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('create and list', () => {
    it('creates a webhook with a generated secret and lists it', async () => {
      const { owner, teamId } = await setup();
      const w = await created(owner, {
        url: 'https://example.com/hook',
        teamId,
        resourceTypes: ['Issue', 'Project'],
      });
      expect(w).toMatchObject({
        team: { id: teamId },
        allPublicTeams: false,
        url: 'https://example.com/hook',
        resourceTypes: ['Issue', 'Project'],
        label: null,
        enabled: true,
      });
      expect(w.secret).toMatch(/^whsec_/);
      expect(await listed(owner)).toEqual([w.id]);
    });

    it('honors an explicit enabled false', async () => {
      const { owner, teamId } = await setup();
      const w = await created(owner, {
        url: 'https://example.com/hook',
        teamId,
        resourceTypes: ['Issue'],
        enabled: false,
      });
      expect(w.enabled).toBe(false);
    });
  });

  describe('validation', () => {
    for (const url of [
      'http://example.com/hook',
      'https://192.168.0.10/hook',
      'https://localhost/hook',
      'https://[::1]/hook',
      'https://[::ffff:127.0.0.1]/hook',
      'https://[fd00::1]/hook',
      'https://[fe80::1]/hook',
    ]) {
      it(`rejects ${url}`, async () => {
        const { owner, teamId } = await setup();
        expect(code(await create(owner, { url, teamId, resourceTypes: ['Issue'] }))).toBe(
          'INVALID_INPUT',
        );
      });
    }

    it('rejects an empty resource type list', async () => {
      const { owner, teamId } = await setup();
      const res = await create(owner, {
        url: 'https://example.com/hook',
        teamId,
        resourceTypes: [],
      });
      expect(code(res)).toBe('INVALID_INPUT');
    });
  });

  describe('update and delete', () => {
    it('updates only the provided fields', async () => {
      const { owner, teamId } = await setup();
      const id = await teamHook(owner, teamId, ['Issue']);
      const res = await update(owner, id, {
        resourceTypes: ['Comment', 'Project'],
        label: 'CI',
        enabled: false,
      });
      expect(
        (res.body.data as { webhookUpdate: { webhook: unknown } }).webhookUpdate.webhook,
      ).toMatchObject({
        url: 'https://example.com/hook',
        resourceTypes: ['Comment', 'Project'],
        label: 'CI',
        enabled: false,
      });
    });

    it('validates the url on update', async () => {
      const { owner, teamId } = await setup();
      const id = await teamHook(owner, teamId, ['Issue']);
      expect(code(await update(owner, id, { url: 'http://example.com/x' }))).toBe('INVALID_INPUT');
    });

    it('answers not found when updating a missing webhook', async () => {
      const { owner } = await setup();
      expect(code(await update(owner, MISSING, { enabled: false }))).toBe('ENTITY_NOT_FOUND');
    });

    it('answers not found when deleting a missing webhook', async () => {
      const { owner } = await setup();
      expect(code(await remove(owner, MISSING))).toBe('ENTITY_NOT_FOUND');
    });

    it('clears the failure count when a webhook is enabled again', async () => {
      const { owner, teamId } = await setup();
      const id = await teamHook(owner, teamId, ['Issue'], { enabled: false });
      await db.update(webhook).set({ consecutiveFailures: 19 }).where(eq(webhook.id, id));
      await update(owner, id, { enabled: true });
      const [row] = await db.select().from(webhook).where(eq(webhook.id, id));
      expect(row!.consecutiveFailures).toBe(0);
    });
  });

  // One webhook_delivery is queued per active, subscribed webhook when an event
  // fires; the worker does not run in tests, so the rows stay pending.
  describe('fan-out', () => {
    it('fans out to every matching webhook with a shared event id', async () => {
      const { owner, teamId, stateId } = await setup();
      const a = await teamHook(owner, teamId, ['Issue']);
      const b = await teamHook(owner, teamId, ['Issue']);
      await createIssue(owner, { teamId, stateId });
      const da = (await webhookDeliveries(a)).data!.items;
      const dbs = (await webhookDeliveries(b)).data!.items;
      expect(da).toHaveLength(1);
      expect(dbs).toHaveLength(1);
      expect(da[0]!.eventId).toBe(dbs[0]!.eventId);
    });
  });

  describe('all teams', () => {
    it('lets a workspace admin manage all-teams webhooks', async () => {
      await setup();
      const admin = await signUpAs('admin');
      const w = await created(admin, {
        url: 'https://example.com/all',
        resourceTypes: ['Issue'],
        allPublicTeams: true,
      });
      expect(w).toMatchObject({ team: null, allPublicTeams: true });
      expect((await update(admin, w.id, { label: 'x' })).body.errors).toBeUndefined();
      expect((await remove(admin, w.id)).body.errors).toBeUndefined();
    });

    it('refuses all-teams webhooks to a workspace member', async () => {
      const { owner } = await setup();
      const all = await created(owner, {
        url: 'https://example.com/all',
        resourceTypes: ['Issue'],
        allPublicTeams: true,
      });
      const member = await signUpAs('member');
      const res = await create(member, {
        url: 'https://example.com/all',
        resourceTypes: ['Issue'],
        allPublicTeams: true,
      });
      expect(code(res)).toBe('FORBIDDEN');
      expect(await listed(member)).toEqual([]);
      expect(code(await update(member, all.id, { label: 'x' }))).toBe('FORBIDDEN');
      expect(code(await remove(member, all.id))).toBe('FORBIDDEN');
    });
  });

  describe('access', () => {
    it("refuses a guest outside the team on the team's webhooks", async () => {
      const { owner, teamId } = await setup();
      const id = await teamHook(owner, teamId, ['Issue']);
      const guest = await signUpAs('guest');
      const res = await create(guest, {
        url: 'https://evil.example.com/hook',
        teamId,
        resourceTypes: ['Issue'],
      });
      expect(code(res)).toBe('ENTITY_NOT_FOUND');
      expect(code(await update(guest, id, { enabled: false }))).toBe('ENTITY_NOT_FOUND');
      expect(code(await remove(guest, id))).toBe('ENTITY_NOT_FOUND');
    });
  });
});
