import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gql } from '../../../__tests__/helpers/linear';
import { addToTeam, makePrivate, signUpWithRole } from '../../../__tests__/helpers/roles';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';

// Project members over the Linear API: set on create, replaced on update, limited to
// users who can see the project, the lead not added automatically, and carried in
// the Project webhook payload.

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

type Data = Record<string, { project?: { members: { nodes: { id: string }[] } } }>;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const teamId = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!.team.id;
  const a = await signUpWithRole('member', { name: 'Ann' });
  const b = await signUpWithRole('member', { name: 'Ben' });
  return { owner, asOwner, teamId, a, b };
}

const memberIds = (data: unknown, field: string) =>
  (data as Data)[field]!.project!.members.nodes.map((n) => n.id).sort();

describe('graphql project members', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('sets members on create and replaces them on update', async () => {
    const { owner, teamId, a, b } = await setup();
    const created = await gql(
      { cookie: owner.cookie },
      `mutation { projectCreate(input: { name: "P", teamIds: ["${teamId}"], memberIds: ["${a.userId}", "${b.userId}"] }) { project { id members { nodes { id } } } } }`,
    );
    expect(created.body.errors).toBeUndefined();
    expect(memberIds(created.body.data, 'projectCreate')).toEqual([a.userId, b.userId].sort());
    const id = (created.body.data as { projectCreate: { project: { id: string } } }).projectCreate
      .project.id;
    const updated = await gql(
      { cookie: owner.cookie },
      `mutation { projectUpdate(id: "${id}", input: { memberIds: ["${b.userId}"] }) { project { members { nodes { id } } } } }`,
    );
    expect(memberIds(updated.body.data, 'projectUpdate')).toEqual([b.userId]);
    const cleared = await gql(
      { cookie: owner.cookie },
      `mutation { projectUpdate(id: "${id}", input: { memberIds: [] }) { project { members { nodes { id } } } } }`,
    );
    expect(memberIds(cleared.body.data, 'projectUpdate')).toEqual([]);
  });

  it('refuses a member who cannot see the project', async () => {
    const { owner, asOwner, teamId, a } = await setup();
    await makePrivate(asOwner, 'MKT');
    const outsider = await signUpWithRole('member', { name: 'Out' });
    await addToTeam(asOwner, 'MKT', a);
    const created = await gql(
      { cookie: owner.cookie },
      `mutation { projectCreate(input: { name: "P", teamIds: ["${teamId}"], memberIds: ["${a.userId}"] }) { project { id } } }`,
    );
    const id = (created.body.data as { projectCreate: { project: { id: string } } }).projectCreate
      .project.id;
    const res = await gql(
      { cookie: owner.cookie },
      `mutation { projectUpdate(id: "${id}", input: { memberIds: ["${a.userId}", "${outsider.userId}"] }) { success } }`,
    );
    expect(errorCode(res)).toBe('INVALID_INPUT');
    const read = await gql(
      { cookie: owner.cookie },
      `{ project(id: "${id}") { members { nodes { id } } } }`,
    );
    expect(
      (
        read.body.data as { project: { members: { nodes: { id: string }[] } } }
      ).project.members.nodes.map((n) => n.id),
    ).toEqual([a.userId]);
  });

  it('does not add the lead as a member', async () => {
    const { owner, teamId } = await setup();
    const created = await gql(
      { cookie: owner.cookie },
      `mutation { projectCreate(input: { name: "P", teamIds: ["${teamId}"], leadId: "${owner.userId}" }) { project { members { nodes { id } } } } }`,
    );
    expect(memberIds(created.body.data, 'projectCreate')).toEqual([]);
  });

  it('carries memberIds in the Project webhook payload', async () => {
    const { owner, asOwner, teamId, a } = await setup();
    const hook = (
      await asOwner
        .teams({ teamKey: 'MKT' })
        .webhooks.post({ url: 'https://example.com/h', resourceTypes: ['Project'] })
    ).data!;
    const created = await gql(
      { cookie: owner.cookie },
      `mutation { projectCreate(input: { name: "P", teamIds: ["${teamId}"] }) { project { id } } }`,
    );
    const id = (created.body.data as { projectCreate: { project: { id: string } } }).projectCreate
      .project.id;
    await gql(
      { cookie: owner.cookie },
      `mutation { projectUpdate(id: "${id}", input: { memberIds: ["${a.userId}"] }) { success } }`,
    );
    const payloads = (await webhookDeliveries(hook.id)).data!.items.map(
      (d) => d.payload as { action: string; data: { memberIds?: string[] } },
    );
    const update = payloads.find((p) => p.action === 'update')!;
    expect(update.data.memberIds).toEqual([a.userId]);
  });
});
