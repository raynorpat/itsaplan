import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';

// Comment and IssueLabel events. Team label groups are sent as IssueLabels with
// isGroup: true, as Linear models them.

type Payload = {
  action: string;
  type: string;
  data: Record<string, unknown>;
  updatedFrom?: Record<string, unknown>;
};

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const team = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!;
  const hook = (
    await asOwner
      .teams({ teamKey: 'MKT' })
      .webhooks.post({ url: 'https://example.com/hook', resourceTypes: ['Comment', 'IssueLabel'] })
  ).data!;
  return { owner, asOwner, team, hookId: hook.id, scope: asOwner.teams({ teamKey: 'MKT' }) };
}

async function payloads(webhookId: string): Promise<Payload[]> {
  const res = await webhookDeliveries(webhookId);
  return res.data!.items.map((d) => d.payload as Payload).reverse();
}

describe('comment and label webhooks', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('sends Comment create', async () => {
    const { owner, asOwner, team, hookId, scope } = await setup();
    const issue = (await scope.issues.post({ stateId: team.states[0].id, title: 'x' })).data!;
    await asOwner.issues({ issueId: issue.id }).comments.post({ body: 'hi' });
    const [p] = await payloads(hookId);
    expect(p).toMatchObject({
      action: 'create',
      type: 'Comment',
      data: { body: 'hi', issueId: issue.id, userId: owner.userId },
    });
    expect(typeof p!.data.id).toBe('string');
  });

  it('sends IssueLabel create, update and remove', async () => {
    const { hookId, scope } = await setup();
    const created = (await scope.labels.post({ name: 'bug', color: '#ff0000' })).data!;
    await Bun.sleep(5);
    await scope.labels({ labelId: created.id }).patch({ name: 'defect' });
    await scope.labels({ labelId: created.id }).delete();
    const [c, u, r] = await payloads(hookId);
    expect(c).toMatchObject({
      action: 'create',
      type: 'IssueLabel',
      data: { id: created.id, name: 'bug', color: '#ff0000', isGroup: false, parentId: null },
    });
    expect(u).toMatchObject({
      action: 'update',
      data: { name: 'defect' },
      updatedFrom: { name: 'bug' },
    });
    expect(new Date(u!.data.updatedAt as string).getTime()).toBeGreaterThan(
      new Date(u!.updatedFrom!.updatedAt as string).getTime(),
    );
    expect(r).toMatchObject({ action: 'remove', data: { id: created.id, name: 'defect' } });
  });

  it('sends a label group as an IssueLabel with isGroup', async () => {
    const { hookId, scope } = await setup();
    const group = (await scope['label-groups'].post({ name: 'Area' })).data!;
    const inGroup = (await scope.labels.post({ name: 'api', groupId: group.id })).data!;
    const [g, l] = await payloads(hookId);
    expect(g).toMatchObject({
      action: 'create',
      data: { id: group.id, name: 'Area', isGroup: true },
    });
    expect(l).toMatchObject({ data: { id: inGroup.id, parentId: group.id } });
  });

  it('deleting a group sends an update for each label it held, then the group remove', async () => {
    const { hookId, scope } = await setup();
    const group = (await scope['label-groups'].post({ name: 'Area' })).data!;
    const a = (await scope.labels.post({ name: 'a', groupId: group.id })).data!;
    const b = (await scope.labels.post({ name: 'b', groupId: group.id })).data!;
    await scope['label-groups']({ groupId: group.id }).delete();
    const after = (await payloads(hookId)).slice(3);
    const updates = after.filter((p) => p.action === 'update');
    expect(updates.map((p) => p.data.id).sort()).toEqual([a.id, b.id].sort());
    for (const p of updates) expect(p.updatedFrom).toMatchObject({ parentId: group.id });
    expect(after[after.length - 1]).toMatchObject({ action: 'remove', data: { id: group.id } });
  });

  it('does not send IssueLabel events when an issue’s labels change', async () => {
    const { asOwner, team, hookId, scope } = await setup();
    const l = (await scope.labels.post({ name: 'bug' })).data!;
    const issue = (await scope.issues.post({ stateId: team.states[0].id, title: 'x' })).data!;
    await asOwner.issues({ issueId: issue.id }).patch({ labelIds: [l.id] });
    expect((await payloads(hookId)).map((p) => p.action)).toEqual(['create']);
  });
});
