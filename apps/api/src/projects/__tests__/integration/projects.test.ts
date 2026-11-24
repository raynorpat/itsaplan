import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createIssue,
  createTeam,
  gqlData,
  signUpAs,
  statesByType,
  teamView,
  type As,
  type Data,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';

// Projects (Linear's Project) group issues across one or more teams. Issues link to
// one through projectId and must belong to one of its teams; progress comes from
// the linked issues' states.

const MISSING = '00000000-0000-4000-8000-000000000000';
const PROJECT =
  'id name slugId priority health progress archivedAt status { type } lead { id } teams { nodes { key } }';

type Res = Awaited<ReturnType<typeof gql>>;
const code = (res: Res) => res.body.errors?.[0]?.extensions?.code;
const dataOf = (res: Res) => res.body.data as Data;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const view = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const states = statesByType(view);
  return {
    owner,
    teamId: view.team.id,
    stateId: view.states[0]!.id,
    doneId: states.completed!,
  };
}

const teamIdOf = async (as: As, key: string) => (await teamView(as, key)).team.id;

async function statusId(as: As, type: string): Promise<string> {
  const data = await gqlData(as, '{ projectStatuses { nodes { id type } } }');
  return data.projectStatuses.nodes.find((s: { type: string }) => s.type === type).id;
}

// projectCreate with team keys; returns the raw response.
async function create(u: TestUser, input: Record<string, unknown>, teamKeys = ['MKT']) {
  const teamIds = await Promise.all(teamKeys.map((k) => teamIdOf(u, k)));
  return gql(
    { cookie: u.cookie },
    `mutation ($input: ProjectCreateInput!) { projectCreate(input: $input) { project { ${PROJECT} } } }`,
    { input: { teamIds, ...input } },
  );
}

async function created(u: TestUser, input: Record<string, unknown>, teamKeys = ['MKT']) {
  const res = await create(u, input, teamKeys);
  if (res.body.errors) throw new Error(res.body.errors[0]!.message);
  return dataOf(res).projectCreate.project;
}

const getProject = (u: TestUser, id: string) =>
  gql({ cookie: u.cookie }, `query ($id: String!) { project(id: $id) { ${PROJECT} } }`, { id });

async function teamProjects(u: TestUser, key: string, includeArchived = false) {
  const data = await gqlData(
    u,
    `query ($id: String!, $a: Boolean) { team(id: $id) { projects(includeArchived: $a) { nodes { id name } } } }`,
    { id: key, a: includeArchived },
  );
  return data.team.projects.nodes as { id: string; name: string }[];
}

async function visibleProjects(u: TestUser) {
  return (await gqlData(u, '{ projects { nodes { id } } }')).projects.nodes as { id: string }[];
}

function linkIssue(u: TestUser, issueId: string, projectId: string | null) {
  return gql(
    { cookie: u.cookie },
    `mutation ($id: String!, $p: String) { issueUpdate(id: $id, input: { projectId: $p }) { success } }`,
    { id: issueId, p: projectId },
  );
}

const mutate = (u: TestUser, mutation: string, vars: Record<string, unknown>) =>
  gql({ cookie: u.cookie }, mutation, vars);

describe('projects', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('create', () => {
    it('creates a project with defaults and lists it under its team', async () => {
      const { owner } = await setup();
      const p = await created(owner, { name: 'Q3 Launch' });
      expect(p).toMatchObject({
        name: 'Q3 Launch',
        status: { type: 'backlog' },
        lead: null,
        priority: 0,
        progress: 0,
        health: null,
      });
      expect((await teamProjects(owner, 'MKT')).map((x) => x.name)).toEqual(['Q3 Launch']);
    });

    it('stores the provided fields', async () => {
      const { owner } = await setup();
      const p = await created(owner, {
        name: 'Growth',
        statusId: await statusId(owner, 'started'),
        priority: 2,
        targetDate: '2026-09-01',
      });
      expect(p).toMatchObject({ status: { type: 'started' }, priority: 2 });
      const read = await gqlData(
        owner,
        `query ($id: String!) { project(id: $id) { targetDate } }`,
        {
          id: p.id,
        },
      );
      expect(read.project.targetDate).toBe('2026-09-01');
    });

    it('rejects an empty name', async () => {
      const { owner } = await setup();
      expect(code(await create(owner, { name: '' }))).toBe('INVALID_INPUT');
    });

    it('rejects an unknown status', async () => {
      const { owner } = await setup();
      expect(code(await create(owner, { name: 'X', statusId: MISSING }))).toBe('INVALID_INPUT');
    });

    it('rejects a lead from outside the teams before creating', async () => {
      const { owner } = await setup();
      const outsider = await signUpTestUser({ name: 'Outsider' });
      expect(code(await create(owner, { name: 'Bad lead', leadId: outsider.userId }))).toBe(
        'INVALID_INPUT',
      );
      expect(await teamProjects(owner, 'MKT')).toHaveLength(0);
    });

    it('rejects an unknown label before creating', async () => {
      const { owner } = await setup();
      expect(code(await create(owner, { name: 'Bad label', labelIds: [MISSING] }))).toBe(
        'INVALID_INPUT',
      );
      expect(await teamProjects(owner, 'MKT')).toHaveLength(0);
    });

    it('rejects a priority outside 0..4', async () => {
      const { owner } = await setup();
      expect(code(await create(owner, { name: 'x', priority: 5 }))).toBe('INVALID_INPUT');
    });

    it('gives each project a unique 12-hex slugId', async () => {
      const { owner } = await setup();
      const a = await created(owner, { name: 'A' });
      const b = await created(owner, { name: 'B' });
      expect(a.slugId).toMatch(/^[0-9a-f]{12}$/);
      expect(a.slugId).not.toBe(b.slugId);
    });
  });

  describe('read and update', () => {
    it('matches the name case-insensitively', async () => {
      const { owner } = await setup();
      await created(owner, { name: 'Growth loops' });
      await created(owner, { name: 'Billing' });
      const data = await gqlData(
        owner,
        '{ projects(filter: { name: { containsIgnoreCase: "GROWTH" } }) { nodes { name } } }',
      );
      expect(data.projects.nodes.map((p: { name: string }) => p.name)).toEqual(['Growth loops']);
    });

    it('answers not found for a missing project', async () => {
      const { owner } = await setup();
      expect(code(await getProject(owner, MISSING))).toBe('ENTITY_NOT_FOUND');
    });

    it('answers not found when updating a missing project', async () => {
      const { owner } = await setup();
      const res = await mutate(
        owner,
        `mutation ($id: String!) { projectUpdate(id: $id, input: { name: "x" }) { success } }`,
        { id: MISSING },
      );
      expect(code(res)).toBe('ENTITY_NOT_FOUND');
    });

    it('archives a project out of the list and unarchives it', async () => {
      const { owner } = await setup();
      const p = await created(owner, { name: 'Old' });
      await gqlData(owner, `mutation ($id: String!) { projectArchive(id: $id) { success } }`, {
        id: p.id,
      });
      expect(await teamProjects(owner, 'MKT')).toHaveLength(0);
      expect((await teamProjects(owner, 'MKT', true)).map((x) => x.id)).toEqual([p.id]);
      await gqlData(owner, `mutation ($id: String!) { projectUnarchive(id: $id) { success } }`, {
        id: p.id,
      });
      expect(await teamProjects(owner, 'MKT')).toHaveLength(1);
    });

    it('deletes the project but keeps its linked issues, unlinked', async () => {
      const { owner, teamId, stateId } = await setup();
      const p = await created(owner, { name: 'Q3' });
      const issue = await createIssue(owner, { teamId, stateId, projectId: p.id });
      await gqlData(owner, `mutation ($id: String!) { projectDelete(id: $id) { success } }`, {
        id: p.id,
      });
      expect(code(await getProject(owner, p.id))).toBe('ENTITY_NOT_FOUND');
      const read = await gqlData(
        owner,
        `query ($id: String!) { issue(id: $id) { project { id } } }`,
        {
          id: issue.id,
        },
      );
      expect(read.issue.project).toBeNull();
    });
  });

  describe('linked issues and progress', () => {
    it('reflects completion of linked issues in progress', async () => {
      const { owner, teamId, stateId, doneId } = await setup();
      const p = await created(owner, { name: 'Q3' });
      const a = await createIssue(owner, { teamId, stateId, title: 'A', projectId: p.id });
      await createIssue(owner, { teamId, stateId, title: 'B', projectId: p.id });
      expect(dataOf(await getProject(owner, p.id)).project.progress).toBe(0);
      await gqlData(
        owner,
        `mutation ($id: String!, $s: String!) { issueUpdate(id: $id, input: { stateId: $s }) { success } }`,
        { id: a.id, s: doneId },
      );
      expect(dataOf(await getProject(owner, p.id)).project.progress).toBe(0.5);
    });

    it('links and unlinks an issue through issueUpdate', async () => {
      const { owner, teamId, stateId } = await setup();
      const p = await created(owner, { name: 'Q3' });
      const issue = await createIssue(owner, { teamId, stateId });
      const count = async () =>
        (
          await gqlData(
            owner,
            `query ($id: String!) { project(id: $id) { issues { nodes { id } } } }`,
            {
              id: p.id,
            },
          )
        ).project.issues.nodes.length;
      await linkIssue(owner, issue.id, p.id);
      expect(await count()).toBe(1);
      await linkIssue(owner, issue.id, null);
      expect(await count()).toBe(0);
    });

    it("rejects linking an issue to a project without the issue's team", async () => {
      const { owner, teamId, stateId } = await setup();
      await createTeam(owner, { key: 'OPS', name: 'Operations' });
      const other = await created(owner, { name: 'Other' }, ['OPS']);
      const issue = await createIssue(owner, { teamId, stateId });
      expect(code(await linkIssue(owner, issue.id, other.id))).toBe('INVALID_INPUT');
    });

    it('refuses to create an issue in a project without its team', async () => {
      const { owner } = await setup();
      await createTeam(owner, { key: 'OPS', name: 'Operations' });
      const des = await createTeam(owner, { key: 'DES', name: 'Design' });
      const p = await created(owner, { name: 'Shared' }, ['MKT', 'OPS']);
      const res = await mutate(
        owner,
        `mutation ($input: IssueCreateInput!) { issueCreate(input: $input) { success } }`,
        { input: { teamId: des.team.id, stateId: des.states[0]!.id, title: 'x', projectId: p.id } },
      );
      expect(code(res)).toBe('INVALID_INPUT');
    });
  });

  describe('access', () => {
    it('refuses to create a project in a team the user cannot create in', async () => {
      const { owner, teamId } = await setup();
      const guest = await signUpAs('guest');
      const res = await mutate(
        guest,
        `mutation ($input: ProjectCreateInput!) { projectCreate(input: $input) { success } }`,
        { input: { name: 'x', teamIds: [teamId] } },
      );
      expect(code(res)).toBe('FORBIDDEN');
      const unknown = await mutate(
        owner,
        `mutation ($input: ProjectCreateInput!) { projectCreate(input: $input) { success } }`,
        { input: { name: 'x', teamIds: [MISSING] } },
      );
      expect(code(unknown)).toBe('FORBIDDEN');
    });

    it('hides a project from a guest outside its teams', async () => {
      const { owner } = await setup();
      const p = await created(owner, { name: 'Q3' });
      const guest = await signUpAs('guest');
      expect(await visibleProjects(guest)).toHaveLength(0);
      expect(code(await getProject(guest, p.id))).toBe('ENTITY_NOT_FOUND');
      const update = await mutate(
        guest,
        `mutation ($id: String!) { projectUpdate(id: $id, input: { name: "x" }) { success } }`,
        { id: p.id },
      );
      expect(code(update)).toBe('ENTITY_NOT_FOUND');
      const del = await mutate(
        guest,
        `mutation ($id: String!) { projectDelete(id: $id) { success } }`,
        { id: p.id },
      );
      expect(code(del)).toBe('ENTITY_NOT_FOUND');
    });

    it('needs to see every team listed', async () => {
      const { owner } = await setup();
      const other = await signUpAs('member');
      await createTeam(other, { key: 'OPS', name: 'Operations', private: true });
      const opsId = await teamIdOf(other, 'OPS');
      const mktId = await teamIdOf(owner, 'MKT');
      const res = await mutate(
        owner,
        `mutation ($input: ProjectCreateInput!) { projectCreate(input: $input) { success } }`,
        { input: { name: 'x', teamIds: [mktId, opsId] } },
      );
      expect(code(res)).toBe('FORBIDDEN');
    });
  });

  describe('teams', () => {
    it('creates a project in two teams and lists it under both', async () => {
      const { owner } = await setup();
      await createTeam(owner, { key: 'OPS', name: 'Operations' });
      const p = await created(owner, { name: 'Shared' }, ['MKT', 'OPS']);
      expect(p.teams.nodes.map((t: { key: string }) => t.key).sort()).toEqual(['MKT', 'OPS']);
      expect((await teamProjects(owner, 'MKT')).map((x) => x.id)).toEqual([p.id]);
      expect((await teamProjects(owner, 'OPS')).map((x) => x.id)).toEqual([p.id]);
    });

    it('refuses to remove the last team', async () => {
      const { owner } = await setup();
      const p = await created(owner, { name: 'Solo' });
      const res = await mutate(
        owner,
        `mutation ($id: String!) { projectUpdate(id: $id, input: { teamIds: [] }) { success } }`,
        { id: p.id },
      );
      expect(code(res)).toBe('CONFLICT');
    });

    it("deletes a team's own projects with it and keeps shared ones", async () => {
      const { owner } = await setup();
      const ops = await createTeam(owner, { key: 'OPS', name: 'Operations' });
      const own = await created(owner, { name: 'Only OPS' }, ['OPS']);
      const shared = await created(owner, { name: 'Shared' }, ['MKT', 'OPS']);
      await gqlData(owner, `mutation ($id: String!) { teamDelete(id: $id) { success } }`, {
        id: ops.team.id,
      });
      expect(code(await getProject(owner, own.id))).toBe('ENTITY_NOT_FOUND');
      const kept = dataOf(await getProject(owner, shared.id)).project;
      expect(kept.teams.nodes.map((t: { key: string }) => t.key)).toEqual(['MKT']);
    });

    it('requires the lead to be a member of one of the teams', async () => {
      const { owner } = await setup();
      await createTeam(owner, { key: 'OPS', name: 'Operations' });
      const opsMember = await signUpTestUser();
      await addMember(owner, 'OPS', opsMember.userId);
      const ok = await create(owner, { name: 'A', leadId: opsMember.userId }, ['MKT', 'OPS']);
      expect(ok.body.errors).toBeUndefined();
      const outsider = await signUpTestUser();
      expect(code(await create(owner, { name: 'B', leadId: outsider.userId }))).toBe(
        'INVALID_INPUT',
      );
    });
  });
});
