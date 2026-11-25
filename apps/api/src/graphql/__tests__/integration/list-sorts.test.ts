import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createDocument,
  createInitiative,
  createProject,
  createTeam,
  createView,
  gqlData,
  type Data,
} from '../../../__tests__/helpers/graphql';

// Linear's `sort` on the lists other than issues and users: projects, initiatives,
// documents, custom views, releases and release pipelines (graphql/list-sorts.ts).

beforeEach(resetDb);

type As = { cookie: string };

async function list(as: As, field: string, type: string, sort: unknown, select = 'name') {
  const data = await gqlData<Data>(
    as,
    `query ($sort: [${type}!]) { ${field}(sort: $sort) { nodes { ${select} } } }`,
    { sort },
  );
  return data[field].nodes.map((n: Record<string, unknown>) => n[select]);
}

const asc = (key: string, extra: Record<string, unknown> = {}) => [
  { [key]: { order: 'Ascending', ...extra } },
];
const desc = (key: string, extra: Record<string, unknown> = {}) => [
  { [key]: { order: 'Descending', ...extra } },
];

describe('project sorts', () => {
  it('orders by name, priority, status and target date with empty dates placed', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    await createTeam(owner, { name: 'Eng', key: 'ENG' });
    await createProject(owner, { name: 'beta', teamIds: ['ENG'], priority: 3 });
    await createProject(owner, {
      name: 'Alpha',
      teamIds: ['ENG'],
      priority: 1,
      targetDate: '2026-03-01',
    });
    await createProject(owner, {
      name: 'Gamma',
      teamIds: ['ENG'],
      priority: 0,
      targetDate: '2026-01-01',
    });
    const P = 'ProjectSortInput';
    expect(await list(owner, 'projects', P, asc('name'))).toEqual(['Alpha', 'beta', 'Gamma']);
    expect(await list(owner, 'projects', P, desc('name'))).toEqual(['Gamma', 'beta', 'Alpha']);
    // No priority sorts after Low unless noPriorityFirst.
    expect(await list(owner, 'projects', P, asc('priority'))).toEqual(['Alpha', 'beta', 'Gamma']);
    expect(await list(owner, 'projects', P, asc('priority', { noPriorityFirst: true }))).toEqual([
      'Gamma',
      'Alpha',
      'beta',
    ]);
    expect(await list(owner, 'projects', P, asc('targetDate'))).toEqual(['Gamma', 'Alpha', 'beta']);
    expect(await list(owner, 'projects', P, desc('targetDate', { nulls: 'first' }))).toEqual([
      'beta',
      'Alpha',
      'Gamma',
    ]);
  });

  it('orders by health of the latest update and by lead', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const zed = await signUpTestUser({ name: 'Zed' });
    await createTeam(owner, { name: 'Eng', key: 'ENG' });
    await addMember(owner, 'ENG', zed.userId);
    const a = await createProject(owner, { name: 'A', teamIds: ['ENG'], leadId: zed.userId });
    const b = await createProject(owner, { name: 'B', teamIds: ['ENG'], leadId: owner.userId });
    await createProject(owner, { name: 'C', teamIds: ['ENG'] });
    const post = (projectId: string, health: string) =>
      gqlData(
        owner,
        `mutation ($input: ProjectUpdateCreateInput!) { projectUpdateCreate(input: $input) { success } }`,
        { input: { projectId, body: 'b', health } },
      );
    await post(a.id, 'offTrack');
    await post(b.id, 'atRisk');
    await post(b.id, 'onTrack');
    const P = 'ProjectSortInput';
    expect(await list(owner, 'projects', P, asc('health'))).toEqual(['B', 'A', 'C']);
    expect(await list(owner, 'projects', P, asc('lead'))).toEqual(['B', 'A', 'C']);
  });

  it('pages through equal values without repeating or skipping', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    await createTeam(owner, { name: 'Eng', key: 'ENG' });
    for (let i = 0; i < 7; i++) await createProject(owner, { name: 'Same', teamIds: ['ENG'] });
    const seen: string[] = [];
    let after: string | null = null;
    for (let page = 0; page < 5; page++) {
      const data: Data = await gqlData<Data>(
        owner,
        `query ($after: String) { projects(sort: [{ name: { order: Ascending } }], first: 3, after: $after) {
          nodes { id } pageInfo { hasNextPage endCursor } } }`,
        { after },
      );
      seen.push(...data.projects.nodes.map((n: { id: string }) => n.id));
      if (!data.projects.pageInfo.hasNextPage) break;
      after = data.projects.pageInfo.endCursor;
    }
    expect(seen.length).toBe(7);
    expect(new Set(seen).size).toBe(7);
  });

  it('sorts a team’s projects and an initiative’s projects', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const team = await createTeam(owner, { name: 'Eng', key: 'ENG' });
    const b = await createProject(owner, { name: 'B', teamIds: ['ENG'] });
    const a = await createProject(owner, { name: 'A', teamIds: ['ENG'] });
    const data = await gqlData<Data>(
      owner,
      `query ($id: String!) { team(id: $id) { projects(sort: [{ name: { order: Descending } }]) { nodes { name } } } }`,
      { id: team.team.id },
    );
    expect(data.team.projects.nodes.map((n: { name: string }) => n.name)).toEqual(['B', 'A']);
    const ini = await createInitiative(owner, { name: 'I' });
    for (const p of [a, b])
      await gqlData(
        owner,
        `mutation ($input: InitiativeToProjectCreateInput!) { initiativeToProjectCreate(input: $input) { success } }`,
        { input: { initiativeId: ini.id, projectId: p.id } },
      );
    const viaIni = await gqlData<Data>(
      owner,
      `query ($id: String!) { initiative(id: $id) { projects(sort: [{ name: { order: Ascending } }]) { nodes { name } } } }`,
      { id: ini.id },
    );
    expect(viaIni.initiative.projects.nodes.map((n: { name: string }) => n.name)).toEqual([
      'A',
      'B',
    ]);
  });
});

describe('initiative sorts', () => {
  it('orders by name and by owner with an owner-less initiative last', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const ann = await signUpTestUser({ name: 'Ann' });
    await createTeam(owner, { name: 'Eng', key: 'ENG' });
    await createInitiative(owner, { name: 'b', ownerId: owner.userId });
    await createInitiative(owner, { name: 'A', ownerId: ann.userId });
    await createInitiative(owner, { name: 'C' });
    const I = 'InitiativeSortInput';
    expect(await list(owner, 'initiatives', I, asc('name'))).toEqual(['A', 'b', 'C']);
    expect(await list(owner, 'initiatives', I, desc('name'))).toEqual(['C', 'b', 'A']);
    const byOwner = await list(owner, 'initiatives', I, asc('owner'));
    expect(byOwner).toEqual(['A', 'b', 'C']);
    expect(await list(owner, 'initiatives', I, desc('owner'))).toEqual(['b', 'A', 'C']);
  });
});

describe('document and custom view sorts', () => {
  it('orders documents by title', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    await createTeam(owner, { name: 'Eng', key: 'ENG' });
    const p = await createProject(owner, { name: 'P', teamIds: ['ENG'] });
    await createDocument(owner, { title: 'zeta', projectId: p.id });
    await createDocument(owner, { title: 'Alpha', projectId: p.id });
    const D = 'DocumentSortInput';
    expect(await list(owner, 'documents', D, asc('title'), 'title')).toEqual(['Alpha', 'zeta']);
    expect(await list(owner, 'documents', D, desc('title'), 'title')).toEqual(['zeta', 'Alpha']);
  });

  it('orders custom views by name and by shared', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const team = await createTeam(owner, { name: 'Eng', key: 'ENG' });
    await createView(owner, { name: 'b', teamId: team.team.id, shared: true });
    await createView(owner, { name: 'A', teamId: team.team.id, shared: false });
    const V = 'CustomViewSortInput';
    expect(await list(owner, 'customViews', V, asc('name'))).toEqual(['A', 'b']);
    expect(await list(owner, 'customViews', V, desc('shared'))).toEqual(['b', 'A']);
  });
});

describe('release sorts', () => {
  it('orders pipelines by name and releases by stage', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const team = await createTeam(owner, { name: 'Eng', key: 'ENG' });
    const mk = async (name: string, type: string) => {
      const data = await gqlData<Data>(
        owner,
        `mutation ($input: ReleasePipelineCreateInput!) {
          releasePipelineCreate(input: $input) { releasePipeline { id stages { nodes { id type } } } } }`,
        { input: { name, type, teamIds: [team.team.id] } },
      );
      return data.releasePipelineCreate.releasePipeline;
    };
    const mobile = await mk('mobile', 'scheduled');
    await mk('Api', 'continuous');
    expect(await list(owner, 'releasePipelines', 'ReleasePipelineSortInput', asc('name'))).toEqual([
      'Api',
      'mobile',
    ]);
    const stage = (type: string) =>
      mobile.stages.nodes.find((s: { type: string }) => s.type === type).id;
    for (const [name, type] of [
      ['done', 'completed'],
      ['plan', 'planned'],
      ['doing', 'started'],
    ])
      await gqlData(
        owner,
        `mutation ($input: ReleaseCreateInput!) { releaseCreate(input: $input) { success } }`,
        { input: { name, pipelineId: mobile.id, stageId: stage(type!) } },
      );
    expect(await list(owner, 'releases', 'ReleaseSortInput', asc('stage'))).toEqual([
      'plan',
      'doing',
      'done',
    ]);
    expect(await list(owner, 'releases', 'ReleaseSortInput', desc('stage'))).toEqual([
      'done',
      'doing',
      'plan',
    ]);
  });
});
