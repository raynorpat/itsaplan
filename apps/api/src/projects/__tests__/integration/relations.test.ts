import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createProject, createTeam, gqlData, signUpAs } from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';

// Linear's ProjectRelation: a dependency from one project's anchor to another's.

type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const code = (res: Awaited<ReturnType<typeof gql>>) => res.body.errors?.[0]?.extensions?.code;

const CREATE = `mutation ($input: ProjectRelationCreateInput!) {
  projectRelationCreate(input: $input) {
    success
    projectRelation {
      id type anchorType relatedAnchorType
      project { id } relatedProject { id }
      projectMilestone { id } relatedProjectMilestone { id }
      user { id }
    }
  }
}`;

function relate(as: TestUser, input: Record<string, unknown>) {
  return gql({ cookie: as.cookie }, CREATE, {
    input: { type: 'dependency', anchorType: 'end', relatedAnchorType: 'start', ...input },
  });
}

async function milestone(as: TestUser, projectId: string, name: string): Promise<string> {
  const data = await gqlData(
    as,
    `mutation ($input: ProjectMilestoneCreateInput!) {
      projectMilestoneCreate(input: $input) { projectMilestone { id } } }`,
    { input: { projectId, name } },
  );
  return data.projectMilestoneCreate.projectMilestone.id;
}

const SIDES = `query ($id: String!) {
  project(id: $id) {
    relations { nodes { id relatedProject { id } } }
    inverseRelations { nodes { id project { id } } }
  }
}`;

async function setup() {
  const owner = await signUpTestUser();
  const eng = await createTeam(owner, { key: 'ENG' });
  const a = await createProject(owner, { name: 'A', teamIds: [eng.team.id] });
  const b = await createProject(owner, { name: 'B', teamIds: [eng.team.id] });
  const c = await createProject(owner, { name: 'C', teamIds: [eng.team.id] });
  return { owner, eng, a, b, c };
}

describe('project relations', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates a dependency and reads it from both projects', async () => {
    const { owner, a, b } = await setup();
    const res = await relate(owner, { projectId: a.id, relatedProjectId: b.id });
    expect(res.body.errors).toBeUndefined();
    const rel = (res.body.data as Data).projectRelationCreate.projectRelation;
    expect(rel).toMatchObject({
      type: 'dependency',
      anchorType: 'end',
      relatedAnchorType: 'start',
      project: { id: a.id },
      relatedProject: { id: b.id },
      projectMilestone: null,
      relatedProjectMilestone: null,
      user: { id: owner.userId },
    });

    const fromA = await gqlData(owner, SIDES, { id: a.id });
    expect(fromA.project.relations.nodes).toEqual([{ id: rel.id, relatedProject: { id: b.id } }]);
    expect(fromA.project.inverseRelations.nodes).toEqual([]);
    const fromB = await gqlData(owner, SIDES, { id: b.id });
    expect(fromB.project.inverseRelations.nodes).toEqual([{ id: rel.id, project: { id: a.id } }]);

    const one = await gqlData(owner, `query ($id: String!) { projectRelation(id: $id) { id } }`, {
      id: rel.id,
    });
    expect(one.projectRelation.id).toBe(rel.id);
    const all = await gqlData(owner, `{ projectRelations { nodes { id } } }`);
    expect(all.projectRelations.nodes).toEqual([{ id: rel.id }]);
  });

  it('anchors to a milestone of the same project only', async () => {
    const { owner, a, b } = await setup();
    const ma = await milestone(owner, a.id, 'Beta');
    const mb = await milestone(owner, b.id, 'GA');

    const ok = await relate(owner, {
      projectId: a.id,
      anchorType: 'milestone',
      projectMilestoneId: ma,
      relatedProjectId: b.id,
      relatedAnchorType: 'milestone',
      relatedProjectMilestoneId: mb,
    });
    expect(ok.body.errors).toBeUndefined();
    expect((ok.body.data as Data).projectRelationCreate.projectRelation).toMatchObject({
      projectMilestone: { id: ma },
      relatedProjectMilestone: { id: mb },
    });

    const wrongProject = await relate(owner, {
      projectId: a.id,
      anchorType: 'milestone',
      projectMilestoneId: mb,
      relatedProjectId: b.id,
    });
    expect(code(wrongProject)).toBe('INVALID_INPUT');
    const missing = await relate(owner, {
      projectId: a.id,
      anchorType: 'milestone',
      relatedProjectId: b.id,
    });
    expect(code(missing)).toBe('INVALID_INPUT');
    const extra = await relate(owner, {
      projectId: a.id,
      projectMilestoneId: ma,
      relatedProjectId: b.id,
    });
    expect(code(extra)).toBe('INVALID_INPUT');
  });

  it('refuses an unknown type or anchor, a self relation and a duplicate', async () => {
    const { owner, a, b } = await setup();
    expect(
      code(await relate(owner, { type: 'related', projectId: a.id, relatedProjectId: b.id })),
    ).toBe('INVALID_INPUT');
    expect(
      code(await relate(owner, { anchorType: 'middle', projectId: a.id, relatedProjectId: b.id })),
    ).toBe('INVALID_INPUT');
    expect(code(await relate(owner, { projectId: a.id, relatedProjectId: a.id }))).toBe(
      'INVALID_INPUT',
    );
    expect(
      (await relate(owner, { projectId: a.id, relatedProjectId: b.id })).body.errors,
    ).toBeUndefined();
    expect(code(await relate(owner, { projectId: a.id, relatedProjectId: b.id }))).toBe('CONFLICT');
  });

  it('refuses a cycle of dependencies', async () => {
    const { owner, a, b, c } = await setup();
    expect(
      (await relate(owner, { projectId: a.id, relatedProjectId: b.id })).body.errors,
    ).toBeUndefined();
    // B → A closes a two-project loop, whatever the anchors.
    const back = await relate(owner, {
      projectId: b.id,
      anchorType: 'start',
      relatedProjectId: a.id,
      relatedAnchorType: 'end',
    });
    expect(code(back)).toBe('INVALID_INPUT');
    expect(
      (await relate(owner, { projectId: b.id, relatedProjectId: c.id })).body.errors,
    ).toBeUndefined();
    expect(code(await relate(owner, { projectId: c.id, relatedProjectId: a.id }))).toBe(
      'INVALID_INPUT',
    );
  });

  it('hides a relation whose other project the viewer cannot see', async () => {
    const { owner, a } = await setup();
    const sec = await createTeam(owner, { key: 'SEC', private: true });
    const hidden = await createProject(owner, { name: 'Hidden', teamIds: [sec.team.id] });
    const created = await relate(owner, { projectId: a.id, relatedProjectId: hidden.id });
    expect(created.body.errors).toBeUndefined();
    const id = (created.body.data as Data).projectRelationCreate.projectRelation.id;

    const member = await signUpAs('member');
    const all = await gqlData(member, `{ projectRelations { nodes { id } } }`);
    expect(all.projectRelations.nodes).toEqual([]);
    const fromA = await gqlData(member, SIDES, { id: a.id });
    expect(fromA.project.relations.nodes).toEqual([]);
    const one = await gql(
      { cookie: member.cookie },
      `query ($id: String!) { projectRelation(id: $id) { id } }`,
      {
        id,
      },
    );
    expect(code(one)).toBe('ENTITY_NOT_FOUND');
    // Creating against the hidden project is refused as not found.
    expect(code(await relate(member, { projectId: a.id, relatedProjectId: hidden.id }))).toBe(
      'ENTITY_NOT_FOUND',
    );
  });

  it('guests read relations but cannot create, update or delete them', async () => {
    const { owner, eng, a, b } = await setup();
    const guest = await signUpAs('guest');
    await gqlData(
      owner,
      `mutation ($input: TeamMembershipCreateInput!) { teamMembershipCreate(input: $input) { success } }`,
      { input: { teamId: eng.team.id, userId: guest.userId } },
    );
    const created = await relate(owner, { projectId: a.id, relatedProjectId: b.id });
    const id = (created.body.data as Data).projectRelationCreate.projectRelation.id;

    const read = await gqlData(guest, `{ projectRelations { nodes { id } } }`);
    expect(read.projectRelations.nodes).toEqual([{ id }]);
    expect(code(await relate(guest, { projectId: b.id, relatedProjectId: a.id }))).toBe(
      'FORBIDDEN',
    );
    const del = await gql(
      { cookie: guest.cookie },
      `mutation ($id: String!) { projectRelationDelete(id: $id) { success } }`,
      {
        id,
      },
    );
    expect(code(del)).toBe('FORBIDDEN');
  });

  const UPDATE = `mutation ($id: String!, $input: ProjectRelationUpdateInput!) {
    projectRelationUpdate(id: $id, input: $input) { projectRelation { id project { id } relatedProject { id } } } }`;

  it('reverses a relation in place without a false cycle', async () => {
    const { owner, a, b } = await setup();
    const created = await relate(owner, { projectId: a.id, relatedProjectId: b.id });
    const id = (created.body.data as Data).projectRelationCreate.projectRelation.id;
    const res = await gql({ cookie: owner.cookie }, UPDATE, {
      id,
      input: { projectId: b.id, relatedProjectId: a.id },
    });
    expect(res.body.errors).toBeUndefined();
    expect((res.body.data as Data).projectRelationUpdate.projectRelation).toEqual({
      id,
      project: { id: b.id },
      relatedProject: { id: a.id },
    });
  });

  it('refuses a guest update and an update to a project the user cannot see', async () => {
    const { owner, eng, a, b } = await setup();
    const created = await relate(owner, { projectId: a.id, relatedProjectId: b.id });
    const id = (created.body.data as Data).projectRelationCreate.projectRelation.id;

    const guest = await signUpAs('guest');
    await gqlData(
      owner,
      `mutation ($input: TeamMembershipCreateInput!) { teamMembershipCreate(input: $input) { success } }`,
      { input: { teamId: eng.team.id, userId: guest.userId } },
    );
    const byGuest = await gql({ cookie: guest.cookie }, UPDATE, {
      id,
      input: { anchorType: 'start' },
    });
    expect(code(byGuest)).toBe('FORBIDDEN');

    const sec = await createTeam(owner, { key: 'SEC', private: true });
    const hidden = await createProject(owner, { name: 'Hidden', teamIds: [sec.team.id] });
    const member = await signUpAs('member');
    const toHidden = await gql({ cookie: member.cookie }, UPDATE, {
      id,
      input: { relatedProjectId: hidden.id },
    });
    expect(code(toHidden)).toBe('ENTITY_NOT_FOUND');
  });

  it('refuses a relation to an archived or trashed project', async () => {
    const { owner, a, b, c } = await setup();
    await gqlData(owner, `mutation ($id: String!) { projectArchive(id: $id) { success } }`, {
      id: b.id,
    });
    await gqlData(owner, `mutation ($id: String!) { projectDelete(id: $id) { success } }`, {
      id: c.id,
    });
    expect(code(await relate(owner, { projectId: a.id, relatedProjectId: b.id }))).toBe(
      'INVALID_INPUT',
    );
    expect(code(await relate(owner, { projectId: c.id, relatedProjectId: a.id }))).toBe(
      'INVALID_INPUT',
    );
  });

  it('reports a reused id as a used id, not as a duplicate dependency', async () => {
    const { owner, a, b, c } = await setup();
    const id = crypto.randomUUID();
    expect(
      (await relate(owner, { id, projectId: a.id, relatedProjectId: b.id })).body.errors,
    ).toBeUndefined();
    const again = await relate(owner, { id, projectId: a.id, relatedProjectId: c.id });
    expect(code(again)).toBe('CONFLICT');
    expect(again.body.errors?.[0]?.message).toContain('id');
    expect(again.body.errors?.[0]?.message).not.toContain('already have this dependency');
  });

  it('updates the anchors and deletes a relation', async () => {
    const { owner, a, b } = await setup();
    const created = await relate(owner, { projectId: a.id, relatedProjectId: b.id });
    const id = (created.body.data as Data).projectRelationCreate.projectRelation.id;

    const updated = await gqlData(
      owner,
      `mutation ($id: String!, $input: ProjectRelationUpdateInput!) {
        projectRelationUpdate(id: $id, input: $input) { projectRelation { anchorType relatedAnchorType } } }`,
      { id, input: { anchorType: 'start', relatedAnchorType: 'end' } },
    );
    expect(updated.projectRelationUpdate.projectRelation).toEqual({
      anchorType: 'start',
      relatedAnchorType: 'end',
    });

    const deleted = await gqlData(
      owner,
      `mutation ($id: String!) { projectRelationDelete(id: $id) { success entityId } }`,
      { id },
    );
    expect(deleted.projectRelationDelete).toEqual({ success: true, entityId: id });
    const all = await gqlData(owner, `{ projectRelations { nodes { id } } }`);
    expect(all.projectRelations.nodes).toEqual([]);
  });

  it('deleting the anchoring milestone removes the relation', async () => {
    const { owner, a, b } = await setup();
    const ma = await milestone(owner, a.id, 'Beta');
    const created = await relate(owner, {
      projectId: a.id,
      anchorType: 'milestone',
      projectMilestoneId: ma,
      relatedProjectId: b.id,
    });
    expect(created.body.errors).toBeUndefined();
    await gqlData(
      owner,
      `mutation ($id: String!) { projectMilestoneDelete(id: $id) { success } }`,
      {
        id: ma,
      },
    );
    const all = await gqlData(owner, `{ projectRelations { nodes { id } } }`);
    expect(all.projectRelations.nodes).toEqual([]);
  });

  it('archiving a project hides its relations until it is restored', async () => {
    const { owner, a, b } = await setup();
    const created = await relate(owner, { projectId: a.id, relatedProjectId: b.id });
    const id = (created.body.data as Data).projectRelationCreate.projectRelation.id;

    await gqlData(owner, `mutation ($id: String!) { projectArchive(id: $id) { success } }`, {
      id: b.id,
    });
    const hidden = await gqlData(owner, `{ projectRelations { nodes { id } } }`);
    expect(hidden.projectRelations.nodes).toEqual([]);
    const fromA = await gqlData(owner, SIDES, { id: a.id });
    expect(fromA.project.relations.nodes).toEqual([]);

    await gqlData(owner, `mutation ($id: String!) { projectUnarchive(id: $id) { success } }`, {
      id: b.id,
    });
    const back = await gqlData(owner, `{ projectRelations { nodes { id } } }`);
    expect(back.projectRelations.nodes).toEqual([{ id }]);
  });
});

describe('projects view preferences', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('stores a personal record for the projects list', async () => {
    const a = await signUpTestUser();
    const created = await gqlData(
      a,
      `mutation ($input: ViewPreferencesCreateInput!) {
        viewPreferencesCreate(input: $input) { viewPreferences { viewType preferences { layout } } } }`,
      { input: { type: 'user', viewType: 'projects', preferences: { layout: 'timeline' } } },
    );
    expect(created.viewPreferencesCreate.viewPreferences).toEqual({
      viewType: 'projects',
      preferences: { layout: 'timeline' },
    });
    const read = await gqlData(
      a,
      `query { userViewPreferences(viewType: projects) { viewType preferences { layout } } }`,
    );
    expect(read.userViewPreferences.preferences.layout).toBe('timeline');
  });
});
