import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createComment,
  createIssue,
  createTeam,
  gqlData,
  statesByType,
} from '../../../__tests__/helpers/graphql';

// Notifications are fanned out when an issue changes and read back through the
// viewer's inbox. The actor is never notified about their own action, and only
// people who can see the team receive notifications.

async function setup() {
  const owner = await signUpTestUser();
  const view = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const member = await signUpTestUser();
  await addMember(owner, 'MKT', member.userId);
  const stateId = statesByType(view).backlog ?? view.states[0]!.id;
  const newIssue = async (input: Record<string, unknown> = {}) =>
    (await createIssue(owner, { teamId: 'MKT', stateId, title: 'Task', ...input })).id;
  return { owner, member, newIssue };
}

interface Row {
  id: string;
  type: string;
  readAt: string | null;
  actor: { id: string } | null;
  issue?: { title: string; team: { key: string } };
}

async function inbox(u: TestUser, filter?: Record<string, unknown>): Promise<Row[]> {
  const data = await gqlData(
    u,
    `query ($filter: NotificationFilter) { notifications(filter: $filter) { nodes {
      id type readAt actor { id }
      ... on IssueNotification { issue { title team { key } } } } } }`,
    { filter },
  );
  return data.notifications.nodes;
}

describe('notifications', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('notifies the new assignee', async () => {
    const { owner, member, newIssue } = await setup();
    await newIssue({ title: 'Ship it', assigneeId: member.userId });
    const rows = await inbox(member);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'issueAssignedToYou',
      actor: { id: owner.userId },
      readAt: null,
      issue: { title: 'Ship it', team: { key: 'MKT' } },
    });
  });

  it('does not notify the actor about their own action', async () => {
    const { owner, member, newIssue } = await setup();
    await newIssue({ assigneeId: member.userId });
    expect(await inbox(owner)).toHaveLength(0);
  });

  it('notifies participants on a comment, from the commenter', async () => {
    const { owner, member, newIssue } = await setup();
    const issueId = await newIssue({ assigneeId: member.userId });
    await createComment(owner, { issueId, body: 'looking into it' });
    await createComment(member, { issueId, body: 'done' });
    const rows = await inbox(owner, { type: { eq: 'issueNewComment' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'issueNewComment', actor: { id: member.userId } });
  });
});
