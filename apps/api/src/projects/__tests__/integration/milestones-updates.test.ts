import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { signUpWithRole } from '../../../__tests__/helpers/roles';
import { createMilestone } from '../../milestones';
import { createUpdate } from '../../updates';

// Milestones and updates have no REST write routes (GraphQL only); these tests
// create them through the store and check their effect through REST.

async function setup() {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const view = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!;
  const project = (await asOwner.projects.post({ name: 'Launch', teamIds: [view.team.id] })).data!;
  const issue = (
    await asOwner
      .teams({ teamKey: 'MKT' })
      .issues.post({ stateId: view.states[0].id, title: 'Task', projectId: project.id })
  ).data!;
  return { owner, asOwner, teamId: view.team.id, project, issue };
}

describe('project milestones and updates', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("puts an issue in one of its project's milestones", async () => {
    const { asOwner, project, issue } = await setup();
    const milestone = await createMilestone(project.id, { name: 'Beta' });
    const res = await asOwner
      .issues({ issueId: issue.id })
      .patch({ projectMilestoneId: milestone.id });
    expect(res.status).toBe(200);
    expect(res.data!.projectMilestoneId).toBe(milestone.id);
  });

  it("refuses another project's milestone", async () => {
    const { asOwner, teamId, issue } = await setup();
    const other = (await asOwner.projects.post({ name: 'Other', teamIds: [teamId] })).data!;
    const foreign = await createMilestone(other.id, { name: 'Elsewhere' });
    const res = await asOwner
      .issues({ issueId: issue.id })
      .patch({ projectMilestoneId: foreign.id });
    expect(res.status).toBe(400);
  });

  it("clears the milestone when the issue's project changes", async () => {
    const { asOwner, teamId, project, issue } = await setup();
    const milestone = await createMilestone(project.id, { name: 'Beta' });
    await asOwner.issues({ issueId: issue.id }).patch({ projectMilestoneId: milestone.id });
    const other = (await asOwner.projects.post({ name: 'Other', teamIds: [teamId] })).data!;
    const moved = await asOwner.issues({ issueId: issue.id }).patch({ projectId: other.id });
    expect(moved.data!.projectMilestoneId).toBeNull();
    const cleared = await asOwner.issues({ issueId: issue.id }).patch({ projectId: null });
    expect(cleared.data!.projectMilestoneId).toBeNull();
  });

  it('takes project health from the latest update, with the computed health alongside', async () => {
    const { owner, asOwner, project } = await setup();
    const before = (await asOwner.projects({ projectId: project.id }).get()).data!;
    expect(before.health).toBeNull();
    await createUpdate(project.id, owner.userId, { body: 'Going well', health: 'onTrack' });
    await Bun.sleep(5);
    await createUpdate(project.id, owner.userId, { body: 'Slipping', health: 'atRisk' });
    const after = (await asOwner.projects({ projectId: project.id }).get()).data!;
    expect(after.health).toBe('atRisk');
    expect(after).toHaveProperty('computedHealth');
  });

  it('lists milestones over REST to members only', async () => {
    const { asOwner, project } = await setup();
    await createMilestone(project.id, { name: 'Beta' });
    const res = await asOwner.projects({ projectId: project.id }).milestones.get();
    expect(res.data!.map((m) => m.name)).toEqual(['Beta']);
    const outsider = (await signUpWithRole('guest')).api;
    expect((await outsider.projects({ projectId: project.id }).milestones.get()).status).toBe(404);
  });
});
