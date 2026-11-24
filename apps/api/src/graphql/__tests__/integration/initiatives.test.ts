import { beforeEach, describe, expect, it } from 'bun:test';
import { InitiativeStatus, InitiativeUpdateHealthType, InitiativeVisibility } from '@linear/sdk';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';
import { linkProject } from '../../../initiatives/links';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';
import {
  addMember,
  createProject,
  createTeam,
  createWebhook,
  makePrivate,
  signUpAs,
  teamView,
} from '../../../__tests__/helpers/graphql';

// Initiatives over the Linear API: CRUD, archive / trash, visibility by lead team,
// filters, unsupported input, and the project side (Project.initiatives,
// ProjectFilter.initiatives).

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;
const errorMessage = (res: { body: { errors?: { message?: string }[] } }) =>
  res.body.errors?.[0]?.message ?? '';

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  await createTeam(owner, { key: 'OPS', name: 'Operations' });
  const teamId = async (key: string) => (await teamView(owner, key)).team.id;
  const client = linearClient(await createApiKey(owner.cookie));
  return { owner, client, mkt: await teamId('MKT'), ops: await teamId('OPS') };
}

async function memberOf(owner: TestUser, teamKey: string) {
  const user = await signUpTestUser();
  await addMember(owner, teamKey, user.userId);
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
    const { owner, client, mkt } = await setup();
    await makePrivate(owner, 'MKT');
    const led = (await (await client.createInitiative({ name: 'L', leadTeamId: mkt })).initiative)!;
    expect(led.visibility).toBe(InitiativeVisibility.Private);
    const ops = await memberOf(owner, 'OPS');
    const res = await gql({ cookie: ops.user.cookie }, `{ initiative(id: "${led.id}") { id } }`);
    expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
    expect((await ops.client.initiatives()).nodes).toHaveLength(0);
  });

  it('rejects a lead team the caller cannot see', async () => {
    const { owner, mkt } = await setup();
    await makePrivate(owner, 'MKT');
    const ops = await memberOf(owner, 'OPS');
    const res = await gql(
      { cookie: ops.user.cookie },
      `mutation { initiativeCreate(input: { name: "X", leadTeamId: "${mkt}" }) { success } }`,
    );
    expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
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
    const { owner, client, mkt } = await setup();
    const a = (await (await client.createInitiative({ name: 'A' })).initiative)!;
    const site = await createProject(owner, { teamIds: [mkt], name: 'Site' });
    await createProject(owner, { teamIds: [mkt], name: 'Other' });
    await linkProject({ initiativeId: a.id, projectId: site.id }, owner.userId);
    const project = await client.project(site.id);
    expect((await project.initiatives()).nodes.map((i) => i.id)).toEqual([a.id]);
    const res = await gql(
      { cookie: owner.cookie },
      `{ projects(filter: { initiatives: { some: { id: { eq: "${a.id}" } } } }) { nodes { name } } }`,
    );
    expect(res.body.data).toEqual({ projects: { nodes: [{ name: 'Site' }] } });
  });

  it('links projects and lists them through sub-initiatives', async () => {
    const { owner, client, mkt } = await setup();
    const a = (await (await client.createInitiative({ name: 'A' })).initiative)!;
    const b = (await (await client.createInitiative({ name: 'B' })).initiative)!;
    const p1 = await createProject(owner, { teamIds: [mkt], name: 'P1' });
    const p2 = await createProject(owner, { teamIds: [mkt], name: 'P2' });
    await client.createInitiativeToProject({ initiativeId: a.id, projectId: p1.id });
    await client.createInitiativeToProject({ initiativeId: b.id, projectId: p2.id });
    const relation = (await (
      await client.createInitiativeRelation({ initiativeId: a.id, relatedInitiativeId: b.id })
    ).initiativeRelation)!;
    expect((await relation.relatedInitiative)?.id).toBe(b.id);
    const parent = await client.initiative(a.id);
    expect((await parent.projects()).nodes.map((p) => p.name).sort()).toEqual(['P1', 'P2']);
    expect(
      (await parent.projects({ includeSubInitiatives: false })).nodes.map((p) => p.name),
    ).toEqual(['P1']);
    expect((await (await client.initiative(b.id)).parentInitiative)?.id).toBe(a.id);
    expect((await parent.subInitiatives()).nodes.map((i) => i.id)).toEqual([b.id]);
    expect((await client.initiativeToProjects()).nodes).toHaveLength(2);
    expect((await client.initiativeRelations()).nodes).toHaveLength(1);
  });

  it('rejects a duplicate link, a hidden project and a loop', async () => {
    const { owner, client, mkt } = await setup();
    const a = (await (await client.createInitiative({ name: 'A' })).initiative)!;
    const b = (await (await client.createInitiative({ name: 'B' })).initiative)!;
    const p1 = await createProject(owner, { teamIds: [mkt], name: 'P1' });
    await client.createInitiativeToProject({ initiativeId: a.id, projectId: p1.id });
    const link = (projectId: string) =>
      gql(
        { cookie: owner.cookie },
        `mutation { initiativeToProjectCreate(input: { initiativeId: "${a.id}", projectId: "${projectId}" }) { success } }`,
      );
    expect(errorCode(await link(p1.id))).toBe('INVALID_INPUT');
    const stranger = await signUpAs('member');
    await createTeam(stranger, { key: 'SEC', name: 'Secret', visibility: 'private' });
    const sec = (await teamView(stranger, 'SEC')).team.id;
    const hidden = await createProject(stranger, { teamIds: [sec], name: 'Hidden' });
    expect(errorCode(await link(hidden.id))).toBe('ENTITY_NOT_FOUND');
    await client.createInitiativeRelation({ initiativeId: a.id, relatedInitiativeId: b.id });
    const loop = await gql(
      { cookie: owner.cookie },
      `mutation { initiativeRelationCreate(input: { initiativeId: "${b.id}", relatedInitiativeId: "${a.id}" }) { success } }`,
    );
    expect(errorCode(loop)).toBe('INVALID_INPUT');
  });

  it('rejects a sub-initiative past the depth limit with its message and no change', async () => {
    const { owner, client } = await setup();
    const chain = [];
    for (const name of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'])
      chain.push((await (await client.createInitiative({ name })).initiative)!);
    for (let i = 0; i < 4; i++)
      await client.createInitiativeRelation({
        initiativeId: chain[i]!.id,
        relatedInitiativeId: chain[i + 1]!.id,
      });
    const tooDeep = await gql(
      { cookie: owner.cookie },
      `mutation { initiativeRelationCreate(input: { initiativeId: "${chain[4]!.id}", relatedInitiativeId: "${chain[5]!.id}" }) { success } }`,
    );
    expect(errorCode(tooDeep)).toBe('INVALID_INPUT');
    expect(errorMessage(tooDeep)).toContain('at most 5 levels deep');
    expect((await client.initiativeRelations()).nodes).toHaveLength(4);
  });

  it('posts updates and derives health', async () => {
    const { client } = await setup();
    const a = (await (await client.createInitiative({ name: 'A' })).initiative)!;
    const posted = (await (
      await client.createInitiativeUpdate({
        initiativeId: a.id,
        body: 'Slipping',
        health: InitiativeUpdateHealthType.AtRisk,
      })
    ).initiativeUpdate)!;
    const read = await client.initiative(a.id);
    expect(read.health).toBe(InitiativeUpdateHealthType.AtRisk);
    expect(read.healthUpdatedAt).toBeTruthy();
    expect((await read.lastUpdate)?.id).toBe(posted.id);
    expect((await read.initiativeUpdates()).nodes.map((u) => u.id)).toEqual([posted.id]);
    await client.archiveInitiativeUpdate(posted.id);
    expect((await client.initiative(a.id)).health).toBeFalsy();
  });

  it('comments and reacts on an update', async () => {
    const { client } = await setup();
    const a = (await (await client.createInitiative({ name: 'A' })).initiative)!;
    const posted = (await (
      await client.createInitiativeUpdate({ initiativeId: a.id, body: 'Going well' })
    ).initiativeUpdate)!;
    const comment = (await (
      await client.createComment({ initiativeUpdateId: posted.id, body: 'Nice' })
    ).comment)!;
    expect((await comment.initiativeUpdate)?.id).toBe(posted.id);
    const reaction = (await (
      await client.createReaction({ initiativeUpdateId: posted.id, emoji: '👍' })
    ).reaction)!;
    expect((await reaction.initiativeUpdate)?.id).toBe(posted.id);
    const update = await client.initiativeUpdate(posted.id);
    expect((await update.comments()).nodes.map((c) => c.id)).toEqual([comment.id]);
    expect(update.commentCount).toBe(1);
    expect(JSON.stringify(update.reactionData)).toContain('👍');
  });

  it('sends Initiative and InitiativeUpdate webhooks over GraphQL', async () => {
    const { owner, client } = await setup();
    const hook = await createWebhook(owner, {
      allPublicTeams: true,
      url: 'https://example.com/h',
      resourceTypes: ['Initiative', 'InitiativeUpdate'],
    });
    const a = (await (await client.createInitiative({ name: 'A' })).initiative)!;
    await client.createInitiativeUpdate({ initiativeId: a.id, body: 'ok' });
    const events = (await webhookDeliveries(hook.id))
      .data!.items.map((d) => d.payload as { action: string; type: string })
      .map((p) => `${p.type}:${p.action}`);
    expect(events).toContain('Initiative:create');
    expect(events).toContain('InitiativeUpdate:create');
  });

  it('treats a missing value as not matching an every filter on initiatives', async () => {
    const { owner, client, mkt } = await setup();
    const dated = (await (
      await client.createInitiative({ name: 'Dated', targetDate: '2026-12-01' })
    ).initiative)!;
    const undated = (await (await client.createInitiative({ name: 'Undated' })).initiative)!;
    const p1 = await createProject(owner, { teamIds: [mkt], name: 'P1' });
    const p2 = await createProject(owner, { teamIds: [mkt], name: 'P2' });
    await linkProject({ initiativeId: dated.id, projectId: p1.id }, owner.userId);
    await linkProject({ initiativeId: dated.id, projectId: p2.id }, owner.userId);
    await linkProject({ initiativeId: undated.id, projectId: p2.id }, owner.userId);
    const res = await gql(
      { cookie: owner.cookie },
      '{ projects(filter: { initiatives: { every: { targetDate: { lt: "2027-01-01" } } } }) { nodes { name } } }',
    );
    expect(res.body.data).toEqual({ projects: { nodes: [{ name: 'P1' }] } });
  });

  it('names a malformed lead team and reports an unknown one as not found', async () => {
    const { owner } = await setup();
    const malformed = await gql(
      { cookie: owner.cookie },
      'mutation { initiativeCreate(input: { name: "X", leadTeamId: "nope" }) { success } }',
    );
    expect(errorCode(malformed)).toBe('INVALID_INPUT');
    expect(errorMessage(malformed)).toContain('leadTeamId');
    const unknown = await gql(
      { cookie: owner.cookie },
      'mutation { initiativeCreate(input: { name: "X", leadTeamId: "00000000-0000-4000-8000-000000000000" }) { success } }',
    );
    expect(errorCode(unknown)).toBe('ENTITY_NOT_FOUND');
  });

  it('refuses moving an initiative to a team the caller cannot see', async () => {
    const { owner, client } = await setup();
    const ops = await memberOf(owner, 'OPS');
    const created = (await (await ops.client.createInitiative({ name: 'W' })).initiative)!;
    const mkt = (await teamView(owner, 'MKT')).team.id;
    await makePrivate(owner, 'MKT');
    const res = await gql(
      { cookie: ops.user.cookie },
      `mutation { initiativeUpdate(id: "${created.id}", input: { leadTeamId: "${mkt}" }) { success } }`,
    );
    expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
    expect((await client.initiative(created.id)).visibility).toBe(InitiativeVisibility.Public);
  });

  it('hides archived initiatives from sub-initiatives and project lists', async () => {
    const { owner, client, mkt } = await setup();
    const a = (await (await client.createInitiative({ name: 'A' })).initiative)!;
    const b = (await (await client.createInitiative({ name: 'B' })).initiative)!;
    const site = await createProject(owner, { teamIds: [mkt], name: 'Site' });
    await client.createInitiativeRelation({ initiativeId: a.id, relatedInitiativeId: b.id });
    await linkProject({ initiativeId: b.id, projectId: site.id }, owner.userId);
    await client.archiveInitiative(b.id);
    const parent = await client.initiative(a.id);
    expect((await parent.subInitiatives()).nodes).toHaveLength(0);
    expect((await parent.subInitiatives({ includeArchived: true })).nodes).toHaveLength(1);
    const project = await client.project(site.id);
    expect((await project.initiatives()).nodes).toHaveLength(0);
    expect((await project.initiatives({ includeArchived: true })).nodes).toHaveLength(1);
    expect((await project.initiativeToProjects()).nodes).toHaveLength(0);
    expect((await parent.projects()).nodes).toHaveLength(0);
  });
});
