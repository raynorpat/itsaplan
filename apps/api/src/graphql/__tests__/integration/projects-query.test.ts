import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';
import { createMilestone } from '../../../projects/milestones';
import { createUpdate } from '../../../projects/updates';

// Linear projects over GraphQL: the SDK's Project fragment, lookups, teams
// visibility, filters, and the project items (status, milestones, updates, labels).

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
  const mkt = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!;
  const ops = (await asOwner.teams({ teamKey: 'OPS' }).get()).data!;
  const client = linearClient(await createApiKey(owner.cookie));
  return { owner, asOwner, mkt, ops, client };
}

function createProject(api: Api, teamIds: string[], body: Record<string, unknown> = {}) {
  return api.projects
    .post({ name: 'Launch', teamIds, ...body } as Parameters<typeof api.projects.post>[0])
    .then((r) => r.data!);
}

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

describe('graphql project queries', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('returns the SDK project fragment by id and by slugId', async () => {
    const { asOwner, mkt, client } = await setup();
    const rest = await createProject(asOwner, [mkt.team.id], { priority: 2, status: 'started' });
    const project = await client.project(rest.id);
    expect(project).toMatchObject({
      id: rest.id,
      name: 'Launch',
      priority: 2,
      slugId: rest.slugId,
    });
    expect(project.priorityLabel).toBe('High');
    expect(project.state).toBe('started');
    expect(project.url).toContain(`/projects/${rest.id}`);
    expect(String((await project.status)?.type)).toBe('started');
    expect((await client.project(rest.slugId)).id).toBe(rest.id);
  });

  it("lists a project's accessible teams only", async () => {
    const { asOwner, mkt, ops } = await setup();
    const rest = await createProject(asOwner, [mkt.team.id, ops.team.id]);
    const member = await signUpTestUser();
    const invite = await asOwner
      .teams({ teamKey: 'MKT' })
      .invites.post({ email: member.email, role: 'member' });
    await authedApi(member.cookie).invites({ token: invite.data!.token }).accept.post();
    const memberClient = linearClient(await createApiKey(member.cookie));

    const seen = await (await memberClient.project(rest.id)).teams();
    expect(seen.nodes.map((t) => t.key)).toEqual(['MKT']);
  });

  it("lists a team's projects and filters by status and team", async () => {
    const { asOwner, mkt, ops, client } = await setup();
    const a = await createProject(asOwner, [mkt.team.id], { name: 'A', status: 'started' });
    await createProject(asOwner, [ops.team.id], { name: 'B' });

    const team = await client.team('MKT');
    expect((await team.projects()).nodes.map((p) => p.id)).toEqual([a.id]);

    const started = await client.projects({ filter: { status: { type: { eq: 'started' } } } });
    expect(started.nodes.map((p) => p.id)).toEqual([a.id]);

    const inMkt = await client.projects({
      filter: { accessibleTeams: { some: { key: { eq: 'MKT' } } } },
    });
    expect(inMkt.nodes.map((p) => p.id)).toEqual([a.id]);
  });

  it("resolves an issue's project and milestone, and a project's issues", async () => {
    const { asOwner, mkt, client } = await setup();
    const rest = await createProject(asOwner, [mkt.team.id]);
    const milestone = await createMilestone(rest.id, { name: 'Beta' });
    const issue = (
      await asOwner.teams({ teamKey: 'MKT' }).issues.post({
        stateId: mkt.states[0].id,
        title: 'Task',
        projectId: rest.id,
        projectMilestoneId: milestone.id,
      })
    ).data!;

    const got = await client.issue(issue.id);
    expect((await got.project)?.id).toBe(rest.id);
    expect((await got.projectMilestone)?.name).toBe('Beta');

    const project = await client.project(rest.id);
    expect((await project.issues()).nodes.map((i) => i.id)).toEqual([issue.id]);
    expect((await project.projectMilestones()).nodes.map((m) => m.name)).toEqual(['Beta']);
  });

  it('takes health from the latest update and lists updates', async () => {
    const { owner, asOwner, mkt, client } = await setup();
    const rest = await createProject(asOwner, [mkt.team.id]);
    await createUpdate(rest.id, owner.userId, { body: 'ok', health: 'onTrack' });
    await Bun.sleep(5);
    await createUpdate(rest.id, owner.userId, { body: 'late', health: 'offTrack' });
    const project = await client.project(rest.id);
    expect(String(project.health)).toBe('offTrack');
    expect((await project.projectUpdates()).nodes.map((u) => u.body)).toEqual(['late', 'ok']);
  });

  it('lists the six project statuses and the project labels', async () => {
    const { asOwner, client } = await setup();
    await asOwner['project-labels'].post({ name: 'Q3' });
    expect((await client.projectStatuses()).nodes).toHaveLength(6);
    expect((await client.projectLabels()).nodes.map((l) => l.name)).toEqual(['Q3']);
  });

  it('hides a project from a non-member', async () => {
    const { asOwner, mkt } = await setup();
    const rest = await createProject(asOwner, [mkt.team.id]);
    const outsider = await signUpTestUser();
    const res = await gql({ cookie: outsider.cookie }, `{ project(id: "${rest.id}") { id } }`);
    expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
  });
});
