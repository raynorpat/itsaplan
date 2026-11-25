import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createDocument,
  createLabel,
  createState,
  createIssue,
  createProject,
  createTeam,
  gqlData,
  signUpAs,
  statesByType,
  teamView,
  updateIssue,
  updateTeam,
  type TeamView,
} from '../../../__tests__/helpers/graphql';
import { createApiKey } from '../../../__tests__/helpers/linear';
import { callTool, mcp, toolJson, toolNames } from '../../../__tests__/helpers/mcp';

// Linear's MCP tool set on GraphQL: each tool runs a GraphQL operation as the caller,
// accepts names, keys or ids, and answers with compact JSON.

const READ_TOOLS = [
  'get_document',
  'get_issue',
  'get_issue_status',
  'get_project',
  'get_team',
  'get_user',
  'list_comments',
  'list_cycles',
  'list_documents',
  'list_issue_labels',
  'list_issue_statuses',
  'list_issues',
  'list_my_issues',
  'list_project_labels',
  'list_projects',
  'list_teams',
  'list_users',
];
const WRITE_TOOLS = [
  'create_comment',
  'create_issue',
  'create_issue_label',
  'create_project',
  'update_issue',
  'update_project',
];

describe('MCP tools on GraphQL', () => {
  let owner: TestUser;
  let key: string;
  let eng: TeamView;
  let ann: TestUser;
  let bob: TestUser;

  beforeEach(async () => {
    await resetDb();
    owner = await signUpTestUser({ name: 'Olivia Owner' });
    ann = await signUpTestUser({ name: 'Ann Smith' });
    const jones = await signUpTestUser({ name: 'Ann Jones' });
    bob = await signUpTestUser({ name: 'Bob Stone', email: 'bob@example.com' });
    key = await createApiKey(owner.cookie);
    eng = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
    for (const u of [ann, jones, bob]) await addMember(owner, 'ENG', u.userId);
    await createTeam(owner, { key: 'SEC', name: 'Security', private: true });
  });

  it('lists Linear tool set on /mcp and only the read tools on /mcp/readonly', async () => {
    expect(await toolNames(key)).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
    expect(await toolNames(key, '/mcp/readonly')).toEqual([...READ_TOOLS].sort());
    // A write tool called by name on the read-only endpoint is refused and changes nothing.
    const refused = await callTool(
      key,
      'create_issue',
      { team: 'ENG', title: 'Nope' },
      '/mcp/readonly',
    );
    expect(refused.isError).toBe(true);
    const list = await toolJson(key, 'list_issues', { team: 'ENG' });
    expect(list.issues).toEqual([]);
  });

  it('reads teams, statuses and users by name, key or id', async () => {
    const teams = await toolJson(key, 'list_teams');
    expect(teams.teams.map((t: { key: string }) => t.key).sort()).toEqual(['ENG', 'SEC']);
    for (const ref of ['ENG', 'Engineering', eng.team.id]) {
      const team = await toolJson(key, 'get_team', { team: ref });
      expect(team.key).toBe('ENG');
    }
    const statuses = await toolJson(key, 'list_issue_statuses', { team: 'eng' });
    expect(statuses.statuses.map((s: { type: string }) => s.type)).toContain('started');
    const started = eng.states.find((s) => s.stateType === 'started')!;
    const status = await toolJson(key, 'get_issue_status', { team: 'ENG', name: started.name });
    expect(status).toMatchObject({ id: started.id, type: 'started' });

    const anns = await toolJson(key, 'list_users', { query: 'ann' });
    expect(anns.users.map((u: { name: string }) => u.name).sort()).toEqual([
      'Ann Jones',
      'Ann Smith',
    ]);
    expect((await toolJson(key, 'get_user', { user: 'bob@example.com' })).id).toBe(bob.userId);
    expect((await toolJson(key, 'get_user', { user: 'me' })).id).toBe(owner.userId);
    const ambiguous = await callTool(key, 'get_user', { user: 'Ann' });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.content[0]!.text).toContain('Ann Smith');
    expect(ambiguous.content[0]!.text).toContain('Ann Jones');
  });

  it('creates, reads and updates an issue by names', async () => {
    const label = await toolJson(key, 'create_issue_label', { name: 'Bug', team: 'ENG' });
    expect(label.name).toBe('Bug');
    const labels = await toolJson(key, 'list_issue_labels', { team: 'ENG' });
    expect(labels.labels.map((l: { name: string }) => l.name)).toContain('Bug');

    const started = eng.states.find((s) => s.stateType === 'started')!;
    const created = await toolJson(key, 'create_issue', {
      team: 'Engineering',
      title: 'Fix login',
      description: 'It fails',
      state: started.name,
      assignee: 'Bob',
      labels: ['bug'],
      priority: 2,
    });
    expect(created).toMatchObject({ identifier: 'ENG-1', title: 'Fix login' });
    expect(created.url).toContain('/team/ENG/issue/1');

    const read = await toolJson(key, 'get_issue', { id: 'ENG-1' });
    expect(read).toMatchObject({
      identifier: 'ENG-1',
      description: 'It fails',
      state: { name: started.name, type: 'started' },
      assignee: { name: 'Bob Stone' },
      priority: 2,
      team: { key: 'ENG' },
    });
    expect(read.labels.map((l: { name: string }) => l.name)).toEqual(['Bug']);

    // An ambiguous person changes nothing and answers with the candidates.
    const ambiguous = await callTool(key, 'update_issue', { id: 'ENG-1', assignee: 'Ann' });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.content[0]!.text).toContain('Ann Smith');
    expect((await toolJson(key, 'get_issue', { id: 'ENG-1' })).assignee.name).toBe('Bob Stone');

    const done = eng.states.find((s) => s.stateType === 'completed')!;
    const updated = await toolJson(key, 'update_issue', {
      id: created.id,
      assignee: 'Ann Smith',
      state: 'completed',
      title: 'Fix login page',
    });
    expect(updated).toMatchObject({
      title: 'Fix login page',
      state: { name: done.name },
      assignee: { name: 'Ann Smith' },
    });
    const cleared = await toolJson(key, 'update_issue', { id: 'ENG-1', assignee: null });
    expect(cleared.assignee).toBeNull();
    expect(ann.userId).toBeTruthy();
  });

  it('sets an estimate on the team scale, refuses one off it and clears with null', async () => {
    await updateTeam(owner, 'ENG', { issueEstimationType: 'fibonacci' });
    const created = await toolJson(key, 'create_issue', { team: 'ENG', title: 'Sized' });
    const off = await callTool(key, 'update_issue', { id: created.identifier, estimate: 4 });
    expect(off.isError).toBe(true);
    expect(off.content[0]!.text).toContain('estimate must be one of 1, 2, 3, 5, 8');
    expect(
      (await toolJson(key, 'update_issue', { id: created.identifier, estimate: 5 })).estimate,
    ).toBe(5);
    expect(
      (await toolJson(key, 'update_issue', { id: created.identifier, estimate: null })).estimate,
    ).toBeNull();
  });

  it('changes nothing and lists the candidates for an ambiguous status or label', async () => {
    await createState(owner, { teamId: 'ENG', name: 'Doing', type: 'started' });
    await createState(owner, { teamId: 'ENG', name: 'doing', type: 'started' });
    await createLabel(owner, { teamId: 'ENG', name: 'Bug' });
    await createLabel(owner, { teamId: 'ENG', name: 'bug' });
    const created = await toolJson(key, 'create_issue', { team: 'ENG', title: 'Steady' });

    const byState = await callTool(key, 'update_issue', { id: created.identifier, state: 'DOING' });
    expect(byState.isError).toBe(true);
    expect(byState.content[0]!.text).toContain('several statuses');
    expect(byState.content[0]!.text).toContain('Doing (started)');
    expect(byState.content[0]!.text).toContain('doing (started)');

    const byLabel = await callTool(key, 'update_issue', {
      id: created.identifier,
      labels: ['BUG'],
    });
    expect(byLabel.isError).toBe(true);
    expect(byLabel.content[0]!.text).toContain('several labels');

    const after = await toolJson(key, 'get_issue', { id: created.identifier });
    expect(after.state.name).toBe(created.state.name);
    expect(after.labels).toEqual([]);
  });

  it('refuses an argument of the wrong type with a tool error, not a server error', async () => {
    await createLabel(owner, { teamId: 'ENG', name: 'Bug' });
    const created = await toolJson(key, 'create_issue', { team: 'ENG', title: 'Typed' });
    const res = await mcp(key, 'tools/call', {
      name: 'update_issue',
      arguments: { id: created.identifier, labels: 'Bug' },
    });
    expect(res.error).toBeUndefined();
    const result = res.result as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('labels must be an array of strings');
    expect((await toolJson(key, 'get_issue', { id: created.identifier })).labels).toEqual([]);
  });

  it('puts a new label into a group of the given team and lists ambiguous groups', async () => {
    await createLabel(owner, { teamId: 'ENG', name: 'Area', isGroup: true });
    await createTeam(owner, { key: 'OPS', name: 'Operations' });
    await createLabel(owner, { teamId: 'OPS', name: 'Area', isGroup: true });
    const inEng = await toolJson(key, 'create_issue_label', {
      name: 'Backend',
      team: 'ENG',
      group: 'area',
    });
    expect(inEng.name).toBe('Backend');

    await createLabel(owner, { teamId: 'ENG', name: 'Kind', isGroup: true });
    await createLabel(owner, { teamId: 'ENG', name: 'kind', isGroup: true });
    const ambiguous = await callTool(key, 'create_issue_label', {
      name: 'Feature',
      team: 'ENG',
      group: 'KIND',
    });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.content[0]!.text).toContain('several label groups');
  });

  it('lists issues by team, state, assignee, label, text and completion date', async () => {
    const types = statesByType(eng);
    const first = await createIssue(owner, { teamId: 'ENG', title: 'Alpha task' });
    await createIssue(owner, { teamId: 'ENG', title: 'Beta task', assigneeId: owner.userId });
    await updateIssue(owner, first.id, { stateId: types.completed });

    const all = await toolJson(key, 'list_issues', { team: 'ENG' });
    expect(all.issues.map((i: { identifier: string }) => i.identifier).sort()).toEqual([
      'ENG-1',
      'ENG-2',
    ]);
    const mine = await toolJson(key, 'list_issues', { assignee: 'me' });
    expect(mine.issues.map((i: { title: string }) => i.title)).toEqual(['Beta task']);
    const byText = await toolJson(key, 'list_issues', { team: 'ENG', query: 'alpha' });
    expect(byText.issues.map((i: { title: string }) => i.title)).toEqual(['Alpha task']);
    const completed = await toolJson(key, 'list_issues', { completedAt: '-P7D' });
    expect(completed.issues.map((i: { title: string }) => i.title)).toEqual(['Alpha task']);
    const byState = await toolJson(key, 'list_issues', { team: 'ENG', state: 'completed' });
    expect(byState.issues.map((i: { title: string }) => i.title)).toEqual(['Alpha task']);
    const myList = await toolJson(key, 'list_my_issues');
    expect(myList.issues.map((i: { title: string }) => i.title)).toEqual(['Beta task']);
    const page = await toolJson(key, 'list_issues', { team: 'ENG', limit: 1 });
    expect(page.issues).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
  });

  it('adds and lists comments', async () => {
    await createIssue(owner, { teamId: 'ENG', title: 'Commented' });
    const comment = await toolJson(key, 'create_comment', { issueId: 'ENG-1', body: 'Looks good' });
    expect(comment.body).toBe('Looks good');
    const comments = await toolJson(key, 'list_comments', { issueId: 'ENG-1' });
    expect(comments.comments).toHaveLength(1);
    expect(comments.comments[0]).toMatchObject({ body: 'Looks good', user: 'Olivia Owner' });
  });

  it('creates, reads, updates and lists projects; lists project labels', async () => {
    const project = await toolJson(key, 'create_project', {
      name: 'Launch',
      teams: ['ENG'],
      description: 'Ship it',
      lead: 'Bob',
    });
    expect(project).toMatchObject({ name: 'Launch', lead: { name: 'Bob Stone' } });
    const read = await toolJson(key, 'get_project', { project: 'Launch' });
    expect(read.teams.map((t: { key: string }) => t.key)).toEqual(['ENG']);
    const updated = await toolJson(key, 'update_project', {
      project: project.id,
      targetDate: '2027-01-31',
      status: 'started',
    });
    expect(updated).toMatchObject({ targetDate: '2027-01-31', status: { type: 'started' } });
    const list = await toolJson(key, 'list_projects', { team: 'ENG' });
    expect(list.projects.map((p: { name: string }) => p.name)).toEqual(['Launch']);
    expect((await toolJson(key, 'list_project_labels')).labels).toEqual([]);
  });

  it('lists cycles and documents', async () => {
    await updateTeam(owner, 'ENG', { cyclesEnabled: true });
    const cycles = await toolJson(key, 'list_cycles', { team: 'ENG' });
    expect(cycles.cycles.length).toBeGreaterThan(0);
    const current = await toolJson(key, 'list_cycles', { team: 'ENG', type: 'current' });
    expect(current.cycles).toHaveLength(1);

    const project = await createProject(owner, { name: 'Docs', teamIds: ['ENG'] });
    const doc = await createDocument(owner, {
      title: 'Plan',
      content: 'Steps',
      projectId: project.id,
    });
    const docs = await toolJson(key, 'list_documents', { project: 'Docs' });
    expect(docs.documents.map((d: { title: string }) => d.title)).toEqual(['Plan']);
    const read = await toolJson(key, 'get_document', { id: doc.id });
    expect(read).toMatchObject({ title: 'Plan', content: 'Steps' });
  });

  it('gives a guest only what GraphQL gives them', async () => {
    await createIssue(owner, { teamId: 'SEC', title: 'Secret' });
    const guest = await signUpAs('guest', { name: 'Gus Guest' });
    await addMember(owner, 'ENG', guest.userId);
    const guestKey = await createApiKey(guest.cookie);
    const teams = await toolJson(guestKey, 'list_teams');
    expect(teams.teams.map((t: { key: string }) => t.key)).toEqual(['ENG']);
    expect((await callTool(guestKey, 'get_issue', { id: 'SEC-1' })).isError).toBe(true);
    expect((await callTool(guestKey, 'list_issues', { team: 'SEC' })).isError).toBe(true);
    expect((await callTool(guestKey, 'create_issue', { team: 'SEC', title: 'In' })).isError).toBe(
      true,
    );
    const view = await teamView(owner, 'SEC');
    const data = await gqlData(
      owner,
      'query($id: String!) { team(id: $id) { issues { nodes { title } } } }',
      {
        id: view.team.id,
      },
    );
    expect(data.team.issues.nodes.map((n: { title: string }) => n.title)).toEqual(['Secret']);
  });
});
