import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  createIssue,
  createProject,
  createTeam,
  gqlData,
  signUpAs,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { createMilestone } from '../../milestones';
import { createUpdate } from '../../updates';

// Milestones and updates created through the store, checked through GraphQL.

const code = (res: Awaited<ReturnType<typeof gql>>) => res.body.errors?.[0]?.extensions?.code;

async function setup() {
  const owner = await signUpTestUser();
  const view = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const project = await createProject(owner, { name: 'Launch', teamIds: [view.team.id] });
  const issue = await createIssue(owner, {
    teamId: view.team.id,
    stateId: view.states[0]!.id,
    title: 'Task',
    projectId: project.id,
  });
  return { owner, teamId: view.team.id, project, issue };
}

function update(u: TestUser, id: string, input: Record<string, unknown>) {
  return gql(
    { cookie: u.cookie },
    `mutation ($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { issue { projectMilestone { id } } } }`,
    { id, input },
  );
}

const milestoneOf = (res: Awaited<ReturnType<typeof gql>>) =>
  (res.body.data as { issueUpdate: { issue: { projectMilestone: { id: string } | null } } })
    .issueUpdate.issue.projectMilestone;

const healthOf = async (u: TestUser, id: string) =>
  (await gqlData(u, `query ($id: String!) { project(id: $id) { health } }`, { id })).project.health;

describe('project milestones and updates', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("puts an issue in one of its project's milestones", async () => {
    const { owner, project, issue } = await setup();
    const milestone = await createMilestone(project.id, { name: 'Beta' });
    const res = await update(owner, issue.id, { projectMilestoneId: milestone.id });
    expect(milestoneOf(res)?.id).toBe(milestone.id);
  });

  it("refuses another project's milestone", async () => {
    const { owner, teamId, issue } = await setup();
    const other = await createProject(owner, { name: 'Other', teamIds: [teamId] });
    const foreign = await createMilestone(other.id, { name: 'Elsewhere' });
    expect(code(await update(owner, issue.id, { projectMilestoneId: foreign.id }))).toBe(
      'INVALID_INPUT',
    );
  });

  it("clears the milestone when the issue's project changes", async () => {
    const { owner, teamId, project, issue } = await setup();
    const milestone = await createMilestone(project.id, { name: 'Beta' });
    await update(owner, issue.id, { projectMilestoneId: milestone.id });
    const other = await createProject(owner, { name: 'Other', teamIds: [teamId] });
    expect(milestoneOf(await update(owner, issue.id, { projectId: other.id }))).toBeNull();
    expect(milestoneOf(await update(owner, issue.id, { projectId: null }))).toBeNull();
  });

  it('takes project health from the latest update', async () => {
    const { owner, project } = await setup();
    expect(await healthOf(owner, project.id)).toBeNull();
    await createUpdate(project.id, owner.userId, { body: 'Going well', health: 'onTrack' });
    await Bun.sleep(5);
    await createUpdate(project.id, owner.userId, { body: 'Slipping', health: 'atRisk' });
    expect(await healthOf(owner, project.id)).toBe('atRisk');
  });

  it('lists milestones to people who can see the project only', async () => {
    const { owner, project } = await setup();
    await createMilestone(project.id, { name: 'Beta' });
    const q = `query ($id: String!) { project(id: $id) { projectMilestones { nodes { name } } } }`;
    const data = await gqlData(owner, q, { id: project.id });
    expect(data.project.projectMilestones.nodes.map((m: { name: string }) => m.name)).toEqual([
      'Beta',
    ]);
    const outsider = await signUpAs('guest');
    expect(code(await gql({ cookie: outsider.cookie }, q, { id: project.id }))).toBe(
      'ENTITY_NOT_FOUND',
    );
  });
});
