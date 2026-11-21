import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';

// Issue events in Linear's webhook format, read back through the deliveries
// endpoint (the worker does not run in tests, so deliveries stay pending).

type Payload = {
  action: string;
  type: string;
  actor: { id: string; type: string; name: string } | null;
  data: Record<string, unknown>;
  updatedFrom?: Record<string, unknown>;
  url: string;
  organizationId: string;
  webhookId: string;
  createdAt: string;
};

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const team = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!;
  const hook = (
    await asOwner
      .teams({ teamKey: 'MKT' })
      .webhooks.post({ url: 'https://example.com/hook', resourceTypes: ['Issue'] })
  ).data!;
  return { owner, asOwner, team, hookId: hook.id };
}

// Payloads of a webhook, oldest first.
async function payloads(api: Api, webhookId: string): Promise<Payload[]> {
  const res = await api.webhooks({ webhookId }).deliveries.get({ query: { limit: 50 } });
  return res.data!.items.map((d) => d.payload as Payload).reverse();
}

async function createIssue(api: Api, stateId: string, title = 'Task') {
  return (await api.teams({ teamKey: 'MKT' }).issues.post({ stateId, title })).data!;
}

describe('issue webhooks', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('sends Issue create with Linear data and the actor', async () => {
    const { owner, asOwner, team, hookId } = await setup();
    const issue = await createIssue(asOwner, team.states[0].id);
    const res = await asOwner.webhooks({ webhookId: hookId }).deliveries.get();
    expect(res.data!.items).toHaveLength(1);
    expect(res.data!.items[0]!.eventType).toBe('Issue');
    const [p] = await payloads(asOwner, hookId);
    expect(p).toMatchObject({
      action: 'create',
      type: 'Issue',
      actor: { id: owner.userId, type: 'user', name: 'Owner' },
      data: {
        id: issue.id,
        identifier: 'MKT-1',
        title: 'Task',
        teamId: team.team.id,
        stateId: team.states[0].id,
        labelIds: [],
        team: { id: team.team.id, key: 'MKT' },
        state: { id: team.states[0].id },
      },
      webhookId: hookId,
    });
    expect(p!.updatedFrom).toBeUndefined();
    expect(typeof p!.organizationId).toBe('string');
    expect(p!.url).toContain('/team/MKT/issue/1');
    expect(p!.data).not.toHaveProperty('assigneeUserId');
  });

  it('sends the old stateId in updatedFrom on a state change', async () => {
    const { asOwner, team, hookId } = await setup();
    const issue = await createIssue(asOwner, team.states[0].id);
    await asOwner.issues({ issueId: issue.id }).patch({ stateId: team.states[1].id });
    const [created, updated] = await payloads(asOwner, hookId);
    expect(updated).toMatchObject({ action: 'update', data: { stateId: team.states[1].id } });
    expect(updated!.updatedFrom).toMatchObject({
      stateId: team.states[0].id,
      updatedAt: created!.data.updatedAt,
    });
    expect(updated!.updatedFrom).not.toHaveProperty('title');
  });

  it('sends the previous labelIds in updatedFrom on a label change', async () => {
    const { asOwner, team, hookId } = await setup();
    const scope = asOwner.teams({ teamKey: 'MKT' });
    const a = (await scope.labels.post({ name: 'a' })).data!;
    const b = (await scope.labels.post({ name: 'b' })).data!;
    const issue = await createIssue(asOwner, team.states[0].id);
    await asOwner.issues({ issueId: issue.id }).patch({ labelIds: [a.id] });
    await asOwner.issues({ issueId: issue.id }).patch({ labelIds: [a.id, b.id] });
    const all = await payloads(asOwner, hookId);
    const last = all[all.length - 1]!;
    expect(last.action).toBe('update');
    expect(last.updatedFrom).toMatchObject({ labelIds: [a.id] });
    expect(Object.keys(last.updatedFrom!).sort()).toEqual(['labelIds', 'updatedAt']);
    expect(last.data.labelIds).toEqual([a.id, b.id].sort());
  });

  it('sends archive and restore as Issue updates with archivedAt', async () => {
    const { asOwner, team, hookId } = await setup();
    const issue = await createIssue(asOwner, team.states[0].id);
    await asOwner.issues({ issueId: issue.id }).archive.post();
    await asOwner.issues({ issueId: issue.id }).restore.post();
    const [, archived, restored] = await payloads(asOwner, hookId);
    expect(archived).toMatchObject({ action: 'update', updatedFrom: { archivedAt: null } });
    expect(archived!.data.archivedAt).toBeTruthy();
    expect(restored!.data.archivedAt).toBeNull();
    expect(restored!.updatedFrom!.archivedAt).toBeTruthy();
  });

  it('sends Issue remove with the data before deletion', async () => {
    const { asOwner, team, hookId } = await setup();
    const issue = await createIssue(asOwner, team.states[0].id);
    await asOwner.issues({ issueId: issue.id }).delete();
    const all = await payloads(asOwner, hookId);
    expect(all[all.length - 1]).toMatchObject({
      action: 'remove',
      data: { id: issue.id, identifier: 'MKT-1', title: 'Task' },
    });
  });

  it('sends one event per issue on a bulk update', async () => {
    const { asOwner, team, hookId } = await setup();
    const ids = [];
    for (const t of ['a', 'b', 'c'])
      ids.push((await createIssue(asOwner, team.states[0].id, t)).id);
    await asOwner.teams({ teamKey: 'MKT' }).issues.bulk.patch({ ids, patch: { priority: 2 } });
    const updates = (await payloads(asOwner, hookId)).filter((p) => p.action === 'update');
    expect(updates.map((p) => p.data.id).sort()).toEqual([...ids].sort());
  });

  it('sends events of a team created after an all-teams webhook', async () => {
    const { asOwner } = await setup();
    const all = (
      await asOwner.webhooks.post({ url: 'https://example.com/all', resourceTypes: ['Issue'] })
    ).data!;
    await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
    const ops = (await asOwner.teams({ teamKey: 'OPS' }).get()).data!;
    await asOwner.teams({ teamKey: 'OPS' }).issues.post({ stateId: ops.states[0].id, title: 'x' });
    const [p] = await payloads(asOwner, all.id);
    expect(p).toMatchObject({ action: 'create', data: { teamId: ops.team.id } });
  });

  it('sends nothing to a disabled webhook or one without Issue', async () => {
    const { asOwner, team } = await setup();
    const scope = asOwner.teams({ teamKey: 'MKT' });
    const off = (
      await scope.webhooks.post({
        url: 'https://example.com/a',
        resourceTypes: ['Issue'],
        enabled: false,
      })
    ).data!;
    const other = (
      await scope.webhooks.post({ url: 'https://example.com/b', resourceTypes: ['Comment'] })
    ).data!;
    await createIssue(asOwner, team.states[0].id);
    expect(await payloads(asOwner, off.id)).toEqual([]);
    expect(await payloads(asOwner, other.id)).toEqual([]);
  });
});
