import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';
import {
  addMember,
  createIssue,
  createTeam,
  makePrivate,
  teamView,
} from '../../../__tests__/helpers/graphql';

// Project, milestone, update and label mutations over the Linear API.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  await createTeam(owner, { key: 'OPS', name: 'Operations' });
  const mkt = await teamView(owner, 'MKT');
  const ops = await teamView(owner, 'OPS');
  const client = linearClient(await createApiKey(owner.cookie));
  return { owner, mkt, ops, client };
}

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

describe('graphql project mutations', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates a project in two teams and updates it', async () => {
    const { mkt, ops, client } = await setup();
    const created = await client.createProject({
      name: 'Launch',
      teamIds: [mkt.team.id, ops.team.id],
      priority: 1,
      color: '#ff0000',
    });
    const project = (await created.project)!;
    expect(project).toMatchObject({ name: 'Launch', priority: 1, color: '#ff0000' });
    expect((await project.teams()).nodes.map((t) => t.key).sort()).toEqual(['MKT', 'OPS']);

    const updated = await client.updateProject(project.id, { name: 'Launch v2', priority: 3 });
    expect((await updated.project)?.name).toBe('Launch v2');
  });

  it('keeps a team the viewer cannot see when replacing teamIds', async () => {
    const { owner, mkt, ops, client } = await setup();
    await makePrivate(owner, 'OPS');
    const project = (await (
      await client.createProject({ name: 'Shared', teamIds: [mkt.team.id, ops.team.id] })
    ).project)!;
    const member = await signUpTestUser();
    await addMember(owner, 'MKT', member.userId);
    const memberClient = linearClient(await createApiKey(member.cookie));

    await memberClient.updateProject(project.id, { teamIds: [mkt.team.id] });
    const seenByOwner = await (await client.project(project.id)).teams();
    expect(seenByOwner.nodes.map((t) => t.key).sort()).toEqual(['MKT', 'OPS']);
  });

  it('refuses to remove a team whose issues are in the project', async () => {
    const { owner, mkt, ops, client } = await setup();
    const project = (await (
      await client.createProject({ name: 'Shared', teamIds: [mkt.team.id, ops.team.id] })
    ).project)!;
    await createIssue(owner, {
      teamId: 'MKT',
      stateId: mkt.states[0]!.id,
      title: 'x',
      projectId: project.id,
    });
    const res = await gql(
      { cookie: owner.cookie },
      `mutation { projectUpdate(id: "${project.id}", input: { teamIds: ["${ops.team.id}"] }) { success } }`,
    );
    expect(errorCode(res)).toBe('CONFLICT');
  });

  it('creates milestones and refuses an issue in another project’s milestone', async () => {
    const { owner, mkt, client } = await setup();
    const a = (await (await client.createProject({ name: 'A', teamIds: [mkt.team.id] })).project)!;
    const b = (await (await client.createProject({ name: 'B', teamIds: [mkt.team.id] })).project)!;
    const milestone = (await (
      await client.createProjectMilestone({ projectId: a.id, name: 'Beta' })
    ).projectMilestone)!;
    expect(milestone.name).toBe('Beta');

    const ok = await client.createIssue({
      teamId: mkt.team.id,
      title: 'In A',
      projectId: a.id,
      projectMilestoneId: milestone.id,
    });
    expect((await (await ok.issue)!.projectMilestone)?.id).toBe(milestone.id);

    const res = await gql(
      { cookie: owner.cookie },
      `mutation { issueCreate(input: { teamId: "${mkt.team.id}", title: "x", projectId: "${b.id}", projectMilestoneId: "${milestone.id}" }) { success } }`,
    );
    expect(errorCode(res)).toBe('INVALID_INPUT');

    const renamed = await client.updateProjectMilestone(milestone.id, { name: 'Beta 2' });
    expect((await renamed.projectMilestone)?.name).toBe('Beta 2');
    expect((await client.deleteProjectMilestone(milestone.id)).success).toBe(true);
  });

  it('posts an update that sets the project health; only the author edits it', async () => {
    const { owner, mkt, client } = await setup();
    const project = (await (
      await client.createProject({ name: 'Launch', teamIds: [mkt.team.id] })
    ).project)!;
    const posted = await client.createProjectUpdate({
      projectId: project.id,
      body: 'Behind',
      health: 'atRisk' as never,
    });
    const update = (await posted.projectUpdate)!;
    expect(String((await client.project(project.id)).health)).toBe('atRisk');

    const member = await signUpTestUser();
    await addMember(owner, 'MKT', member.userId);
    const res = await gql(
      { cookie: member.cookie },
      `mutation { projectUpdateUpdate(id: "${update.id}", input: { body: "mine now" }) { success } }`,
    );
    expect(errorCode(res)).toBe('FORBIDDEN');
  });

  it('creates, updates and deletes project labels and applies one', async () => {
    const { mkt, client } = await setup();
    const label = (await (
      await client.createProjectLabel({ name: 'Q3', color: '#00ff00' })
    ).projectLabel)!;
    const project = (await (
      await client.createProject({ name: 'L', teamIds: [mkt.team.id], labelIds: [label.id] })
    ).project)!;
    expect((await project.labels()).nodes.map((l) => l.name)).toEqual(['Q3']);
    await client.updateProjectLabel(label.id, { name: 'Q4' });
    expect((await client.projectLabel(label.id)).name).toBe('Q4');
    expect((await client.deleteProjectLabel(label.id)).success).toBe(true);
  });

  it('archives, unarchives, trashes and restores a project', async () => {
    const { mkt, client } = await setup();
    const project = (await (
      await client.createProject({ name: 'Old', teamIds: [mkt.team.id] })
    ).project)!;
    await client.archiveProject(project.id);
    expect((await client.project(project.id)).archivedAt).toBeTruthy();
    await client.unarchiveProject(project.id);
    expect((await client.project(project.id)).archivedAt).toBeFalsy();
    expect((await client.deleteProject(project.id)).success).toBe(true);
    const trashed = await client.project(project.id);
    expect(trashed.archivedAt).toBeTruthy();
    expect(trashed.trashed).toBe(true);
    await client.unarchiveProject(project.id);
    expect((await client.project(project.id)).trashed).toBeFalsy();
  });

  it('validates the whole projectUpdate input before changing teams', async () => {
    const { owner, mkt, ops, client } = await setup();
    const project = (await (
      await client.createProject({ name: 'P', teamIds: [mkt.team.id] })
    ).project)!;
    const res = await gql(
      { cookie: owner.cookie },
      `mutation { projectUpdate(id: "${project.id}", input: { teamIds: ["${mkt.team.id}", "${ops.team.id}"], priority: 9 }) { success } }`,
    );
    expect(errorCode(res)).toBe('INVALID_INPUT');
    expect((await (await client.project(project.id)).teams()).nodes.map((t) => t.key)).toEqual([
      'MKT',
    ]);
  });

  it('changes nothing when one issue of a batch cannot join the project', async () => {
    const { owner, mkt, ops, client } = await setup();
    const project = (await (
      await client.createProject({ name: 'MKT only', teamIds: [mkt.team.id] })
    ).project)!;
    const a = (await (await client.createIssue({ teamId: mkt.team.id, title: 'a' })).issue)!;
    const b = (await (await client.createIssue({ teamId: ops.team.id, title: 'b' })).issue)!;
    const res = await gql(
      { cookie: owner.cookie },
      `mutation { issueBatchUpdate(ids: ["${a.id}", "${b.id}"], input: { projectId: "${project.id}" }) { success } }`,
    );
    expect(errorCode(res)).toBe('INVALID_INPUT');
    expect(await (await client.issue(a.id)).project).toBeUndefined();
  });

  it('leaves project status mutations not implemented', async () => {
    const { owner } = await setup();
    const res = await gql(
      { cookie: owner.cookie },
      'mutation { projectStatusCreate(input: { name: "x", type: started, color: "#000", position: 1 }) { success } }',
    );
    expect(errorCode(res)).toBe('NOT_IMPLEMENTED');
  });
});
