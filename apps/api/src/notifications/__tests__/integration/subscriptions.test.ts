import { beforeEach, describe, expect, it } from 'bun:test';
import { db, notification } from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { subscribe, subscriberIds, unsubscribe } from '../../subscriptions';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';

// Issue subscriptions: who is subscribed automatically, who is notified of comments
// and status changes, re-subscription after unsubscribing, archived notifications
// in the REST inbox, and subscriberIds in the Issue webhook.

interface Member {
  api: Api;
  userId: string;
}

async function setup() {
  const u = await signUpTestUser({ name: 'Owner' });
  const api = authedApi(u.cookie);
  await api.teams.post({ key: 'MKT', name: 'Marketing' });
  const view = (await api.teams({ teamKey: 'MKT' }).get()).data!;
  const done = view.states.find((s) => s.stateType === 'completed')!;
  return { owner: { api, userId: u.userId }, stateId: view.states[0]!.id, doneId: done.id };
}

async function addMember(owner: Member): Promise<Member> {
  const u = await signUpTestUser();
  await owner.api.teams({ teamKey: 'MKT' }).members.post({ userId: u.userId });
  const api = authedApi(u.cookie);
  return { api, userId: u.userId };
}

const newIssue = async (m: Member, stateId: string, patch: Record<string, unknown> = {}) =>
  (await m.api.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Task', ...patch })).data!
    .id;

const comment = (m: Member, issueId: string, body: string) =>
  m.api.issues({ issueId }).comments.post({ body } as never);

const inbox = async (m: Member) =>
  (await m.api.notifications.get({ query: {} })).data!.items.map((n) => n.type);

describe('issue subscriptions', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('subscribes the creator and the assignee of a new issue', async () => {
    const { owner, stateId } = await setup();
    const b = await addMember(owner);
    const issueId = await newIssue(owner, stateId, { assigneeUserId: b.userId });
    expect((await subscriberIds(issueId)).sort()).toEqual([owner.userId, b.userId].sort());
  });

  it('subscribes a commenter and mentioned members', async () => {
    const { owner, stateId } = await setup();
    const b = await addMember(owner);
    const c = await addMember(owner);
    const issueId = await newIssue(owner, stateId);
    await comment(b, issueId, `cc @[C](user:${c.userId})`);
    expect((await subscriberIds(issueId)).sort()).toEqual(
      [owner.userId, b.userId, c.userId].sort(),
    );
  });

  it('notifies subscribers of comments and status changes, never the actor', async () => {
    const { owner, stateId, doneId } = await setup();
    const b = await addMember(owner);
    const issueId = await newIssue(owner, stateId);
    await subscribe(issueId, [b.userId]);
    await comment(owner, issueId, 'update');
    expect(await inbox(b)).toEqual(['commented']);
    await b.api.issues({ issueId }).patch({ stateId: doneId } as never);
    expect(await inbox(owner)).toEqual(['state_changed']);
    expect(await inbox(b)).toEqual(['commented']);
  });

  it('re-subscribes after unsubscribing and commenting', async () => {
    const { owner, stateId } = await setup();
    const b = await addMember(owner);
    const issueId = await newIssue(owner, stateId);
    await comment(b, issueId, 'first');
    await unsubscribe(issueId, b.userId);
    await comment(owner, issueId, 'not for b');
    expect(await inbox(b)).toEqual([]);
    await comment(b, issueId, 'back');
    await comment(owner, issueId, 'for b');
    expect(await inbox(b)).toEqual(['commented']);
  });

  it('does not subscribe non-members', async () => {
    const { owner, stateId } = await setup();
    const outsider = await signUpTestUser();
    const issueId = await newIssue(owner, stateId);
    await subscribe(issueId, [outsider.userId]);
    expect(await subscriberIds(issueId)).toEqual([owner.userId]);
  });

  it('hides archived notifications from the REST inbox and unread count', async () => {
    const { owner, stateId } = await setup();
    const b = await addMember(owner);
    await newIssue(owner, stateId, { assigneeUserId: b.userId });
    const [n] = (await b.api.notifications.get({ query: {} })).data!.items;
    await db.update(notification).set({ archivedAt: new Date() }).where(eq(notification.id, n!.id));
    expect(await inbox(b)).toEqual([]);
    expect((await b.api.notifications.get({ query: {} })).data!.unread).toBe(0);
  });

  it('sends subscriberIds in the Issue webhook', async () => {
    const { owner, stateId } = await setup();
    const b = await addMember(owner);
    const hook = (
      await owner.api
        .teams({ teamKey: 'MKT' })
        .webhooks.post({ url: 'https://example.com/h', resourceTypes: ['Issue'] })
    ).data!;
    const issueId = await newIssue(owner, stateId, { assigneeUserId: b.userId });
    const items = (await webhookDeliveries(hook.id)).data!.items;
    const created = items.find((d) => (d.payload as { action: string }).action === 'create')!;
    const data = (created.payload as { data: { id: string; subscriberIds: string[] } }).data;
    expect(data.id).toBe(issueId);
    expect([...data.subscriberIds].sort()).toEqual([owner.userId, b.userId].sort());
  });
});
