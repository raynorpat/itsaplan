import { beforeEach, describe, expect, it } from 'bun:test';
import { customerNeed, db, externalUser, notification } from '@repo/db';
import { eq } from 'drizzle-orm';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createIssue,
  createTeam,
  createWebhook,
  gqlData,
  makePrivate,
  signUpAs,
  teamView,
  type As,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { createRequesterAttachment } from '../../../feedback/store';

// Feedback as Linear's CustomerNeed: requesters (ExternalUser) through the source
// attachment, issue counts, filters and sorts, writes, guests and webhooks.

const headers = (as: As) => ('headers' in as ? as.headers : { cookie: as.cookie });
const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

async function requester(name: string, email: string | null = null) {
  const [row] = await db
    .insert(externalUser)
    .values({ name, displayName: name, email })
    .returning();
  return row!;
}

const NEED_FIELDS = `id body priority archivedAt createdAt
  issue { id } creator { id }
  attachment { id sourceType title subtitle groupBySource issue { id } externalUserCreator { id name email } }`;

async function createNeed(as: As, input: Record<string, unknown>) {
  const data = await gqlData(
    as,
    `mutation ($input: CustomerNeedCreateInput!) {
      customerNeedCreate(input: $input) { success need { ${NEED_FIELDS} } } }`,
    { input },
  );
  return data.customerNeedCreate.need;
}

async function needsOf(as: As, issueId: string) {
  const data = await gqlData(
    as,
    `query ($id: String!) { issue(id: $id) { needs(includeArchived: true) { nodes { ${NEED_FIELDS} } } } }`,
    { id: issueId },
  );
  return data.issue.needs.nodes;
}

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const view = await teamView(owner, 'MKT');
  const stateId = view.states[0]!.id;
  const a = await createIssue(owner, { teamId: 'MKT', stateId, title: 'Dark mode' });
  const b = await createIssue(owner, { teamId: 'MKT', stateId, title: 'Exports' });
  const jane = await requester('Jane Doe', 'jane@example.com');
  const sam = await requester('Sam');
  return { owner, stateId, a, b, jane, sam };
}

describe('graphql customer needs (feedback)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates feedback with its requester and lists it on the issue', async () => {
    const { owner, a, jane } = await setup();
    const { attachmentId } = await createRequesterAttachment(a.id, jane.id, 'team', owner.userId);
    const need = await createNeed(owner, {
      issueId: a.id,
      attachmentId,
      body: 'Please add dark mode',
      priority: 1,
    });
    expect(need).toMatchObject({
      body: 'Please add dark mode',
      priority: 1,
      issue: { id: a.id },
      creator: { id: owner.userId },
      attachment: {
        id: attachmentId,
        sourceType: 'feedback',
        title: 'Jane Doe',
        groupBySource: true,
        externalUserCreator: { id: jane.id, name: 'Jane Doe', email: 'jane@example.com' },
      },
    });
    expect((await needsOf(owner, a.id)).map((n: { id: string }) => n.id)).toEqual([need.id]);
    const one = await gqlData(owner, `query ($id: String) { customerNeed(id: $id) { id body } }`, {
      id: need.id,
    });
    expect(one.customerNeed).toEqual({ id: need.id, body: 'Please add dark mode' });
    const all = await gqlData(owner, `{ customerNeeds { nodes { id } } }`);
    expect(all.customerNeeds.nodes).toEqual([{ id: need.id }]);
  });

  it('counts distinct requesters on issues for filters and sorts', async () => {
    const { owner, a, b, jane, sam } = await setup();
    for (const [issueId, person, priority] of [
      [a.id, jane.id, 1],
      [a.id, jane.id, 0],
      [a.id, sam.id, 0],
      [b.id, sam.id, 0],
    ] as const) {
      const { attachmentId } = await createRequesterAttachment(
        issueId,
        person,
        'team',
        owner.userId,
      );
      await createNeed(owner, { issueId, attachmentId, priority });
    }
    // Feedback without a requester (an API client's) does not count as a person.
    await createNeed(owner, { issueId: b.id, body: 'anonymous' });

    const ids = async (query: string) =>
      (await gqlData(owner, query)).issues.nodes.map((n: { id: string }) => n.id);
    expect(await ids('{ issues(filter: { customerCount: { gte: 2 } }) { nodes { id } } }')).toEqual(
      [a.id],
    );
    expect(await ids('{ issues(filter: { customerCount: { eq: 1 } }) { nodes { id } } }')).toEqual([
      b.id,
    ]);
    expect(
      await ids('{ issues(filter: { customerImportantCount: { gte: 1 } }) { nodes { id } } }'),
    ).toEqual([a.id]);
    expect(
      await ids(
        '{ issues(filter: { needs: { some: { priority: { eq: 1 } } } }) { nodes { id } } }',
      ),
    ).toEqual([a.id]);
    // b is newer, so it comes first without the sort.
    expect(await ids('{ issues { nodes { id } } }')).toEqual([b.id, a.id]);
    expect(
      await ids('{ issues(sort: [{ customerCount: { order: Descending } }]) { nodes { id } } }'),
    ).toEqual([a.id, b.id]);
    expect(
      await ids('{ issues(sort: [{ customerCount: { order: Ascending } }]) { nodes { id } } }'),
    ).toEqual([b.id, a.id]);
    expect(
      await ids(
        '{ issues(sort: [{ customerImportantCount: { order: Descending } }]) { nodes { id } } }',
      ),
    ).toEqual([a.id, b.id]);
    // Paging through a sorted list keeps the order.
    const first = await gqlData(
      owner,
      '{ issues(first: 1, sort: [{ customerCount: { order: Descending } }]) { nodes { id } pageInfo { endCursor hasNextPage } } }',
    );
    expect(first.issues.nodes).toEqual([{ id: a.id }]);
    expect(first.issues.pageInfo.hasNextPage).toBe(true);
    const next = await gqlData(
      owner,
      `query ($after: String) { issues(first: 1, after: $after, sort: [{ customerCount: { order: Descending } }]) { nodes { id } } }`,
      { after: first.issues.pageInfo.endCursor },
    );
    expect(next.issues.nodes).toEqual([{ id: b.id }]);
  });

  it('updates, moves, archives, restores and deletes feedback', async () => {
    const { owner, a, b, jane } = await setup();
    const { attachmentId } = await createRequesterAttachment(a.id, jane.id, 'team', owner.userId);
    const need = await createNeed(owner, { issueId: a.id, attachmentId, body: 'v1' });

    const updated = await gqlData(
      owner,
      `mutation ($id: String!, $input: CustomerNeedUpdateInput!) {
        customerNeedUpdate(id: $id, input: $input) { success need { ${NEED_FIELDS} } } }`,
      { id: need.id, input: { body: 'v2', priority: 1, issueId: b.id } },
    );
    expect(updated.customerNeedUpdate.need).toMatchObject({
      body: 'v2',
      priority: 1,
      issue: { id: b.id },
      attachment: { issue: { id: b.id } },
    });
    expect(await needsOf(owner, a.id)).toEqual([]);

    const archived = await gqlData(
      owner,
      `mutation ($id: String!) { customerNeedArchive(id: $id) { success entity { id archivedAt } } }`,
      { id: need.id },
    );
    expect(archived.customerNeedArchive.entity.archivedAt).not.toBeNull();
    expect(
      (await gqlData(owner, '{ customerNeeds { nodes { id } } }')).customerNeeds.nodes,
    ).toEqual([]);
    const restored = await gqlData(
      owner,
      `mutation ($id: String!) { customerNeedUnarchive(id: $id) { success entity { archivedAt } } }`,
      { id: need.id },
    );
    expect(restored.customerNeedUnarchive.entity.archivedAt).toBeNull();

    const deleted = await gqlData(
      owner,
      `mutation ($id: String!) { customerNeedDelete(id: $id) { success entityId } }`,
      { id: need.id },
    );
    expect(deleted.customerNeedDelete).toEqual({ success: true, entityId: need.id });
    // Linear deletes the source attachment too, by default.
    const attachments = await gqlData(owner, `{ attachments { nodes { id } } }`);
    expect(attachments.attachments.nodes).toEqual([]);
  });

  it('refuses moving feedback to an issue the caller cannot see', async () => {
    const { owner, a, jane } = await setup();
    await createTeam(owner, { key: 'OPS', name: 'Ops' });
    await makePrivate(owner, 'OPS');
    const opsState = (await teamView(owner, 'OPS')).states[0]!.id;
    const hidden = await createIssue(owner, { teamId: 'OPS', stateId: opsState });
    const member = await signUpAs('member');
    const { attachmentId } = await createRequesterAttachment(a.id, jane.id, 'team', owner.userId);
    const need = await createNeed(member, { issueId: a.id, attachmentId, body: 'x' });
    const res = await gql(
      headers(member),
      `mutation ($id: String!, $input: CustomerNeedUpdateInput!) {
        customerNeedUpdate(id: $id, input: $input) { success } }`,
      { id: need.id, input: { issueId: hidden.id } },
    );
    expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
    expect((await needsOf(owner, a.id)).map((n: { id: string }) => n.id)).toEqual([need.id]);
  });

  it('deletes feedback with its issue', async () => {
    const { owner, a, jane } = await setup();
    const { attachmentId } = await createRequesterAttachment(a.id, jane.id, 'team', owner.userId);
    await createNeed(owner, { issueId: a.id, attachmentId });
    await gqlData(owner, `mutation ($id: String!) { issueDelete(id: $id) { success } }`, {
      id: a.id,
    });
    expect(await db.select().from(customerNeed)).toEqual([]);
  });

  it('shows guests counts only and refuses their writes', async () => {
    const { owner, a, jane } = await setup();
    const guest = await signUpAs('guest');
    await addMember(owner, 'MKT', guest.userId);
    const { attachmentId } = await createRequesterAttachment(a.id, jane.id, 'team', owner.userId);
    const need = await createNeed(owner, { issueId: a.id, attachmentId, body: 'secret quote' });

    expect(await needsOf(guest, a.id)).toEqual([]);
    const one = await gql(headers(guest), `query ($id: String) { customerNeed(id: $id) { id } }`, {
      id: need.id,
    });
    expect(errorCode(one)).toBe('ENTITY_NOT_FOUND');
    const att = await gqlData(
      guest,
      `query ($id: String!) { attachment(id: $id) { id externalUserCreator { id } } }`,
      { id: attachmentId },
    );
    expect(att.attachment.externalUserCreator).toBeNull();
    const counted = await gqlData(
      guest,
      '{ issues(filter: { customerCount: { gte: 1 } }) { nodes { id } } }',
    );
    expect(counted.issues.nodes).toEqual([{ id: a.id }]);
    expect(
      (await gqlData(guest, '{ customerNeeds { nodes { id } } }')).customerNeeds.nodes,
    ).toEqual([]);

    const created = await gql(
      headers(guest),
      `mutation ($input: CustomerNeedCreateInput!) { customerNeedCreate(input: $input) { success } }`,
      { input: { issueId: a.id, body: 'mine' } },
    );
    expect(errorCode(created)).toBe('FORBIDDEN');
  });

  it('sends no notification and runs no automation', async () => {
    const { owner, stateId, jane } = await setup();
    const member = await signUpAs('member');
    await addMember(owner, 'MKT', member.userId);
    const assigned = await createIssue(owner, {
      teamId: 'MKT',
      stateId,
      assigneeId: member.userId,
    });
    const before = await db
      .select()
      .from(notification)
      .where(eq(notification.userId, member.userId));
    const { attachmentId } = await createRequesterAttachment(
      assigned.id,
      jane.id,
      'team',
      owner.userId,
    );
    await createNeed(owner, { issueId: assigned.id, attachmentId, body: 'hi' });
    const after = await db
      .select()
      .from(notification)
      .where(eq(notification.userId, member.userId));
    expect(after.length).toBe(before.length);
  });

  it('sends CustomerNeed webhook events', async () => {
    const { owner, a, b, jane } = await setup();
    const hook = await createWebhook(owner, {
      url: 'https://example.com/hook',
      resourceTypes: ['CustomerNeed'],
      teamId: 'MKT',
    });
    const { attachmentId } = await createRequesterAttachment(a.id, jane.id, 'team', owner.userId);
    const need = await createNeed(owner, { issueId: a.id, attachmentId, body: 'v1' });
    await gqlData(
      owner,
      `mutation ($id: String!, $input: CustomerNeedUpdateInput!) {
        customerNeedUpdate(id: $id, input: $input) { success } }`,
      { id: need.id, input: { body: 'v2', issueId: b.id } },
    );
    await gqlData(owner, `mutation ($id: String!) { customerNeedDelete(id: $id) { success } }`, {
      id: need.id,
    });
    const items = (await webhookDeliveries(hook.id)).data.items.reverse();
    const events = items.map((d) => {
      const p = d.payload as {
        type: string;
        action: string;
        data: Record<string, unknown>;
        updatedFrom?: Record<string, unknown>;
      };
      return { type: p.type, action: p.action, data: p.data, updatedFrom: p.updatedFrom };
    });
    expect(events.map((e) => `${e.type}:${e.action}`)).toEqual([
      'CustomerNeed:create',
      'CustomerNeed:update',
      'CustomerNeed:remove',
    ]);
    expect(events[0]!.data).toMatchObject({
      id: need.id,
      issueId: a.id,
      attachmentId,
      body: 'v1',
      priority: 0,
      creatorId: owner.userId,
    });
    expect(events[1]!.updatedFrom).toMatchObject({ body: 'v1', issueId: a.id });
  });
});
