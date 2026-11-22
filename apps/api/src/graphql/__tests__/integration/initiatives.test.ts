import { beforeEach, describe, expect, it } from 'bun:test';
import { InitiativeStatus, InitiativeVisibility } from '@linear/sdk';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';
import { linkProject } from '../../../initiatives/links';

// Initiatives over the Linear API: CRUD, archive / trash, visibility by lead team,
// filters, unsupported input, and the project side (Project.initiatives,
// ProjectFilter.initiatives).

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;
const errorMessage = (res: { body: { errors?: { message?: string }[] } }) =>
  res.body.errors?.[0]?.message ?? '';

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
  const teamId = async (key: string) => (await asOwner.teams({ teamKey: key }).get()).data!.team.id;
  const client = linearClient(await createApiKey(owner.cookie));
  return { owner, asOwner, client, mkt: await teamId('MKT'), ops: await teamId('OPS') };
}

async function memberOf(asOwner: ReturnType<typeof authedApi>, teamKey: string) {
  const user = await signUpTestUser();
  const invite = await asOwner
    .teams({ teamKey })
    .invites.post({ email: user.email, role: 'member' });
  await authedApi(user.cookie).invites({ token: invite.data!.token }).accept.post();
  return { user, client: linearClient(await createApiKey(user.cookie)) };
}

describe('graphql initiatives', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates, reads by id and slug, updates and archives', async () => {
    const { client } = await setup();
    const created = (await (await client.createInitiative({ name: 'Q1' })).initiative)!;
    expect(created).toMatchObject({ name: 'Q1', status: 'Active', visibility: 'public' });
    expect((await client.initiative(created.slugId)).id).toBe(created.id);
    const done = (await (
      await client.updateInitiative(created.id, { status: InitiativeStatus.Completed })
    ).initiative)!;
    expect(done.completedAt).toBeTruthy();
    await client.archiveInitiative(created.id);
    expect((await client.initiatives()).nodes).toHaveLength(0);
    expect((await client.initiatives({ includeArchived: true })).nodes).toHaveLength(1);
    expect((await client.initiative(created.id)).archivedAt).toBeTruthy();
  });

  it('deletes to the trash and unarchives', async () => {
    const { client } = await setup();
    const created = (await (await client.createInitiative({ name: 'Q1' })).initiative)!;
    expect((await client.deleteInitiative(created.id)).entityId).toBe(created.id);
    expect((await client.initiative(created.id)).trashed).toBe(true);
    await client.unarchiveInitiative(created.id);
    const restored = await client.initiative(created.id);
    expect(restored.trashed).toBeFalsy();
    expect(restored.archivedAt).toBeFalsy();
  });

  it('hides lead-team initiatives from non-members', async () => {
    const { asOwner, client, mkt } = await setup();
    const led = (await (await client.createInitiative({ name: 'L', leadTeamId: mkt })).initiative)!;
    expect(led.visibility).toBe(InitiativeVisibility.Private);
    const ops = await memberOf(asOwner, 'OPS');
    const res = await gql({ cookie: ops.user.cookie }, `{ initiative(id: "${led.id}") { id } }`);
    expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
    expect((await ops.client.initiatives()).nodes).toHaveLength(0);
  });

  it('rejects a lead team the caller is not a member of', async () => {
    const { asOwner, mkt } = await setup();
    const ops = await memberOf(asOwner, 'OPS');
    const res = await gql(
      { cookie: ops.user.cookie },
      `mutation { initiativeCreate(input: { name: "X", leadTeamId: "${mkt}" }) { success } }`,
    );
    expect(errorCode(res)).toBe('FORBIDDEN');
  });

  it('filters initiatives', async () => {
    const { owner, client, mkt } = await setup();
    await client.createInitiative({ name: 'P', status: InitiativeStatus.Planned });
    await client.createInitiative({ name: 'O', ownerId: owner.userId });
    await client.createInitiative({ name: 'L', leadTeamId: mkt });
    const names = async (filter: string) => {
      const res = await gql(
        { cookie: owner.cookie },
        `{ initiatives(filter: ${filter}) { nodes { name } } }`,
      );
      return (res.body.data as { initiatives: { nodes: { name: string }[] } }).initiatives.nodes
        .map((n) => n.name)
        .sort();
    };
    expect(await names('{ status: { eq: "Planned" } }')).toEqual(['P']);
    expect(await names('{ owner: { null: true } }')).toEqual(['L', 'P']);
    expect(await names(`{ leadTeam: { id: { eq: "${mkt}" } } }`)).toEqual(['L']);
  });

  it('rejects sort and unsupported input, and accepts empty labelIds', async () => {
    const { owner, client } = await setup();
    const created = (await (await client.createInitiative({ name: 'Q1' })).initiative)!;
    const sorted = await gql(
      { cookie: owner.cookie },
      '{ initiatives(sort: [{ name: { order: Ascending } }]) { nodes { id } } }',
    );
    expect(errorCode(sorted)).toBe('INVALID_INPUT');
    expect(errorMessage(sorted)).toContain('sort');
    const reminders = await gql(
      { cookie: owner.cookie },
      `mutation { initiativeUpdate(id: "${created.id}", input: { updateRemindersDay: Monday }) { success } }`,
    );
    expect(errorCode(reminders)).toBe('INVALID_INPUT');
    expect(errorMessage(reminders)).toContain('updateRemindersDay');
    const labels = await gql(
      { cookie: owner.cookie },
      'mutation { initiativeCreate(input: { name: "X", labelIds: [] }) { success } }',
    );
    expect(labels.body.data).toEqual({ initiativeCreate: { success: true } });
  });

  it('lists initiatives on a project and filters projects by initiative', async () => {
    const { owner, asOwner, client, mkt } = await setup();
    const a = (await (await client.createInitiative({ name: 'A' })).initiative)!;
    const site = (await asOwner.projects.post({ teamIds: [mkt], name: 'Site' })).data!;
    await asOwner.projects.post({ teamIds: [mkt], name: 'Other' });
    await linkProject({ initiativeId: a.id, projectId: site.id }, owner.userId);
    const project = await client.project(site.id);
    expect((await project.initiatives()).nodes.map((i) => i.id)).toEqual([a.id]);
    const res = await gql(
      { cookie: owner.cookie },
      `{ projects(filter: { initiatives: { some: { id: { eq: "${a.id}" } } } }) { nodes { name } } }`,
    );
    expect(res.body.data).toEqual({ projects: { nodes: [{ name: 'Site' }] } });
  });
});
