import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createIssue,
  createLabel,
  createProject,
  createTeam,
  gqlData,
  signUpAs,
  statesByType,
  updateIssue,
  updateTeam,
  type Data,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { instance, ok } from '../../../portal/__tests__/helpers';

// Linear's IssueSortInput on `issues` (graphql/issue-sort.ts): every key, several keys
// in order, null placement, and forward paging through a sort.

beforeEach(resetDb);

const ISSUES = `query ($sort: [IssueSortInput!], $filter: IssueFilter, $first: Int, $after: String) {
  issues(sort: $sort, filter: $filter, first: $first, after: $after) {
    nodes { id title }
    pageInfo { hasNextPage endCursor }
  }
}`;

async function titles(as: TestUser, sort: unknown, filter?: unknown): Promise<string[]> {
  const data = await gqlData<Data>(as, ISSUES, { sort, filter });
  return data.issues.nodes.map((n: { title: string }) => n.title);
}

async function code(as: TestUser, query: string, variables?: Record<string, unknown>) {
  const res = await gql({ cookie: as.cookie }, query, variables);
  return res.body.errors?.[0]?.extensions?.code as string | undefined;
}

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const eng = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  return { owner, eng, states: statesByType(eng) };
}

const asc = (extra: Record<string, unknown> = {}) => ({ order: 'Ascending', ...extra });
const desc = (extra: Record<string, unknown> = {}) => ({ order: 'Descending', ...extra });

describe('issue sorts', () => {
  it('sorts by priority with No priority last unless noPriorityFirst', async () => {
    const { owner, eng } = await setup();
    for (const [title, priority] of [
      ['Low', 4],
      ['None', 0],
      ['Urgent', 1],
      ['High', 2],
    ] as const)
      await createIssue(owner, { teamId: eng.team.id, title, priority });
    expect(await titles(owner, [{ priority: asc() }])).toEqual(['Urgent', 'High', 'Low', 'None']);
    expect(await titles(owner, [{ priority: desc() }])).toEqual(['None', 'Low', 'High', 'Urgent']);
    expect(await titles(owner, [{ priority: asc({ noPriorityFirst: true }) }])).toEqual([
      'None',
      'Urgent',
      'High',
      'Low',
    ]);
  });

  it('places empty due dates by `nulls` in both directions and pages across them', async () => {
    const { owner, eng } = await setup();
    await createIssue(owner, { teamId: eng.team.id, title: 'Feb', dueDate: '2026-02-01' });
    await createIssue(owner, { teamId: eng.team.id, title: 'None' });
    await createIssue(owner, { teamId: eng.team.id, title: 'Jan', dueDate: '2026-01-01' });
    expect(await titles(owner, [{ dueDate: asc() }])).toEqual(['Jan', 'Feb', 'None']);
    expect(await titles(owner, [{ dueDate: asc({ nulls: 'first' }) }])).toEqual([
      'None',
      'Jan',
      'Feb',
    ]);
    const sort = [{ dueDate: desc({ nulls: 'first' }) }];
    expect(await titles(owner, sort)).toEqual(['None', 'Feb', 'Jan']);
    const seen: string[] = [];
    let after: string | null = null;
    for (;;) {
      const data: Data = await gqlData<Data>(owner, ISSUES, { sort, first: 1, after });
      seen.push(...data.issues.nodes.map((n: { title: string }) => n.title));
      if (!data.issues.pageInfo.hasNextPage) break;
      after = data.issues.pageInfo.endCursor;
    }
    expect(seen).toEqual(['None', 'Feb', 'Jan']);
  });

  it('sorts by title, estimate, created, updated and completed dates', async () => {
    const { owner, eng, states } = await setup();
    const b = await createIssue(owner, { teamId: eng.team.id, title: 'Bravo', estimate: 3 });
    const a = await createIssue(owner, { teamId: eng.team.id, title: 'alpha', estimate: 5 });
    await createIssue(owner, { teamId: eng.team.id, title: 'Charlie', estimate: 1 });
    expect(await titles(owner, [{ title: asc() }])).toEqual(['alpha', 'Bravo', 'Charlie']);
    expect(await titles(owner, [{ estimate: desc() }])).toEqual(['alpha', 'Bravo', 'Charlie']);
    expect(await titles(owner, [{ createdAt: asc() }])).toEqual(['Bravo', 'alpha', 'Charlie']);
    await updateIssue(owner, b.id, { title: 'Bravo' });
    expect((await titles(owner, [{ updatedAt: desc() }]))[0]).toBe('Bravo');
    await updateIssue(owner, a.id, { stateId: states.completed });
    await updateIssue(owner, b.id, { stateId: states.completed });
    expect(await titles(owner, [{ completedAt: desc() }])).toEqual(['Bravo', 'alpha', 'Charlie']);
  });

  it('sorts by workflow state type, with typeOnly and closed issues by recency', async () => {
    const { owner, eng, states } = await setup();
    const make = (title: string, stateId: string) =>
      createIssue(owner, { teamId: eng.team.id, title, stateId });
    const done1 = await make('Done first', states.backlog!);
    await make('Started', states.started!);
    await make('Backlog', states.backlog!);
    const done2 = await make('Done second', states.backlog!);
    await make('Canceled', states.canceled!);
    await updateIssue(owner, done1.id, { stateId: states.completed });
    await updateIssue(owner, done2.id, { stateId: states.completed });
    const order = await titles(owner, [{ workflowState: asc() }]);
    expect(order.slice(0, 2)).toEqual(['Backlog', 'Started']);
    expect(order[4]).toBe('Canceled');
    expect(
      await titles(owner, [{ workflowState: asc({ closedIssuesOrderedByRecency: true }) }]),
    ).toEqual(['Backlog', 'Started', 'Done second', 'Done first', 'Canceled']);
    expect((await titles(owner, [{ workflowState: desc({ typeOnly: true }) }]))[0]).toBe(
      'Canceled',
    );
  });

  it('sorts by assignee name, team name and manual order', async () => {
    const { owner, eng } = await setup();
    const ann = await signUpTestUser({ name: 'Ann' });
    const zed = await signUpTestUser({ name: 'Zed' });
    await addMember(owner, eng.team.id, ann.userId);
    await addMember(owner, eng.team.id, zed.userId);
    await createIssue(owner, { teamId: eng.team.id, title: 'Z', assigneeId: zed.userId });
    await createIssue(owner, { teamId: eng.team.id, title: 'None' });
    await createIssue(owner, { teamId: eng.team.id, title: 'A', assigneeId: ann.userId });
    expect(await titles(owner, [{ assignee: asc() }])).toEqual(['A', 'Z', 'None']);
    const ops = await createTeam(owner, { key: 'OPS', name: 'Alpha ops' });
    await createIssue(owner, { teamId: ops.team.id, title: 'Ops' });
    expect((await titles(owner, [{ team: asc() }]))[0]).toBe('Ops');
    const all = await gqlData<Data>(owner, ISSUES, {});
    const byTitle = new Map(
      all.issues.nodes.map((n: { id: string; title: string }) => [n.title, n.id]),
    );
    await updateIssue(owner, byTitle.get('None') as string, { sortOrder: -100 });
    expect((await titles(owner, [{ manual: asc() }]))[0]).toBe('None');
  });

  it('sorts by cycle start date, with the current cycle first when asked', async () => {
    const { owner, eng } = await setup();
    await updateTeam(owner, eng.team.id, { cyclesEnabled: true });
    const data = await gqlData<Data>(
      owner,
      `query ($id: String!) { team(id: $id) { cycles { nodes { id number } } } }`,
      { id: eng.team.id },
    );
    const cycle = (n: number) =>
      data.team.cycles.nodes.find((c: { number: number }) => c.number === n).id;
    await createIssue(owner, { teamId: eng.team.id, title: 'C2', cycleId: cycle(2) });
    await createIssue(owner, { teamId: eng.team.id, title: 'C1', cycleId: cycle(1) });
    await createIssue(owner, { teamId: eng.team.id, title: 'C3', cycleId: cycle(3) });
    await createIssue(owner, { teamId: eng.team.id, title: 'None' });
    expect(await titles(owner, [{ cycle: asc() }])).toEqual(['C1', 'C2', 'C3', 'None']);
    expect(await titles(owner, [{ cycle: desc() }])).toEqual(['C3', 'C2', 'C1', 'None']);
    expect(await titles(owner, [{ cycle: desc({ currentCycleFirst: true }) }])).toEqual([
      'C1',
      'C3',
      'C2',
      'None',
    ]);
  });

  it('sorts by project name and milestone target date', async () => {
    const { owner, eng } = await setup();
    const zp = await createProject(owner, { name: 'Zeta', teamIds: [eng.team.id] });
    const ap = await createProject(owner, { name: 'Apex', teamIds: [eng.team.id] });
    const milestone = async (name: string, targetDate: string) =>
      (
        await gqlData<Data>(
          owner,
          `mutation ($input: ProjectMilestoneCreateInput!) {
            projectMilestoneCreate(input: $input) { projectMilestone { id } } }`,
          { input: { projectId: zp.id, name, targetDate } },
        )
      ).projectMilestoneCreate.projectMilestone.id as string;
    const late = await milestone('Late', '2026-09-01');
    const early = await milestone('Early', '2026-03-01');
    await createIssue(owner, {
      teamId: eng.team.id,
      title: 'Zeta late',
      projectId: zp.id,
      projectMilestoneId: late,
    });
    await createIssue(owner, { teamId: eng.team.id, title: 'Apex', projectId: ap.id });
    await createIssue(owner, {
      teamId: eng.team.id,
      title: 'Zeta early',
      projectId: zp.id,
      projectMilestoneId: early,
    });
    await createIssue(owner, { teamId: eng.team.id, title: 'None' });
    expect((await titles(owner, [{ project: asc() }])).slice(0, 1)).toEqual(['Apex']);
    expect((await titles(owner, [{ project: asc() }]))[3]).toBe('None');
    expect((await titles(owner, [{ milestone: asc() }])).slice(0, 2)).toEqual([
      'Zeta early',
      'Zeta late',
    ]);
  });

  it('sorts by label with the lowest name ascending and the highest descending', async () => {
    const { owner, eng } = await setup();
    const label = async (name: string, parentId?: string, isGroup?: boolean) =>
      (await createLabel(owner, { name, teamId: eng.team.id, parentId, isGroup })).id;
    const alpha = await label('Alpha');
    const zulu = await label('Zulu');
    const mike = await label('Mike');
    await createIssue(owner, { teamId: eng.team.id, title: 'Two', labelIds: [alpha, zulu] });
    await createIssue(owner, { teamId: eng.team.id, title: 'Mike', labelIds: [mike] });
    await createIssue(owner, { teamId: eng.team.id, title: 'None' });
    expect(await titles(owner, [{ label: asc() }])).toEqual(['Two', 'Mike', 'None']);
    expect(await titles(owner, [{ label: desc() }])).toEqual(['Two', 'Mike', 'None']);
    expect(await titles(owner, [{ label: desc() }], { title: { neq: 'Two' } })).toEqual([
      'Mike',
      'None',
    ]);
    const group = await label('Area', undefined, true);
    const web = await label('Web', group);
    const api = await label('Api', group);
    await createIssue(owner, { teamId: eng.team.id, title: 'Web', labelIds: [web] });
    await createIssue(owner, { teamId: eng.team.id, title: 'Api', labelIds: [api] });
    const grouped = await titles(owner, [{ labelGroup: asc({ labelGroupId: group }) }]);
    expect(grouped.slice(0, 2)).toEqual(['Api', 'Web']);
  });

  it('sorts by link count and by the root issue', async () => {
    const { owner, eng } = await setup();
    const many = await createIssue(owner, { teamId: eng.team.id, title: 'Two links' });
    const one = await createIssue(owner, { teamId: eng.team.id, title: 'One link' });
    await createIssue(owner, { teamId: eng.team.id, title: 'No links' });
    const attach = (issueId: string, url: string) =>
      gqlData(
        owner,
        `mutation ($input: AttachmentCreateInput!) { attachmentCreate(input: $input) { success } }`,
        { input: { issueId, url, title: url } },
      );
    await attach(many.id, 'https://a.example');
    await attach(many.id, 'https://b.example');
    await attach(one.id, 'https://c.example');
    expect(await titles(owner, [{ linkCount: desc() }])).toEqual([
      'Two links',
      'One link',
      'No links',
    ]);

    const low = await createIssue(owner, { teamId: eng.team.id, title: 'Root low', priority: 4 });
    const urgent = await createIssue(owner, {
      teamId: eng.team.id,
      title: 'Root urgent',
      priority: 1,
    });
    await createIssue(owner, { teamId: eng.team.id, title: 'Child of low', parentId: low.id });
    await createIssue(owner, {
      teamId: eng.team.id,
      title: 'Child of urgent',
      parentId: urgent.id,
    });
    expect(
      await titles(owner, [{ rootIssue: asc({ sort: { priority: asc() } }) }], {
        title: { startsWith: 'Child' },
      }),
    ).toEqual(['Child of urgent', 'Child of low']);
  });

  it('sorts by most recent release date', async () => {
    const { owner, eng } = await setup();
    const created = (
      await gqlData<Data>(
        owner,
        `mutation ($input: ReleasePipelineCreateInput!) {
          releasePipelineCreate(input: $input) {
            releasePipeline { id stages { nodes { id type } } } } }`,
        {
          input: {
            name: 'Production',
            type: 'scheduled',
            teamIds: [eng.team.id],
            rolloverIssuesOnCompletion: false,
          },
        },
      )
    ).releasePipelineCreate.releasePipeline;
    const pipeline = created.id as string;
    const completedStage = created.stages.nodes.find(
      (st: { type: string }) => st.type === 'completed',
    ).id as string;
    const release = async (name: string) =>
      (
        await gqlData<Data>(
          owner,
          `mutation ($input: ReleaseCreateInput!) { releaseCreate(input: $input) { release { id } } }`,
          { input: { name, pipelineId: pipeline } },
        )
      ).releaseCreate.release.id as string;
    const link = (issueId: string, releaseId: string) =>
      gqlData(
        owner,
        `mutation ($input: IssueToReleaseCreateInput!) { issueToReleaseCreate(input: $input) { success } }`,
        { input: { issueId, releaseId } },
      );
    const complete = (id: string) =>
      gqlData(
        owner,
        `mutation ($id: String!, $input: ReleaseUpdateInput!) {
          releaseUpdate(id: $id, input: $input) { success } }`,
        { id, input: { stageId: completedStage } },
      );
    const r1 = await release('v1');
    const r2 = await release('v2');
    const older = await createIssue(owner, { teamId: eng.team.id, title: 'In v1' });
    const newer = await createIssue(owner, { teamId: eng.team.id, title: 'In v2' });
    await createIssue(owner, { teamId: eng.team.id, title: 'None' });
    await link(older.id, r1);
    await link(newer.id, r2);
    await complete(r1);
    await new Promise((r) => setTimeout(r, 20));
    await complete(r2);
    expect(await titles(owner, [{ release: desc() }])).toEqual(['In v2', 'In v1', 'None']);
  });

  it('sorts by customer name and revenue only while Customers is on and visible', async () => {
    const { owner, eng } = await setup();
    await ok(await instance('customers-settings/save', owner, { enabled: true }));
    const customer = async (name: string, revenue: number) =>
      (
        await gqlData<Data>(
          owner,
          `mutation ($input: CustomerCreateInput!) { customerCreate(input: $input) { customer { id } } }`,
          { input: { name, revenue } },
        )
      ).customerCreate.customer.id as string;
    const big = await customer('Zenith', 900);
    const small = await customer('Acme', 100);
    const need = async (title: string, customerId: string) => {
      const i = await createIssue(owner, { teamId: eng.team.id, title });
      await gqlData(
        owner,
        `mutation ($input: CustomerNeedCreateInput!) { customerNeedCreate(input: $input) { success } }`,
        { input: { issueId: i.id, customerId } },
      );
    };
    await need('Big', big);
    await need('Small', small);
    await createIssue(owner, { teamId: eng.team.id, title: 'None' });
    expect(await titles(owner, [{ customer: asc() }])).toEqual(['Small', 'Big', 'None']);
    expect(await titles(owner, [{ customerRevenue: desc() }])).toEqual(['Big', 'Small', 'None']);

    const guest = await signUpAs('guest', { name: 'Guest' });
    await addMember(owner, eng.team.id, guest.userId);
    // A guest sees no customers: the key is empty for every issue, so the tie-break
    // (manual order) decides.
    expect(await titles(guest, [{ customer: asc() }])).toEqual(['Big', 'Small', 'None']);

    await ok(await instance('customers-settings/save', owner, { enabled: false }));
    expect(await titles(owner, [{ customer: asc() }])).toEqual(['Big', 'Small', 'None']);
  });

  it('applies several keys in order', async () => {
    const { owner, eng } = await setup();
    for (const [title, priority, dueDate] of [
      ['High early', 2, '2026-01-01'],
      ['Urgent', 1, null],
      ['High late', 2, '2026-06-01'],
    ] as const)
      await createIssue(owner, { teamId: eng.team.id, title, priority, dueDate });
    expect(await titles(owner, [{ priority: asc() }, { dueDate: desc() }])).toEqual([
      'Urgent',
      'High late',
      'High early',
    ]);
  });

  it('pages through 120 issues of equal priority without repeating or skipping one', async () => {
    const { owner, eng } = await setup();
    for (let i = 0; i < 120; i++)
      await createIssue(owner, { teamId: eng.team.id, title: `Issue ${i}`, priority: 2 });
    const seen: string[] = [];
    const sizes: number[] = [];
    let after: string | null = null;
    for (;;) {
      const data: Data = await gqlData<Data>(owner, ISSUES, {
        sort: [{ priority: asc() }],
        first: 50,
        after,
      });
      sizes.push(data.issues.nodes.length);
      seen.push(...data.issues.nodes.map((n: { id: string }) => n.id));
      if (!data.issues.pageInfo.hasNextPage) break;
      after = data.issues.pageInfo.endCursor;
    }
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
  });

  it('refuses slaStatus and backward paging with a sort', async () => {
    const { owner, eng } = await setup();
    await createIssue(owner, { teamId: eng.team.id, title: 'A' });
    expect(await code(owner, ISSUES, { sort: [{ slaStatus: { order: 'Ascending' } }] })).toBe(
      'INVALID_INPUT',
    );
    expect(
      await code(
        owner,
        `{ issues(last: 1, sort: [{ title: { order: Ascending } }]) { nodes { id } } }`,
      ),
    ).toBe('INVALID_INPUT');
  });
});
