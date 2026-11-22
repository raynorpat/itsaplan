import { describe, it, expect, beforeEach } from 'bun:test';
import { authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { signUpWithRole } from '../../../__tests__/helpers/roles';
import { db, webhook } from '@repo/db';
import { eq } from 'drizzle-orm';
import type { WebhookResourceType } from '../../store';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';

async function setupOwnerTeam() {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  const team = await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  // createTeam seeds five default columns; the first is the target for issues.
  const view = await asOwner.teams({ teamKey: 'MKT' }).get();
  return { asOwner, teamId: team.data!.id, stateId: view.data!.states[0].id };
}

// Registers a webhook on MKT and returns its id.
async function createWebhook(
  client: Api,
  resourceTypes: WebhookResourceType[],
  opts: { enabled?: boolean } = {},
): Promise<string> {
  const res = await client.teams({ teamKey: 'MKT' }).webhooks.post({
    url: 'https://example.com/hook',
    resourceTypes,
    ...opts,
  });
  return res.data!.id;
}

describe('webhooks', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('lists webhooks in creation order', async () => {
    const owner = await signUpTestUser();
    const asOwner = authedApi(owner.cookie);
    await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await createWebhook(asOwner, ['Issue']));
    const list = await asOwner.teams({ teamKey: 'MKT' }).webhooks.get();
    expect(list.data!.map((w) => w.id)).toEqual(ids);
  });

  describe('create and list', () => {
    it('creates a webhook with a generated secret and lists it', async () => {
      const { asOwner, teamId } = await setupOwnerTeam();

      const created = await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
        url: 'https://example.com/hook',
        resourceTypes: ['Issue', 'Project'],
      });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({
        teamId,
        allPublicTeams: false,
        url: 'https://example.com/hook',
        resourceTypes: ['Issue', 'Project'],
        label: null,
        enabled: true,
      });
      expect(typeof created.data?.id).toBe('string');
      expect(created.data?.secret).toMatch(/^whsec_/);

      const list = await asOwner.teams({ teamKey: 'MKT' }).webhooks.get();
      expect(list.status).toBe(200);
      expect(list.data).toHaveLength(1);
      expect(list.data?.[0]).toMatchObject({ url: 'https://example.com/hook' });
    });

    it('honors an explicit enabled false', async () => {
      const { asOwner } = await setupOwnerTeam();
      const created = await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
        url: 'https://example.com/hook',
        resourceTypes: ['Issue'],
        enabled: false,
      });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({ enabled: false });
    });
  });

  describe('validation', () => {
    it('rejects a non-https url', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
        url: 'http://example.com/hook',
        resourceTypes: ['Issue'],
      });
      expect(res.status).toBe(400);
    });

    it('rejects a url pointing at a private address', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
        url: 'https://192.168.0.10/hook',
        resourceTypes: ['Issue'],
      });
      expect(res.status).toBe(400);
    });

    it('rejects a url pointing at localhost', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
        url: 'https://localhost/hook',
        resourceTypes: ['Issue'],
      });
      expect(res.status).toBe(400);
    });

    it('rejects an empty resource type list', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
        url: 'https://example.com/hook',
        resourceTypes: [],
      });
      expect(res.status).toBe(400);
    });

    it('rejects an unknown resource type', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
        url: 'https://example.com/hook',
        // @ts-expect-error an unknown resource type is rejected by the schema
        resourceTypes: ['Customer'],
      });
      expect(res.status).toBe(400);
    });

    it('rejects a non-numeric webhook id', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner.webhooks({ webhookId: 'abc' }).patch({ enabled: false });
      expect(res.status).toBe(400);
    });
  });

  describe('update', () => {
    it('updates only the provided fields', async () => {
      const { asOwner } = await setupOwnerTeam();
      const id = (
        await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
          url: 'https://example.com/hook',
          resourceTypes: ['Issue'],
        })
      ).data!.id;

      const patched = await asOwner.webhooks({ webhookId: id }).patch({
        resourceTypes: ['Comment', 'Project'],
        label: 'CI',
        enabled: false,
      });
      expect(patched.status).toBe(200);
      expect(patched.data).toMatchObject({
        url: 'https://example.com/hook',
        resourceTypes: ['Comment', 'Project'],
        label: 'CI',
        enabled: false,
      });
    });

    it('validates the url on update', async () => {
      const { asOwner } = await setupOwnerTeam();
      const id = (
        await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
          url: 'https://example.com/hook',
          resourceTypes: ['Issue'],
        })
      ).data!.id;

      const res = await asOwner.webhooks({ webhookId: id }).patch({ url: 'http://example.com/x' });
      expect(res.status).toBe(400);
    });

    it('returns 404 when patching a missing webhook', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner
        .webhooks({ webhookId: '00000000-0000-4000-8000-000000000000' })
        .patch({ enabled: false });
      expect(res.status).toBe(404);
    });
  });

  describe('delete', () => {
    it('deletes a webhook', async () => {
      const { asOwner } = await setupOwnerTeam();
      const id = (
        await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
          url: 'https://example.com/hook',
          resourceTypes: ['Issue'],
        })
      ).data!.id;

      const del = await asOwner.webhooks({ webhookId: id }).delete();
      expect(del.status).toBe(204);

      const list = await asOwner.teams({ teamKey: 'MKT' }).webhooks.get();
      expect(list.data).toHaveLength(0);
    });

    it('returns 404 when deleting a missing webhook', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner
        .webhooks({ webhookId: '00000000-0000-4000-8000-000000000000' })
        .delete();
      expect(res.status).toBe(404);
    });
  });

  // emit.ts queues one webhook_delivery per active, subscribed webhook when a
  // domain mutation fires an event. The tests read the queued rows from the
  // database (the delivery worker does not run in tests, so they stay pending).
  // These assert the fan-out selection, not the worker.
  describe('fan-out', () => {
    it('queues a pending delivery for a subscribed enabled webhook on issue create', async () => {
      const { asOwner, stateId } = await setupOwnerTeam();
      const id = await createWebhook(asOwner, ['Issue']);

      await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Task' });

      const res = await webhookDeliveries(id);
      expect(res.data?.items).toHaveLength(1);
      expect(res.data!.items[0]).toMatchObject({
        eventType: 'Issue',
        status: 'pending',
        attempts: 0,
        responseStatus: null,
      });
      expect(res.data!.items[0].payload).toMatchObject({ action: 'create', type: 'Issue' });
    });

    it('does not queue for an inactive webhook', async () => {
      const { asOwner, stateId } = await setupOwnerTeam();
      const id = await createWebhook(asOwner, ['Issue'], { enabled: false });

      await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Task' });

      const res = await webhookDeliveries(id);
      expect(res.data?.items).toHaveLength(0);
    });

    it('does not queue for an event the webhook is not subscribed to', async () => {
      const { asOwner, stateId } = await setupOwnerTeam();
      const id = await createWebhook(asOwner, ['Comment']);

      await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Task' });

      const res = await webhookDeliveries(id);
      expect(res.data?.items).toHaveLength(0);
    });

    it('fans out to every matching webhook with a shared event id', async () => {
      const { asOwner, stateId } = await setupOwnerTeam();
      const a = await createWebhook(asOwner, ['Issue']);
      const b = await createWebhook(asOwner, ['Issue']);

      await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Task' });

      const da = await webhookDeliveries(a);
      const db = await webhookDeliveries(b);
      expect(da.data?.items).toHaveLength(1);
      expect(db.data?.items).toHaveLength(1);
      // One event, one id shared across both deliveries so a receiver can dedupe.
      expect(da.data!.items[0].eventId).toBe(db.data!.items[0].eventId);
    });

    it('queues a delivery on comment.created', async () => {
      const { asOwner, stateId } = await setupOwnerTeam();
      const id = await createWebhook(asOwner, ['Comment']);

      const issue = await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Task' });
      await asOwner.issues({ issueId: issue.data!.id }).comments.post({ body: 'looks good' });

      const res = await webhookDeliveries(id);
      expect(res.data?.items).toHaveLength(1);
      expect(res.data!.items[0]).toMatchObject({ eventType: 'Comment' });
    });
  });

  describe('re-enabling', () => {
    it('clears the failure count when a webhook is enabled again', async () => {
      const { asOwner } = await setupOwnerTeam();
      const id = await createWebhook(asOwner, ['Issue'], { enabled: false });
      await db.update(webhook).set({ consecutiveFailures: 19 }).where(eq(webhook.id, id));
      await asOwner.webhooks({ webhookId: id }).patch({ enabled: true });
      const [row] = await db.select().from(webhook).where(eq(webhook.id, id));
      expect(row!.consecutiveFailures).toBe(0);
    });
  });

  describe('secret', () => {
    it('rotates the secret', async () => {
      const { asOwner } = await setupOwnerTeam();
      const created = (
        await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
          url: 'https://example.com/hook',
          resourceTypes: ['Issue'],
        })
      ).data!;
      const rotated = await asOwner.webhooks({ webhookId: created.id })['rotate-secret'].post();
      expect(rotated.status).toBe(200);
      expect(rotated.data!.secret).toMatch(/^whsec_/);
      expect(rotated.data!.secret).not.toBe(created.secret);
    });
  });

  // All-teams webhooks: workspace admins and owners.
  describe('all teams', () => {
    const hook = { url: 'https://example.com/all', resourceTypes: ['Issue' as const] };

    it('the workspace owner creates and lists an all-teams webhook', async () => {
      const { asOwner } = await setupOwnerTeam();
      const created = await asOwner.webhooks.post(hook);
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({ teamId: null, allPublicTeams: true });
      const list = await asOwner.webhooks.get();
      expect(list.data!.map((w) => w.id)).toEqual([created.data!.id]);
      // Team lists do not include it.
      expect((await asOwner.teams({ teamKey: 'MKT' }).webhooks.get()).data).toEqual([]);
    });

    it('a workspace admin manages all-teams webhooks', async () => {
      await signUpTestUser(); // workspace owner
      const user = (await signUpWithRole('admin')).api;
      const created = await user.webhooks.post(hook);
      expect(created.status).toBe(201);
      const id = created.data!.id;
      expect((await user.webhooks({ webhookId: id }).patch({ label: 'x' })).status).toBe(200);
      expect((await user.webhooks({ webhookId: id }).delete()).status).toBe(204);
    });

    it('a workspace member cannot', async () => {
      const owner = authedApi((await signUpTestUser()).cookie);
      const member = (await signUpWithRole('member')).api;
      const id = (await owner.webhooks.post(hook)).data!.id;

      expect((await member.webhooks.post(hook)).status).toBe(403);
      expect((await member.webhooks.get()).status).toBe(403);
      expect((await member.webhooks({ webhookId: id }).patch({ label: 'x' })).status).toBe(403);
      expect((await member.webhooks({ webhookId: id }).delete()).status).toBe(403);
    });
  });

  describe('validation of addresses', () => {
    for (const url of [
      'https://[::1]/hook',
      'https://[::ffff:127.0.0.1]/hook',
      'https://[fd00::1]/hook',
      'https://[fe80::1]/hook',
    ]) {
      it(`rejects ${url}`, async () => {
        const { asOwner } = await setupOwnerTeam();
        const res = await asOwner
          .teams({ teamKey: 'MKT' })
          .webhooks.post({ url, resourceTypes: ['Issue'] });
        expect(res.status).toBe(400);
      });
    }
  });

  describe('access', () => {
    it('returns 404 for an unknown team', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner.teams({ teamKey: 'NOPE' }).webhooks.get();
      expect(res.status).toBe(404);
    });

    it('denies a non-member on team-scoped and entity routes', async () => {
      const { asOwner } = await setupOwnerTeam();
      const webhookId = (
        await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
          url: 'https://example.com/hook',
          resourceTypes: ['Issue'],
        })
      ).data!.id;

      const outsider = (await signUpWithRole('guest')).api;

      // Guard-thrown 403 is not in Treaty's inferred error-status union, so
      // assert the top-level HTTP status (typed number) rather than error.status.
      const list = await outsider.teams({ teamKey: 'MKT' }).webhooks.get();
      expect(list.status).toBe(404);

      const create = await outsider.teams({ teamKey: 'MKT' }).webhooks.post({
        url: 'https://evil.example.com/hook',
        resourceTypes: ['Issue'],
      });
      expect(create.status).toBe(404);

      const patch = await outsider.webhooks({ webhookId }).patch({ enabled: false });
      expect(patch.status).toBe(404);

      const del = await outsider.webhooks({ webhookId }).delete();
      expect(del.status).toBe(404);
    });
  });
});
