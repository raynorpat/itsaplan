import { describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gql } from '../../../__tests__/helpers/linear';
import { addMember, createTeam, teamView } from '../../../__tests__/helpers/graphql';
import { countStatements } from '../../../__tests__/helpers/statements';

// Per-row fields of a list resolve through request-scoped loaders, so a list query
// makes the same number of SQL statements for 5 rows as for 50.

async function setup(count: number) {
  const owner = await signUpTestUser({ name: 'Owner' });
  const h = { cookie: owner.cookie };
  const run = async (query: string, variables?: Record<string, unknown>) => {
    const res = await gql(h, query, variables);
    if (res.body.errors) throw new Error(JSON.stringify(res.body.errors));
    return res.body.data as Record<string, Record<string, Record<string, unknown>>>;
  };
  const team = (
    await run('mutation { teamCreate(input: { name: "Marketing", key: "MKT" }) { team { id } } }')
  ).teamCreate!.team!.id as string;
  await run(
    'mutation($id: String!) { teamUpdate(id: $id, input: { cyclesEnabled: true }) { success } }',
    { id: team },
  );
  const cycles = (
    await run('query($id: String!) { team(id: $id) { cycles { nodes { id } } } }', { id: team })
  ).team!.cycles as unknown as { nodes: { id: string }[] };
  const cycleId = cycles.nodes[0]!.id;
  const labelId = (
    await run(
      'mutation($t: String!) { issueLabelCreate(input: { name: "Bug", teamId: $t }) { issueLabel { id } } }',
      { t: team },
    )
  ).issueLabelCreate!.issueLabel!.id as string;
  const projectId = (
    await run(
      'mutation($t: String!) { projectCreate(input: { name: "Site", teamIds: [$t] }) { project { id } } }',
      { t: team },
    )
  ).projectCreate!.project!.id as string;
  const parentId = (
    await run(
      'mutation($t: String!) { issueCreate(input: { teamId: $t, title: "Parent" }) { issue { id } } }',
      { t: team },
    )
  ).issueCreate!.issue!.id as string;
  const states = (
    await run('query($id: String!) { team(id: $id) { states { nodes { id } } } }', { id: team })
  ).team!.states as unknown as { nodes: { id: string }[] };
  for (let i = 0; i < count; i++) {
    await run(
      `mutation($t: String!, $u: String!, $l: String!, $p: String!, $c: String!, $parent: String!) {
        issueCreate(input: { teamId: $t, title: "Issue ${i}", assigneeId: $u, labelIds: [$l],
          projectId: $p, cycleId: $c, parentId: $parent }) { issue { id } } }`,
      { t: team, u: owner.userId, l: labelId, p: projectId, c: cycleId, parent: parentId },
    );
    // History entries and comments with reactions on the parent.
    await run(
      'mutation($id: String!, $s: String!, $u: String!, $p: String!, $c: String!) { issueUpdate(id: $id, input: { stateId: $s, assigneeId: $u, projectId: $p, cycleId: $c }) { success } }',
      { id: parentId, s: states.nodes[i % 2]!.id, u: owner.userId, p: projectId, c: cycleId },
    );
    await run(
      'mutation($id: String!, $u: String) { issueUpdate(id: $id, input: { assigneeId: $u }) { success } }',
      {
        id: parentId,
        u: null,
      },
    );
    const commentId = (
      await run(
        'mutation($id: String!) { commentCreate(input: { issueId: $id, body: "Hi" }) { comment { id } } }',
        { id: parentId },
      )
    ).commentCreate!.comment!.id as string;
    await run(
      'mutation($id: String!) { reactionCreate(input: { commentId: $id, emoji: "👍" }) { success } }',
      { id: commentId },
    );
  }
  return { cookie: owner.cookie, teamId: team, parentId };
}

const ISSUES = `query($team: ID!) { issues(first: 100, filter: { team: { id: { eq: $team } } }) {
  nodes { id state { id } team { id } assignee { id } creator { id }
    labels { nodes { id } } labelIds project { id } projectMilestone { id } cycle { id }
    parent { id } reactions { id user { id } } } } }`;

const HISTORY = `query($id: String!) { issue(id: $id) { history(first: 250) { nodes {
  actor { id } fromState { id } toState { id } fromAssignee { id } toAssignee { id }
  toProject { id } toCycle { id } addedLabels { id } } } } }`;

const COMMENTS = `query($id: String!) { issue(id: $id) { comments(first: 250) { nodes {
  user { id } reactions { id user { id } } } } } }`;

async function measure(count: number) {
  await resetDb();
  const { cookie, teamId, parentId } = await setup(count);
  const counts: number[] = [];
  for (const [query, variables] of [
    [ISSUES, { team: teamId }],
    [HISTORY, { id: parentId }],
    [COMMENTS, { id: parentId }],
  ] as const) {
    let res: Awaited<ReturnType<typeof gql>> | undefined;
    counts.push(
      await countStatements(async () => {
        res = await gql({ cookie }, query, variables);
      }),
    );
    expect(res!.body.errors).toBeUndefined();
  }
  return counts;
}

const NOTIFICATIONS = `{ notifications(first: 100) { nodes { id actor { id }
  ... on IssueNotification { issue { id state { type } } team { id key } } } } }`;

// Notifications for a member: one per issue assigned to them by the owner.
async function measureNotifications(count: number) {
  await resetDb();
  const owner = await signUpTestUser({ name: 'Owner' });
  const member = await signUpTestUser({ name: 'Member' });
  await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  await addMember(owner, 'MKT', member.userId);
  const teamId = (await teamView(owner, 'MKT')).team.id;
  for (let i = 0; i < count; i++) {
    const res = await gql(
      { cookie: owner.cookie },
      'mutation($t: String!, $u: String!) { issueCreate(input: { teamId: $t, title: "x", assigneeId: $u }) { success } }',
      { t: teamId, u: member.userId },
    );
    expect(res.body.errors).toBeUndefined();
  }
  let res: Awaited<ReturnType<typeof gql>> | undefined;
  const n = await countStatements(async () => {
    res = await gql({ cookie: member.cookie }, NOTIFICATIONS);
  });
  expect(res!.body.errors).toBeUndefined();
  const nodes = (res!.body.data as { notifications: { nodes: unknown[] } }).notifications.nodes;
  expect(nodes).toHaveLength(count);
  return n;
}

describe('graphql batching', () => {
  it('makes a bounded number of statements for issue lists, history and comments', async () => {
    const small = await measure(5);
    const large = await measure(50);
    expect(large).toEqual(small);
  }, 120_000);

  it('gives each mutation field in one document fresh data', async () => {
    await resetDb();
    const owner = await signUpTestUser({ name: 'Owner' });
    const h = { cookie: owner.cookie };
    const one = async (query: string, variables?: Record<string, unknown>) => {
      const res = await gql(h, query, variables);
      if (res.body.errors) throw new Error(JSON.stringify(res.body.errors));
      return res.body.data as Record<string, Record<string, Record<string, unknown>>>;
    };
    const team = (
      await one('mutation { teamCreate(input: { name: "Marketing", key: "MKT" }) { team { id } } }')
    ).teamCreate!.team!.id as string;
    const label = async (name: string) =>
      (
        await one(
          'mutation($n: String!, $t: String!) { issueLabelCreate(input: { name: $n, teamId: $t }) { issueLabel { id } } }',
          { n: name, t: team },
        )
      ).issueLabelCreate!.issueLabel!.id as string;
    const x = await label('X');
    const y = await label('Y');
    const id = (
      await one(
        'mutation($t: String!) { issueCreate(input: { teamId: $t, title: "I" }) { issue { id } } }',
        { t: team },
      )
    ).issueCreate!.issue!.id as string;
    const data = await one(
      `mutation($id: String!, $x: String!, $y: String!) {
        a: issueUpdate(id: $id, input: { labelIds: [$x] }) { issue { labelIds } }
        b: issueUpdate(id: $id, input: { labelIds: [$y] }) { issue { labelIds } }
      }`,
      { id, x, y },
    );
    expect(data.a!.issue!.labelIds).toEqual([x]);
    expect(data.b!.issue!.labelIds).toEqual([y]);
  });

  it('makes a bounded number of statements for the notification list', async () => {
    expect(await measureNotifications(50)).toBe(await measureNotifications(5));
  }, 120_000);
});
