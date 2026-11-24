import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gql } from '../../../__tests__/helpers/linear';
import { db, issueActivity } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { createTeam, signUpAs } from '../../../__tests__/helpers/graphql';

// Issue and project history over the Linear API: typed history fields resolved by
// id, state spans, project history entries, the archivedAt filter, label batch
// edits, state reordering and team deletion.

type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function run(cookie: string, query: string): Promise<Data> {
  const res = await gql({ cookie }, query);
  if (res.body.errors) throw new Error(JSON.stringify(res.body.errors));
  return res.body.data as Data;
}

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const d = await run(
    owner.cookie,
    '{ teams { nodes { id key states { nodes { id name type position } } } } }',
  );
  const team = d.teams.nodes.find((t: Data) => t.key === 'MKT');
  const states: Data[] = team.states.nodes;
  const byType = (type: string) => states.find((s) => s.type === type)!;
  const createIssue = async (title = 'Task') =>
    (
      await run(
        owner.cookie,
        `mutation { issueCreate(input: { teamId: "${team.id}", title: "${title}", stateId: "${byType('unstarted').id}" }) { issue { id } } }`,
      )
    ).issueCreate.issue.id as string;
  return { owner, teamId: team.id as string, states, byType, createIssue };
}

const HISTORY = `history { nodes {
  actor { id } fromStateId toStateId fromState { id name } toState { id name }
  fromAssigneeId toAssigneeId fromPriority toPriority fromTitle toTitle
  addedLabelIds removedLabelIds addedLabels { id } fromProjectId toProjectId archived createdAt
} }`;

describe('graphql history', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('records typed history', async () => {
    const { owner, teamId, byType, createIssue } = await setup();
    const id = await createIssue();
    const label = (
      await run(
        owner.cookie,
        `mutation { issueLabelCreate(input: { name: "Bug", teamId: "${teamId}" }) { issueLabel { id } } }`,
      )
    ).issueLabelCreate.issueLabel.id;
    const project = (
      await run(
        owner.cookie,
        `mutation { projectCreate(input: { name: "Site", teamIds: ["${teamId}"] }) { project { id } } }`,
      )
    ).projectCreate.project.id;
    await run(
      owner.cookie,
      `mutation { issueUpdate(id: "${id}", input: { stateId: "${byType('started').id}", assigneeId: "${owner.userId}", priority: 2, title: "Renamed", labelIds: ["${label}"], projectId: "${project}" }) { success } }`,
    );
    const nodes: Data[] = (await run(owner.cookie, `{ issue(id: "${id}") { ${HISTORY} } }`)).issue
      .history.nodes;
    const find = (pred: (n: Data) => boolean) => nodes.find(pred);
    expect(find((n) => n.toStateId === byType('started').id)).toMatchObject({
      fromStateId: byType('unstarted').id,
      toState: { id: byType('started').id },
      actor: { id: owner.userId },
    });
    expect(find((n) => n.toAssigneeId === owner.userId)).toMatchObject({ fromAssigneeId: null });
    expect(find((n) => n.toPriority === 2)).toMatchObject({ fromPriority: 0 });
    expect(find((n) => n.toTitle === 'Renamed')).toMatchObject({ fromTitle: 'Task' });
    expect(find((n) => (n.addedLabelIds ?? []).includes(label))).toMatchObject({
      addedLabels: [{ id: label }],
    });
    expect(find((n) => n.toProjectId === project)).toMatchObject({ fromProjectId: null });
  });

  it('keeps state ids after a rename', async () => {
    const { owner, byType, createIssue } = await setup();
    const id = await createIssue();
    const from = byType('unstarted');
    await run(
      owner.cookie,
      `mutation { issueUpdate(id: "${id}", input: { stateId: "${byType('started').id}" }) { success } }`,
    );
    await run(
      owner.cookie,
      `mutation { workflowStateUpdate(id: "${from.id}", input: { name: "Waiting" }) { success } }`,
    );
    const nodes: Data[] = (await run(owner.cookie, `{ issue(id: "${id}") { ${HISTORY} } }`)).issue
      .history.nodes;
    const change = nodes.find((n) => n.toStateId === byType('started').id)!;
    expect(change.fromState).toEqual({ id: from.id, name: 'Waiting' });
  });

  it('builds state spans', async () => {
    const { owner, byType, createIssue } = await setup();
    const id = await createIssue();
    for (const type of ['started', 'completed'])
      await run(
        owner.cookie,
        `mutation { issueUpdate(id: "${id}", input: { stateId: "${byType(type).id}" }) { success } }`,
      );
    const spans: Data[] = (
      await run(
        owner.cookie,
        `{ issue(id: "${id}") { stateHistory { nodes { stateId state { id } startedAt endedAt } } } }`,
      )
    ).issue.stateHistory.nodes;
    expect(spans.map((s) => s.stateId)).toEqual([
      byType('unstarted').id,
      byType('started').id,
      byType('completed').id,
    ]);
    expect(spans[0]!.endedAt).toBeTruthy();
    expect(spans[2]!.endedAt).toBeNull();
    expect(spans[2]!.state).toEqual({ id: byType('completed').id });
  });

  it('keeps state spans for status rows logged without ids', async () => {
    const { owner, byType, createIssue } = await setup();
    const id = await createIssue();
    for (const type of ['started', 'completed'])
      await run(
        owner.cookie,
        `mutation { issueUpdate(id: "${id}", input: { stateId: "${byType(type).id}" }) { success } }`,
      );
    const rows = await db
      .select({ id: issueActivity.id, toText: issueActivity.toText })
      .from(issueActivity)
      .where(and(eq(issueActivity.issueId, id), eq(issueActivity.action, 'status')))
      .orderBy(issueActivity.createdAt);
    // Rows written before ids were recorded: the first keeps a name that matches a
    // state of the team, the second a name that matches none.
    await db
      .update(issueActivity)
      .set({ fromId: null, toId: null })
      .where(eq(issueActivity.id, rows[0]!.id));
    await db
      .update(issueActivity)
      .set({ fromId: null, toId: null, toText: 'Gone state' })
      .where(eq(issueActivity.id, rows[1]!.id));
    const spans: Data[] = (
      await run(
        owner.cookie,
        `{ issue(id: "${id}") { stateHistory { nodes { stateId startedAt endedAt } } } }`,
      )
    ).issue.stateHistory.nodes;
    expect(spans.map((s) => s.stateId)).toEqual([
      byType('unstarted').id,
      byType('started').id,
      byType('started').id,
    ]);
    expect(spans[1]!.endedAt).toBeTruthy();
  });

  it('project history', async () => {
    const { owner, teamId } = await setup();
    const project = (
      await run(
        owner.cookie,
        `mutation { projectCreate(input: { name: "Site", teamIds: ["${teamId}"] }) { project { id } } }`,
      )
    ).projectCreate.project.id;
    const statuses: Data[] = (await run(owner.cookie, '{ projectStatuses { nodes { id type } } }'))
      .projectStatuses.nodes;
    const started = statuses.find((s) => s.type === 'started')!;
    await run(
      owner.cookie,
      `mutation { projectUpdate(id: "${project}", input: { statusId: "${started.id}", leadId: "${owner.userId}" }) { success } }`,
    );
    const nodes: Data[] = (
      await run(
        owner.cookie,
        `{ project(id: "${project}") { history { nodes { id createdAt entries project { id } } } } }`,
      )
    ).project.history.nodes;
    const entries = nodes.map((n) => n.entries);
    expect(entries.some((e) => e.action === 'status' && e.toId === started.id)).toBe(true);
    expect(entries.some((e) => e.action === 'lead' && e.toId === owner.userId)).toBe(true);
    expect(nodes[0]!.project).toEqual({ id: project });
  });

  it('filters archived issues', async () => {
    const { owner, createIssue } = await setup();
    const kept = await createIssue('Kept');
    const gone = await createIssue('Gone');
    await run(owner.cookie, `mutation { issueArchive(id: "${gone}") { success } }`);
    const ids: string[] = (
      await run(
        owner.cookie,
        '{ issues(filter: { archivedAt: { null: false } }, includeArchived: true) { nodes { id } } }',
      )
    ).issues.nodes.map((n: Data) => n.id);
    expect(ids).toEqual([gone]);
    expect(ids).not.toContain(kept);
  });

  it('batch adds labels', async () => {
    const { owner, teamId, createIssue } = await setup();
    const a = await createIssue('A');
    const b = await createIssue('B');
    const label = (
      await run(
        owner.cookie,
        `mutation { issueLabelCreate(input: { name: "Bug", teamId: "${teamId}" }) { issueLabel { id } } }`,
      )
    ).issueLabelCreate.issueLabel.id;
    const other = (
      await run(
        owner.cookie,
        `mutation { issueLabelCreate(input: { name: "Chore", teamId: "${teamId}" }) { issueLabel { id } } }`,
      )
    ).issueLabelCreate.issueLabel.id;
    await run(
      owner.cookie,
      `mutation { issueBatchUpdate(ids: ["${a}", "${b}"], input: { addedLabelIds: ["${label}"] }) { success } }`,
    );
    const labelIds = async (id: string) =>
      (await run(owner.cookie, `{ issue(id: "${id}") { labelIds } }`)).issue.labelIds as string[];
    expect(await labelIds(a)).toEqual([label]);
    expect(await labelIds(b)).toEqual([label]);
    await run(
      owner.cookie,
      `mutation { issueAddLabel(id: "${a}", labelId: "${other}") { success } }`,
    );
    expect((await labelIds(a)).sort()).toEqual([label, other].sort());
    await run(
      owner.cookie,
      `mutation { issueRemoveLabel(id: "${a}", labelId: "${label}") { success } }`,
    );
    expect(await labelIds(a)).toEqual([other]);
    await run(
      owner.cookie,
      `mutation { issueBatchUpdate(ids: ["${b}"], input: { removedLabelIds: ["${label}"] }) { success } }`,
    );
    expect(await labelIds(b)).toEqual([]);
  });

  it('reorders states within their type group', async () => {
    const { owner, teamId, byType } = await setup();
    const todo = byType('unstarted');
    const created = await run(
      owner.cookie,
      `mutation { workflowStateCreate(input: { teamId: "${teamId}", name: "Ready", type: "unstarted", color: "#123456" }) { workflowState { id } } }`,
    );
    const readyId: string = created.workflowStateCreate.workflowState.id;
    await run(
      owner.cookie,
      `mutation { workflowStateUpdate(id: "${readyId}", input: { position: ${todo.position - 1} }) { success } }`,
    );
    const after: Data[] = (
      await run(owner.cookie, `{ team(id: "${teamId}") { states { nodes { id type position } } } }`)
    ).team.states.nodes;
    const unstarted = after
      .filter((s) => s.type === 'unstarted')
      .sort((x, y) => x.position - y.position)
      .map((s) => s.id);
    expect(unstarted).toEqual([readyId, todo.id]);
  });

  it('deletes a team', async () => {
    const { owner, teamId } = await setup();
    const member = await signUpAs('member');
    const refused = await gql(
      { cookie: member.cookie },
      `mutation { teamDelete(id: "${teamId}") { success } }`,
    );
    expect(errorCode(refused)).toBe('FORBIDDEN');
    const done = await run(owner.cookie, `mutation { teamDelete(id: "${teamId}") { success } }`);
    expect(done.teamDelete.success).toBe(true);
    const gone = await gql({ cookie: owner.cookie }, `{ team(id: "${teamId}") { id } }`);
    expect(errorCode(gone)).toBe('ENTITY_NOT_FOUND');
  });
});
