import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createComment,
  createIssue,
  createTeam,
  createWebhook,
  gqlData,
  statesByType,
  updateIssue,
} from '../../../__tests__/helpers/graphql';
import { subscribe, subscriberIds, unsubscribe } from '../../subscriptions';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';

// Issue subscriptions: who is subscribed automatically, who is notified of comments
// and status changes, re-subscription after unsubscribing, archived notifications
// in the inbox, and subscriberIds in the Issue webhook.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const view = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const states = statesByType(view);
  return { owner, stateId: view.states[0]!.id, doneId: states.completed! };
}

async function memberOf(owner: TestUser): Promise<TestUser> {
  const u = await signUpTestUser();
  await addMember(owner, 'MKT', u.userId);
  return u;
}

const newIssue = async (m: TestUser, stateId: string, input: Record<string, unknown> = {}) =>
  (await createIssue(m, { teamId: 'MKT', stateId, title: 'Task', ...input })).id;

const comment = (m: TestUser, issueId: string, body: string) => createComment(m, { issueId, body });

const inbox = async (m: TestUser): Promise<string[]> =>
  (await gqlData(m, '{ notifications { nodes { type } } }')).notifications.nodes.map(
    (n: { type: string }) => n.type,
  );

describe('issue subscriptions', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('subscribes the creator and the assignee of a new issue', async () => {
    const { owner, stateId } = await setup();
    const b = await memberOf(owner);
    const issueId = await newIssue(owner, stateId, { assigneeId: b.userId });
    expect((await subscriberIds(issueId)).sort()).toEqual([owner.userId, b.userId].sort());
  });

  it('subscribes a commenter and mentioned members', async () => {
    const { owner, stateId } = await setup();
    const b = await memberOf(owner);
    const c = await memberOf(owner);
    const issueId = await newIssue(owner, stateId);
    await comment(b, issueId, `cc @[C](user:${c.userId})`);
    expect((await subscriberIds(issueId)).sort()).toEqual(
      [owner.userId, b.userId, c.userId].sort(),
    );
  });

  it('notifies subscribers of comments and status changes, never the actor', async () => {
    const { owner, stateId, doneId } = await setup();
    const b = await memberOf(owner);
    const issueId = await newIssue(owner, stateId);
    await subscribe(issueId, [b.userId]);
    await comment(owner, issueId, 'update');
    expect(await inbox(b)).toEqual(['issueNewComment']);
    await updateIssue(b, issueId, { stateId: doneId });
    expect(await inbox(owner)).toEqual(['issueStatusChanged']);
    expect(await inbox(b)).toEqual(['issueNewComment']);
  });

  it('re-subscribes after unsubscribing and commenting', async () => {
    const { owner, stateId } = await setup();
    const b = await memberOf(owner);
    const issueId = await newIssue(owner, stateId);
    await comment(b, issueId, 'first');
    await unsubscribe(issueId, b.userId);
    await comment(owner, issueId, 'not for b');
    expect(await inbox(b)).toEqual([]);
    await comment(b, issueId, 'back');
    await comment(owner, issueId, 'for b');
    expect(await inbox(b)).toEqual(['issueNewComment']);
  });

  it('does not subscribe non-members', async () => {
    const { owner, stateId } = await setup();
    const outsider = await signUpTestUser();
    const issueId = await newIssue(owner, stateId);
    await subscribe(issueId, [outsider.userId]);
    expect(await subscriberIds(issueId)).toEqual([owner.userId]);
  });

  it('sends subscriberIds in the Issue webhook', async () => {
    const { owner, stateId } = await setup();
    const b = await memberOf(owner);
    const hook = await createWebhook(owner, {
      url: 'https://example.com/h',
      resourceTypes: ['Issue'],
      teamId: 'MKT',
    });
    const issueId = await newIssue(owner, stateId, { assigneeId: b.userId });
    const items = (await webhookDeliveries(hook.id)).data!.items;
    const created = items.find((d) => (d.payload as { action: string }).action === 'create')!;
    const data = (created.payload as { data: { id: string; subscriberIds: string[] } }).data;
    expect(data.id).toBe(issueId);
    expect([...data.subscriberIds].sort()).toEqual([owner.userId, b.userId].sort());
  });
});
