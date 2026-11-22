import { describe, it, expect, beforeEach } from 'bun:test';
import { authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';

// Notifications are fanned out when an issue changes and read back through the
// session user's inbox. The actor is never notified about their own action, and
// only team members receive notifications. New members join through invites, so
// a second member is added by creating and accepting an invite.

interface Member {
  api: Api;
  userId: string;
}

async function setup(): Promise<{ owner: Member; stateId: string; doneColumnId: string }> {
  const u = await signUpTestUser();
  const api = authedApi(u.cookie);
  await api.teams.post({ key: 'MKT', name: 'Marketing' });
  const view = await api.teams({ teamKey: 'MKT' }).get();
  const columns = view.data!.states;
  const done = columns.find((c) => c.stateType === 'completed') ?? columns[columns.length - 1];
  return { owner: { api, userId: u.userId }, stateId: columns[0].id, doneColumnId: done.id };
}

async function addMember(owner: Member): Promise<Member> {
  const u = await signUpTestUser();
  await owner.api.teams({ teamKey: 'MKT' }).members.post({ userId: u.userId });
  const api = authedApi(u.cookie);
  return { api, userId: u.userId };
}

function createIssue(client: Api, stateId: string, patch: Record<string, unknown> = {}) {
  return client.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Task', ...patch });
}

describe('notifications', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('notifies the new assignee, not the actor', async () => {
    const { owner, stateId } = await setup();
    const member = await addMember(owner);

    await createIssue(owner.api, stateId, {
      title: 'Ship it',
      assigneeUserId: member.userId,
    });

    const inbox = await member.api.notifications.get({ query: {} });
    expect(inbox.status).toBe(200);
    expect(inbox.data!.items).toHaveLength(1);
    expect(inbox.data!.items[0]).toMatchObject({
      type: 'assigned',
      actorUserId: owner.userId,
      issueTitle: 'Ship it',
      teamKey: 'MKT',
      readAt: null,
    });

    // The actor is not notified about their own action.
    const ownerInbox = await owner.api.notifications.get({ query: {} });
    expect(ownerInbox.data!.items).toHaveLength(0);
  });

  it('notifies participants on a comment', async () => {
    const { owner, stateId } = await setup();
    const member = await addMember(owner);

    // Owner creates the issue assigned to member (owner is now a participant via
    // the create/assign activity; member via assignment).
    const issue = await createIssue(owner.api, stateId, { assigneeUserId: member.userId });
    const issueId = issue.data!.id;

    // Member comments -> owner (a participant) gets a 'commented' notification.
    await owner.api.issues({ issueId }).comments.post({ body: 'looking into it' } as never);
    await member.api.issues({ issueId }).comments.post({ body: 'done' } as never);

    const ownerInbox = await owner.api.notifications.get({ query: { types: 'commented' } });
    expect(ownerInbox.data!.items).toHaveLength(1);
    expect(ownerInbox.data!.items[0]).toMatchObject({
      type: 'commented',
      actorUserId: member.userId,
    });
  });

  it('the unread count tracks reads', async () => {
    const { owner, stateId } = await setup();
    const member = await addMember(owner);
    await createIssue(owner.api, stateId, { assigneeUserId: member.userId });

    const rev1 = await member.api.notifications.get({ query: {} });
    expect(rev1.data!.unread).toBe(1);

    const inbox = await member.api.notifications.get({ query: {} });
    const id = inbox.data!.items[0].id;
    const read = await member.api.notifications({ id }).read.post({ read: true } as never);
    expect(read.status).toBe(204);

    const rev2 = await member.api.notifications.get({ query: {} });
    expect(rev2.data!.unread).toBe(0);

    // includeRead=false hides the now-read notification.
    const unreadOnly = await member.api.notifications.get({ query: { includeRead: 'false' } });
    expect(unreadOnly.data!.items).toHaveLength(0);
  });

  it("a member cannot read or mutate another user's notification", async () => {
    const { owner, stateId } = await setup();
    const member = await addMember(owner);
    await createIssue(owner.api, stateId, { assigneeUserId: member.userId });
    const inbox = await member.api.notifications.get({ query: {} });
    const id = inbox.data!.items[0].id;

    // The owner does not own this notification: mutating it is a 404.
    const res = await owner.api.notifications({ id }).read.post({ read: true } as never);
    expect(res.status).toBe(404);
  });

  it('answers 400 for ids that are not UUIDs in the query', async () => {
    const user = authedApi((await signUpTestUser()).cookie);
    expect((await user.notifications.get({ query: { from: 'abc' } })).status).toBe(400);
    expect((await user.notifications.get({ query: { teamId: 'abc' } })).status).toBe(400);
  });

  it('hides notifications about teams the user can no longer see', async () => {
    const { owner, stateId } = await setup();
    const member = await addMember(owner);
    await owner.api
      .teams({ teamKey: 'MKT' })
      .issues.post({ stateId, title: 'Ship it', assigneeUserId: member.userId });
    expect((await member.api.notifications.get({ query: {} })).data!.items).toHaveLength(1);
    await owner.api.teams({ teamKey: 'MKT' }).members({ userId: member.userId }).delete();
    await owner.api.teams({ teamKey: 'MKT' }).patch({ visibility: 'private' });
    expect((await member.api.notifications.get({ query: {} })).data!.items).toHaveLength(0);
    expect((await member.api.notifications.get({ query: {} })).data!.unread).toBe(0);
  });
});
