import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';
import {
  type As,
  addMember,
  archiveIssue,
  createIssue,
  createTeam,
  removeMember,
  statesByType,
  teamView,
} from '../../../__tests__/helpers/graphql';

// Reading issues over the Linear API: the SDK's full Issue fragment, lookups by
// id and identifier, filters, archived issues, search, and access.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const col = statesByType(await teamView(owner, 'MKT'));
  const client = linearClient(await createApiKey(owner.cookie));
  return { owner, col, client };
}

function create(as: As, stateId: string, body: Record<string, unknown> = {}) {
  const { assigneeUserId, ...rest } = body;
  return createIssue(as, {
    teamId: 'MKT',
    stateId,
    ...rest,
    ...(assigneeUserId ? { assigneeId: assigneeUserId } : {}),
  });
}

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

describe('graphql issue queries', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('returns the full SDK issue fragment matching REST', async () => {
    const { owner, col, client } = await setup();
    const parent = await create(owner, col.backlog, { title: 'Parent' });
    const rest = await create(owner, col.started, {
      title: 'Ship docs',
      priority: 2,
      estimate: 3,
      parentId: parent.id,
      dueDate: '2026-12-01',
    });

    const issue = await client.issue(rest.id);
    expect(issue.id).toBe(rest.id);
    expect(issue.identifier).toBe(rest.identifier);
    expect(issue.number).toBe(rest.sequenceNumber);
    expect(issue.title).toBe('Ship docs');
    expect(issue.priority).toBe(2);
    expect(issue.priorityLabel).toBe('High');
    expect(issue.estimate).toBe(3);
    expect(issue.startedAt).toBeTruthy();
    expect(issue.url).toContain(`/team/MKT/issue/${rest.sequenceNumber}`);
    expect(issue.branchName).toMatch(/^mkt-\d+-ship-docs$/);
    expect((await issue.state)?.id).toBe(col.started);
    expect((await issue.team)?.key).toBe('MKT');
    expect((await issue.parent)?.id).toBe(parent.id);
    expect((await issue.creator)?.name).toBe('Owner');
    expect(issue.trashed).toBe(false);
  });

  it('reads an issue by identifier, case-insensitively', async () => {
    const { owner, col, client } = await setup();
    const rest = await create(owner, col.backlog);
    expect((await client.issue(rest.identifier)).id).toBe(rest.id);
    expect((await client.issue(rest.identifier.toLowerCase())).id).toBe(rest.id);
  });

  it('answers ENTITY_NOT_FOUND for a malformed id', async () => {
    const { owner } = await setup();
    const res = await gql({ cookie: owner.cookie }, '{ issue(id: "abc") { id } }');
    expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
  });

  it("hides another team's issue", async () => {
    const { owner } = await setup();
    const other = await signUpTestUser();
    await createTeam(other, { key: 'OPS', name: 'Operations', visibility: 'private' });
    const hidden = await createIssue(other, { teamId: 'OPS', title: 'Secret' });
    const res = await gql({ cookie: owner.cookie }, `{ issue(id: "${hidden.id}") { id } }`);
    expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
    const list = await gql({ cookie: owner.cookie }, '{ issues { nodes { id } } }');
    expect(list.body.data).toEqual({ issues: { nodes: [] } });
  });

  it('filters by state type, assignee isMe, priority and or', async () => {
    const { owner, col, client } = await setup();
    const mine = await create(owner, col.started, { assigneeUserId: owner.userId, priority: 1 });
    const urgentBacklog = await create(owner, col.backlog, { priority: 1 });
    const low = await create(owner, col.backlog, { priority: 4 });

    const started = await client.issues({ filter: { state: { type: { eq: 'started' } } } });
    expect(started.nodes.map((i) => i.id)).toEqual([mine.id]);

    const assigned = await client.issues({ filter: { assignee: { isMe: { eq: true } } } });
    expect(assigned.nodes.map((i) => i.id)).toEqual([mine.id]);

    const urgent = await client.issues({ filter: { priority: { lte: 2, gte: 1 } } });
    expect(urgent.nodes.map((i) => i.id).sort()).toEqual([mine.id, urgentBacklog.id].sort());

    const either = await client.issues({
      filter: { or: [{ priority: { eq: 4 } }, { state: { type: { eq: 'started' } } }] },
    });
    expect(either.nodes.map((i) => i.id).sort()).toEqual([mine.id, low.id].sort());
  });

  it('rejects a filter key that is not supported, naming it', async () => {
    const { owner } = await setup();
    const res = await gql(
      { cookie: owner.cookie },
      '{ issues(filter: { comments: { some: { body: { eq: "x" } } } }) { nodes { id } } }',
    );
    expect(errorCode(res)).toBe('INVALID_INPUT');
    expect(res.body.errors?.[0].message).toContain('comments');
  });

  it('lists an archived issue only with includeArchived', async () => {
    const { owner, col, client } = await setup();
    const issue = await create(owner, col.backlog);
    await archiveIssue(owner, issue.id);
    expect((await client.issues()).nodes).toHaveLength(0);
    const all = await client.issues({ includeArchived: true });
    expect(all.nodes.map((i) => i.id)).toEqual([issue.id]);
    expect(all.nodes[0].archivedAt).toBeTruthy();
  });

  it("lists a team's, a state's, a parent's and a user's issues", async () => {
    const { owner, col, client } = await setup();
    const parent = await create(owner, col.started, { assigneeUserId: owner.userId });
    const child = await create(owner, col.backlog, { parentId: parent.id });

    const team = await client.team('MKT');
    expect((await team.issues()).nodes).toHaveLength(2);
    const state = await client.workflowState(col.backlog);
    expect((await state.issues()).nodes.map((i) => i.id)).toEqual([child.id]);
    const p = await client.issue(parent.id);
    expect((await p.children()).nodes.map((i) => i.id)).toEqual([child.id]);
    const me = await client.viewer;
    expect((await me.assignedIssues()).nodes.map((i) => i.id)).toEqual([parent.id]);
  });

  it('finds issues by search term', async () => {
    const { owner, col, client } = await setup();
    const hit = await create(owner, col.backlog, { title: 'Fix login redirect' });
    await create(owner, col.backlog, { title: 'Unrelated' });
    const res = await client.searchIssues('login');
    expect(res.nodes.map((i) => i.id)).toEqual([hit.id]);
  });

  it('scopes a search to a team given by key and counts every match', async () => {
    const { owner, col, client } = await setup();
    await create(owner, col.backlog, { title: 'login one' });
    await create(owner, col.backlog, { title: 'login two' });
    const res = await client.searchIssues('login', { teamId: 'MKT', first: 1 });
    expect(res.nodes).toHaveLength(1);
    expect(res.totalCount).toBe(2);
    const none = await client.searchIssues('login', { teamId: 'NOPE' });
    expect(none.nodes).toHaveLength(0);
  });

  it('keeps the creator visible after they leave the team', async () => {
    const { owner, col } = await setup();
    const member = await signUpTestUser({ name: 'Leaver' });
    await addMember(owner, 'MKT', member.userId);
    const created = await create(member, col.backlog, {
      assigneeUserId: member.userId,
    });
    const membership = (await teamView(owner, 'MKT')).members.find(
      (m) => m.userId === member.userId,
    )!;
    await removeMember(owner, membership.id);

    const res = await gql(
      { cookie: owner.cookie },
      `{ issue(id: "${created.id}") { creator { id } assignee { id } } }`,
    );
    // Workspace members see every workspace user, so the creator stays visible.
    expect(res.body.data).toEqual({
      issue: { creator: { id: member.userId }, assignee: { id: member.userId } },
    });
  });

  it('accepts first: 250 and rejects first: 251', async () => {
    const { owner } = await setup();
    const ok = await gql({ cookie: owner.cookie }, '{ issues(first: 250) { nodes { id } } }');
    expect(ok.body.errors).toBeUndefined();
    const bad = await gql({ cookie: owner.cookie }, '{ issues(first: 251) { nodes { id } } }');
    expect(errorCode(bad)).toBe('INVALID_INPUT');
  });
});
