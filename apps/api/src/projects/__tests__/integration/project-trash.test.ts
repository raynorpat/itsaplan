import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createIssue, createTeam, gqlData, type As } from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { purgeTrashedProjects } from '../../store';

// Linear's projectDelete moves a project to the trash (archived and trashed);
// projectUnarchive restores it; the worker deletes a project 30 days after it was
// trashed. A project archived with projectArchive is never purged.

const DAY_MS = 24 * 60 * 60 * 1000;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const view = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  return { owner, teamId: view.team.id, stateId: view.states[0]!.id };
}

async function newProject(as: As, teamId: string, extra: Record<string, unknown> = {}) {
  const data = await gqlData(
    as,
    `mutation ($input: ProjectCreateInput!) { projectCreate(input: $input) { project { id } } }`,
    { input: { name: 'Q3', teamIds: [teamId], ...extra } },
  );
  return data.projectCreate.project.id as string;
}

const run = (as: As, mutation: string, id: string) =>
  gqlData(as, `mutation ($id: String!) { ${mutation}(id: $id) { success } }`, { id });

const readProject = (as: { cookie: string }, id: string) =>
  gql(
    { cookie: as.cookie },
    `query ($id: String!) { project(id: $id) { id archivedAt trashed members { nodes { id } } projectMilestones { nodes { id } } } }`,
    { id },
  );

async function listedIds(as: As, includeArchived = false): Promise<string[]> {
  const data = await gqlData(
    as,
    `query ($a: Boolean) { projects(includeArchived: $a) { nodes { id } } }`,
    { a: includeArchived },
  );
  return data.projects.nodes.map((n: { id: string }) => n.id);
}

describe('project trash', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('moves a deleted project to the trash, out of the list', async () => {
    const { owner, teamId } = await setup();
    const id = await newProject(owner, teamId);
    await run(owner, 'projectDelete', id);
    const res = await readProject(owner, id);
    expect(res.body.errors).toBeUndefined();
    const p = (res.body.data as { project: { archivedAt: string | null; trashed: boolean } })
      .project;
    expect(p.archivedAt).toBeTruthy();
    expect(p.trashed).toBe(true);
    expect(await listedIds(owner)).toEqual([]);
    expect(await listedIds(owner, true)).toEqual([id]);
  });

  it('restores a trashed project with its members and milestones', async () => {
    const { owner, teamId } = await setup();
    const id = await newProject(owner, teamId, { memberIds: [owner.userId] });
    await gqlData(
      owner,
      `mutation ($input: ProjectMilestoneCreateInput!) { projectMilestoneCreate(input: $input) { success } }`,
      { input: { projectId: id, name: 'Beta' } },
    );
    await run(owner, 'projectDelete', id);
    await run(owner, 'projectUnarchive', id);
    const p = (
      (await readProject(owner, id)).body.data as {
        project: {
          archivedAt: string | null;
          trashed: boolean | null;
          members: { nodes: unknown[] };
          projectMilestones: { nodes: unknown[] };
        };
      }
    ).project;
    expect(p.archivedAt).toBeNull();
    expect(p.trashed).toBeNull();
    expect(p.members.nodes).toHaveLength(1);
    expect(p.projectMilestones.nodes).toHaveLength(1);
    expect(await listedIds(owner)).toEqual([id]);
  });

  it('keeps the project link of its issues while it is in the trash', async () => {
    const { owner, teamId, stateId } = await setup();
    const id = await newProject(owner, teamId);
    const issue = await createIssue(owner, { teamId, stateId, projectId: id });
    await run(owner, 'projectDelete', id);
    const read = await gqlData(
      owner,
      `query ($id: String!) { issue(id: $id) { project { id } } }`,
      {
        id: issue.id,
      },
    );
    expect(read.issue.project).toEqual({ id });
  });

  it('purges projects trashed more than 30 days ago and unlinks their issues', async () => {
    const { owner, teamId, stateId } = await setup();
    const id = await newProject(owner, teamId);
    const issue = await createIssue(owner, { teamId, stateId, projectId: id });
    await run(owner, 'projectDelete', id);
    expect(await purgeTrashedProjects(new Date(Date.now() + 29 * DAY_MS))).toBe(0);
    expect((await readProject(owner, id)).body.errors).toBeUndefined();
    expect(await purgeTrashedProjects(new Date(Date.now() + 31 * DAY_MS))).toBe(1);
    const gone = await readProject(owner, id);
    expect(gone.body.errors?.[0]?.extensions?.code).toBe('ENTITY_NOT_FOUND');
    const read = await gqlData(
      owner,
      `query ($id: String!) { issue(id: $id) { project { id } } }`,
      {
        id: issue.id,
      },
    );
    expect(read.issue.project).toBeNull();
  });

  it('never purges a project that is only archived', async () => {
    const { owner, teamId } = await setup();
    const id = await newProject(owner, teamId);
    await run(owner, 'projectArchive', id);
    expect(await purgeTrashedProjects(new Date(Date.now() + 365 * DAY_MS))).toBe(0);
    expect((await readProject(owner, id)).body.errors).toBeUndefined();
  });
});
