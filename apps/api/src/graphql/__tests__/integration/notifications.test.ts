import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';

// Notifications over the Linear API: the viewer's inbox as IssueNotifications with
// Linear's type and category names, read / snooze / archive, bulk actions, the
// filter, other users' notifications and teams the viewer left.

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;
const errorMessage = (res: { body: { errors?: { message?: string }[] } }) =>
  res.body.errors?.[0]?.message ?? '';

interface Member {
  api: Api;
  userId: string;
  cookie: string;
}

async function setup() {
  const o = await signUpTestUser({ name: 'Owner' });
  const owner: Member = { api: authedApi(o.cookie), userId: o.userId, cookie: o.cookie };
  await owner.api.teams.post({ key: 'MKT', name: 'Marketing' });
  const stateId = (await owner.api.teams({ teamKey: 'MKT' }).get()).data!.states[0]!.id;
  const u = await signUpTestUser({ name: 'Bea' });
  await owner.api.teams({ teamKey: 'MKT' }).members.post({ userId: u.userId });
  const b: Member = { api: authedApi(u.cookie), userId: u.userId, cookie: u.cookie };
  const client = linearClient(await createApiKey(u.cookie));
  const newIssue = async (patch: Record<string, unknown> = {}) =>
    (await owner.api.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Task', ...patch }))
      .data!.id;
  return { owner, b, client, newIssue };
}

const comment = (m: Member, issueId: string, body: string) =>
  m.api.issues({ issueId }).comments.post({ body } as never);

describe('graphql notifications', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists the viewer's notifications with Linear's types", async () => {
    const { owner, b, newIssue } = await setup();
    const issueId = await newIssue({ assigneeUserId: b.userId });
    const res = await gql(
      { cookie: b.cookie },
      `{ notifications { nodes { __typename id type category readAt
          ... on IssueNotification { issueId issue { id } actor { id } user { id } team { key } } } } }`,
    );
    expect(res.body.errors).toBeUndefined();
    expect((res.body.data as { notifications: { nodes: unknown[] } }).notifications.nodes).toEqual([
      expect.objectContaining({
        __typename: 'IssueNotification',
        type: 'issueAssignedToYou',
        category: 'assignments',
        readAt: null,
        issueId,
        issue: { id: issueId },
        actor: { id: owner.userId },
        user: { id: b.userId },
        team: { key: 'MKT' },
      }),
    ]);
  });

  it('marks read, snoozes and archives', async () => {
    const { b, client, newIssue } = await setup();
    await newIssue({ assigneeUserId: b.userId });
    const [n] = (await client.notifications()).nodes;
    const run = async (mutation: string) => {
      const res = await gql({ cookie: b.cookie }, `mutation { ${mutation} }`);
      expect(res.body.errors).toBeUndefined();
      return res.body.data as Record<string, Record<string, Record<string, string | null>>>;
    };
    const read = await run(
      `notificationUpdate(id: "${n!.id}", input: { readAt: "2026-11-01T00:00:00.000Z" }) { notification { readAt } }`,
    );
    expect(read.notificationUpdate!.notification!.readAt).toBe('2026-11-01T00:00:00.000Z');
    const snoozed = await run(
      `notificationUpdate(id: "${n!.id}", input: { snoozedUntilAt: "2030-01-01T00:00:00.000Z" }) { notification { snoozedUntilAt } }`,
    );
    expect(snoozed.notificationUpdate!.notification!.snoozedUntilAt).toBe(
      '2030-01-01T00:00:00.000Z',
    );
    const archived = await run(`notificationArchive(id: "${n!.id}") { entity { archivedAt } }`);
    expect(archived.notificationArchive!.entity!.archivedAt).toBeTruthy();
    expect((await client.notifications()).nodes).toHaveLength(0);
    expect((await client.notifications({ includeArchived: true })).nodes).toHaveLength(1);
    expect((await client.notification(n!.id)).id).toBe(n!.id);
    await client.unarchiveNotification(n!.id);
    expect((await client.notifications()).nodes).toHaveLength(1);
  });

  it('bulk actions by issue and by id', async () => {
    const { owner, b, client, newIssue } = await setup();
    const x = await newIssue({ assigneeUserId: b.userId });
    await comment(owner, x, 'on x');
    const y = await newIssue({ assigneeUserId: b.userId });
    const result = await client.notificationMarkReadAll({ issueId: x }, new Date());
    expect(result.success).toBe(true);
    const nodes = (await client.notifications()).nodes as unknown as {
      id: string;
      readAt?: Date;
      issueId: string;
    }[];
    expect(nodes.filter((n) => n.issueId === x).every((n) => n.readAt)).toBe(true);
    expect(nodes.filter((n) => n.issueId === y).every((n) => !n.readAt)).toBe(true);
    const onY = nodes.find((n) => n.issueId === y)!;
    await client.notificationArchiveAll({ id: onY.id });
    expect((await client.notifications()).nodes.map((n) => n.id)).not.toContain(onY.id);
  });

  it('filters notifications', async () => {
    const { owner, b, newIssue } = await setup();
    const issueId = await newIssue({ assigneeUserId: b.userId });
    await comment(owner, issueId, 'hello');
    const res = await gql(
      { cookie: b.cookie },
      '{ notifications(filter: { type: { eq: "issueNewComment" } }) { nodes { type } } }',
    );
    expect((res.body.data as { notifications: { nodes: unknown[] } }).notifications.nodes).toEqual([
      { type: 'issueNewComment' },
    ]);
  });

  it("hides other users' notifications", async () => {
    const { owner, b, newIssue } = await setup();
    await newIssue({ assigneeUserId: b.userId });
    const [n] = (await b.api.notifications.get({ query: {} })).data!.items;
    for (const q of [
      `{ notification(id: "${n!.id}") { id } }`,
      `mutation { notificationUpdate(id: "${n!.id}", input: { readAt: "2026-01-01T00:00:00Z" }) { success } }`,
      `mutation { notificationArchive(id: "${n!.id}") { success } }`,
    ])
      expect(errorCode(await gql({ cookie: owner.cookie }, q))).toBe('ENTITY_NOT_FOUND');
  });

  it('omits notifications from teams the viewer left', async () => {
    const { owner, b, newIssue } = await setup();
    await owner.api.teams({ teamKey: 'MKT' }).patch({ visibility: 'private' });
    await newIssue({ assigneeUserId: b.userId });
    await owner.api.teams({ teamKey: 'MKT' }).members({ userId: b.userId }).delete();
    const res = await gql(
      { cookie: b.cookie },
      '{ notifications { nodes { id ... on IssueNotification { issue { id } } } } }',
    );
    expect(res.body.errors).toBeUndefined();
    expect((res.body.data as { notifications: { nodes: unknown[] } }).notifications.nodes).toEqual(
      [],
    );
  });

  it('rejects unsupported input', async () => {
    const { b, newIssue } = await setup();
    await newIssue({ assigneeUserId: b.userId });
    const [n] = (await b.api.notifications.get({ query: {} })).data!.items;
    const update = await gql(
      { cookie: b.cookie },
      `mutation { notificationUpdate(id: "${n!.id}", input: { projectUpdateId: "${n!.id}" }) { success } }`,
    );
    expect(errorCode(update)).toBe('INVALID_INPUT');
    expect(errorMessage(update)).toContain('projectUpdateId');
    const all = await gql(
      { cookie: b.cookie },
      `mutation { notificationArchiveAll(input: { projectId: "${n!.id}" }) { success } }`,
    );
    expect(errorCode(all)).toBe('INVALID_INPUT');
    expect(errorMessage(all)).toContain('projectId');
  });

  it('bumps updatedAt when the web inbox marks a notification read', async () => {
    const { b, newIssue } = await setup();
    await newIssue({ assigneeUserId: b.userId });
    const read = async () =>
      (
        (await gql({ cookie: b.cookie }, '{ notifications { nodes { id updatedAt } } }')).body
          .data as { notifications: { nodes: { id: string; updatedAt: string }[] } }
      ).notifications.nodes[0]!;
    const before = await read();
    await new Promise((r) => setTimeout(r, 5));
    await b.api.notifications({ id: before.id }).read.post({ read: true });
    expect(new Date((await read()).updatedAt).getTime()).toBeGreaterThan(
      new Date(before.updatedAt).getTime(),
    );
  });

  it('returns only the notifications a bulk action changed', async () => {
    const { owner, b, newIssue } = await setup();
    const x = await newIssue({ assigneeUserId: b.userId });
    await comment(owner, x, 'on x');
    const [first] = (await b.api.notifications.get({ query: {} })).data!.items;
    await b.api.notifications({ id: first!.id }).read.post({ read: true });
    const res = await gql(
      { cookie: b.cookie },
      `mutation { notificationMarkUnreadAll(input: { issueId: "${x}" }) { notifications { id } } }`,
    );
    const ids = (
      res.body.data as { notificationMarkUnreadAll: { notifications: { id: string }[] } }
    ).notificationMarkUnreadAll.notifications.map((n) => n.id);
    expect(ids).toEqual([first!.id]);
  });
});
