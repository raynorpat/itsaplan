import { describe, it, expect, beforeEach } from 'bun:test';
import { authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import type { WebhookEventType } from '../../store';

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
  events: WebhookEventType[],
  opts: { isActive?: boolean } = {},
): Promise<string> {
  const res = await client.teams({ teamKey: 'MKT' }).webhooks.post({
    url: 'https://example.com/hook',
    events,
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
    for (let i = 0; i < 5; i++) ids.push(await createWebhook(asOwner, ['issue.created']));
    const list = await asOwner.teams({ teamKey: 'MKT' }).webhooks.get();
    expect(list.data!.map((w) => w.id)).toEqual(ids);
  });

  describe('create and list', () => {
    it('creates a webhook with a generated secret and lists it', async () => {
      const { asOwner, teamId } = await setupOwnerTeam();

      const created = await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
        url: 'https://example.com/hook',
        events: ['issue.created', 'issue.updated'],
      });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({
        teamId,
        url: 'https://example.com/hook',
        events: ['issue.created', 'issue.updated'],
        isActive: true,
      });
      expect(typeof created.data?.id).toBe('string');
      expect(created.data?.secret).toMatch(/^whsec_/);

      const list = await asOwner.teams({ teamKey: 'MKT' }).webhooks.get();
      expect(list.status).toBe(200);
      expect(list.data).toHaveLength(1);
      expect(list.data?.[0]).toMatchObject({ url: 'https://example.com/hook' });
    });

    it('honors an explicit isActive false', async () => {
      const { asOwner } = await setupOwnerTeam();
      const created = await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
        url: 'https://example.com/hook',
        events: ['issue.created'],
        isActive: false,
      });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({ isActive: false });
    });
  });

  describe('validation', () => {
    it('rejects a non-https url', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
        url: 'http://example.com/hook',
        events: ['issue.created'],
      });
      expect(res.status).toBe(400);
    });

    it('rejects a url pointing at a private address', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
        url: 'https://192.168.0.10/hook',
        events: ['issue.created'],
      });
      expect(res.status).toBe(400);
    });

    it('rejects a url pointing at localhost', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
        url: 'https://localhost/hook',
        events: ['issue.created'],
      });
      expect(res.status).toBe(400);
    });

    it('rejects an empty events list', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
        url: 'https://example.com/hook',
        events: [],
      });
      expect(res.status).toBe(400);
    });

    it('rejects an unknown event type', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
        url: 'https://example.com/hook',
        // @ts-expect-error unknown event type is rejected by the schema
        events: ['issue.exploded'],
      });
      expect(res.status).toBe(400);
    });

    it('rejects a non-numeric webhook id', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner.webhooks({ webhookId: 'abc' }).patch({ isActive: false });
      expect(res.status).toBe(400);
    });
  });

  describe('update', () => {
    it('updates only the provided fields', async () => {
      const { asOwner } = await setupOwnerTeam();
      const id = (
        await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
          url: 'https://example.com/hook',
          events: ['issue.created'],
        })
      ).data!.id;

      const patched = await asOwner.webhooks({ webhookId: id }).patch({
        events: ['issue.deleted', 'comment.created'],
        isActive: false,
      });
      expect(patched.status).toBe(200);
      expect(patched.data).toMatchObject({
        url: 'https://example.com/hook',
        events: ['issue.deleted', 'comment.created'],
        isActive: false,
      });
    });

    it('validates the url on update', async () => {
      const { asOwner } = await setupOwnerTeam();
      const id = (
        await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
          url: 'https://example.com/hook',
          events: ['issue.created'],
        })
      ).data!.id;

      const res = await asOwner.webhooks({ webhookId: id }).patch({ url: 'http://example.com/x' });
      expect(res.status).toBe(400);
    });

    it('returns 404 when patching a missing webhook', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner
        .webhooks({ webhookId: '00000000-0000-4000-8000-000000000000' })
        .patch({ isActive: false });
      expect(res.status).toBe(404);
    });
  });

  describe('delete', () => {
    it('deletes a webhook', async () => {
      const { asOwner } = await setupOwnerTeam();
      const id = (
        await asOwner.teams({ teamKey: 'MKT' }).webhooks.post({
          url: 'https://example.com/hook',
          events: ['issue.created'],
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

  describe('deliveries', () => {
    it('returns an empty page for a webhook with no deliveries', async () => {
      const { asOwner } = await setupOwnerTeam();
      const id = await createWebhook(asOwner, ['issue.created']);

      const res = await asOwner.webhooks({ webhookId: id }).deliveries.get();
      expect(res.status).toBe(200);
      expect(res.data).toMatchObject({ items: [], nextCursor: null });
    });

    it('returns 404 for a missing webhook', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner
        .webhooks({ webhookId: '00000000-0000-4000-8000-000000000000' })
        .deliveries.get();
      expect(res.status).toBe(404);
    });

    it('rejects a non-numeric webhook id', async () => {
      const { asOwner } = await setupOwnerTeam();
      const res = await asOwner.webhooks({ webhookId: 'abc' }).deliveries.get();
      expect(res.status).toBe(400);
    });

    it('paginates newest-first with a keyset cursor', async () => {
      const { asOwner, stateId } = await setupOwnerTeam();
      const id = await createWebhook(asOwner, ['issue.created']);

      // Three issue.created events queue three deliveries on this webhook.
      for (const title of ['a', 'b', 'c']) {
        await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title });
      }

      const first = await asOwner
        .webhooks({ webhookId: id })
        .deliveries.get({ query: { limit: 2 } });
      expect(first.status).toBe(200);
      expect(first.data?.items).toHaveLength(2);
      expect(first.data?.nextCursor).not.toBeNull();
      // Newest first.
      expect(new Date(first.data!.items[0].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(first.data!.items[1].createdAt).getTime(),
      );

      const second = await asOwner
        .webhooks({ webhookId: id })
        .deliveries.get({ query: { before: first.data!.nextCursor!, limit: 2 } });
      expect(second.data?.items).toHaveLength(1);
      expect(second.data?.nextCursor).toBeNull();
      // The cursor page holds the remaining item, not a repeat of the first page.
      expect(first.data!.items.map((i) => i.id)).not.toContain(second.data!.items[0].id);
    });
  });

  // emit.ts queues one webhook_delivery per active, subscribed webhook when a
  // domain mutation fires an event. The queued rows are observable through the
  // deliveries endpoint (the delivery worker does not run in tests, so they stay
  // pending). These assert the fan-out selection, not the worker.
  describe('fan-out', () => {
    it('queues a pending delivery for a subscribed active webhook on issue.created', async () => {
      const { asOwner, stateId } = await setupOwnerTeam();
      const id = await createWebhook(asOwner, ['issue.created']);

      await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Task' });

      const res = await asOwner.webhooks({ webhookId: id }).deliveries.get();
      expect(res.data?.items).toHaveLength(1);
      expect(res.data!.items[0]).toMatchObject({
        eventType: 'issue.created',
        status: 'pending',
        attempts: 0,
        responseStatus: null,
      });
      // The payload uses the Linear-style envelope: action + resource type, with
      // the granular event kept in `event`.
      expect(res.data!.items[0].payload).toMatchObject({
        action: 'create',
        type: 'Issue',
        event: 'issue.created',
      });
    });

    it('does not queue for an inactive webhook', async () => {
      const { asOwner, stateId } = await setupOwnerTeam();
      const id = await createWebhook(asOwner, ['issue.created'], { isActive: false });

      await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Task' });

      const res = await asOwner.webhooks({ webhookId: id }).deliveries.get();
      expect(res.data?.items).toHaveLength(0);
    });

    it('does not queue for an event the webhook is not subscribed to', async () => {
      const { asOwner, stateId } = await setupOwnerTeam();
      const id = await createWebhook(asOwner, ['comment.created']);

      await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Task' });

      const res = await asOwner.webhooks({ webhookId: id }).deliveries.get();
      expect(res.data?.items).toHaveLength(0);
    });

    it('fans out to every matching webhook with a shared event id', async () => {
      const { asOwner, stateId } = await setupOwnerTeam();
      const a = await createWebhook(asOwner, ['issue.created']);
      const b = await createWebhook(asOwner, ['issue.created']);

      await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Task' });

      const da = await asOwner.webhooks({ webhookId: a }).deliveries.get();
      const db = await asOwner.webhooks({ webhookId: b }).deliveries.get();
      expect(da.data?.items).toHaveLength(1);
      expect(db.data?.items).toHaveLength(1);
      // One event, one id shared across both deliveries so a receiver can dedupe.
      expect(da.data!.items[0].eventId).toBe(db.data!.items[0].eventId);
    });

    it('fires the granular issue.state_changed alongside issue.updated on a column move', async () => {
      const { asOwner, stateId } = await setupOwnerTeam();
      const view = await asOwner.teams({ teamKey: 'MKT' }).get();
      const otherColumn = view.data!.states[1].id;
      const id = await createWebhook(asOwner, ['issue.updated', 'issue.state_changed']);

      const issue = await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Task' });
      await asOwner.issues({ issueId: issue.data!.id }).patch({ stateId: otherColumn });

      const res = await asOwner.webhooks({ webhookId: id }).deliveries.get();
      const types = res.data!.items.map((d) => d.eventType).sort();
      expect(types).toEqual(['issue.state_changed', 'issue.updated']);
    });

    it('queues a delivery on comment.created', async () => {
      const { asOwner, stateId } = await setupOwnerTeam();
      const id = await createWebhook(asOwner, ['comment.created']);

      const issue = await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Task' });
      await asOwner.issues({ issueId: issue.data!.id }).comments.post({ body: 'looks good' });

      const res = await asOwner.webhooks({ webhookId: id }).deliveries.get();
      expect(res.data?.items).toHaveLength(1);
      expect(res.data!.items[0]).toMatchObject({ eventType: 'comment.created' });
    });
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
          events: ['issue.created'],
        })
      ).data!.id;

      const outsider = authedApi((await signUpTestUser()).cookie);

      // Guard-thrown 403 is not in Treaty's inferred error-status union, so
      // assert the top-level HTTP status (typed number) rather than error.status.
      const list = await outsider.teams({ teamKey: 'MKT' }).webhooks.get();
      expect(list.status).toBe(403);

      const create = await outsider.teams({ teamKey: 'MKT' }).webhooks.post({
        url: 'https://evil.example.com/hook',
        events: ['issue.created'],
      });
      expect(create.status).toBe(403);

      const patch = await outsider.webhooks({ webhookId }).patch({ isActive: false });
      expect(patch.status).toBe(403);

      const del = await outsider.webhooks({ webhookId }).delete();
      expect(del.status).toBe(403);

      const deliveries = await outsider.webhooks({ webhookId }).deliveries.get();
      expect(deliveries.status).toBe(403);
    });
  });
});
