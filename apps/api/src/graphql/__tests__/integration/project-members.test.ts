import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gql } from '../../../__tests__/helpers/linear';
import { setWorkspaceRole } from '../../../shared/access';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';
import {
  addMember,
  createTeam,
  createWebhook,
  makePrivate,
  signUpAs,
  teamView,
} from '../../../__tests__/helpers/graphql';

// Project members over the Linear API: set on create, replaced on update, limited to
// users who can see the project, the lead not added automatically, and carried in
// the Project webhook payload.

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

type Data = Record<string, { project?: { members: { nodes: { id: string }[] } } }>;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const teamId = (await teamView(owner, 'MKT')).team.id;
  const a = await signUpAs('member', { name: 'Ann' });
  const b = await signUpAs('member', { name: 'Ben' });
  return { owner, teamId, a, b };
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
    const { owner, teamId, a } = await setup();
    await makePrivate(owner, 'MKT');
    const outsider = await signUpAs('member', { name: 'Out' });
    await addMember(owner, 'MKT', a.userId);
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
    const { owner, teamId, a } = await setup();
    const hook = await createWebhook(owner, {
      teamId: 'MKT',
      url: 'https://example.com/h',
      resourceTypes: ['Project'],
    });
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
  it('checks only the added members, naming the refused ones', async () => {
    const { owner, teamId, a, b } = await setup();
    const created = await gql(
      { cookie: owner.cookie },
      `mutation { projectCreate(input: { name: "P", teamIds: ["${teamId}"], memberIds: ["${a.userId}"] }) { project { id } } }`,
    );
    const id = (created.body.data as { projectCreate: { project: { id: string } } }).projectCreate
      .project.id;
    // Ann loses sight of the project; she stays a member and does not block edits.
    await setWorkspaceRole(a.userId, 'guest');
    const kept = await gql(
      { cookie: owner.cookie },
      `mutation { projectUpdate(id: "${id}", input: { memberIds: ["${a.userId}", "${b.userId}"] }) { project { members { nodes { id } } } } }`,
    );
    expect(kept.body.errors).toBeUndefined();
    const outsider = await signUpAs('guest', { name: 'Olga Out' });
    const refused = await gql(
      { cookie: owner.cookie },
      `mutation { projectUpdate(id: "${id}", input: { memberIds: ["${a.userId}", "${outsider.userId}"] }) { success } }`,
    );
    expect(errorCode(refused)).toBe('INVALID_INPUT');
    expect(refused.body.errors?.[0]?.message).toContain('Olga Out');
  });

  it('refuses a malformed member id as invalid input', async () => {
    const { owner, teamId } = await setup();
    const res = await gql(
      { cookie: owner.cookie },
      `mutation { projectCreate(input: { name: "P", teamIds: ["${teamId}"], memberIds: ["not-a-uuid"] }) { success } }`,
    );
    expect(errorCode(res)).toBe('INVALID_INPUT');
  });

  it('checks the members against the new teams before changing any', async () => {
    const { owner, teamId, a } = await setup();
    await makePrivate(owner, 'MKT');
    await createTeam(owner, { key: 'ENG', name: 'Engineering' });
    const engId = (await teamView(owner, 'ENG')).team.id;
    await makePrivate(owner, 'ENG');
    const created = await gql(
      { cookie: owner.cookie },
      `mutation { projectCreate(input: { name: "P", teamIds: ["${teamId}"] }) { project { id } } }`,
    );
    const id = (created.body.data as { projectCreate: { project: { id: string } } }).projectCreate
      .project.id;
    // Ann is in neither team: moving the project to ENG with her as a member is refused.
    const res = await gql(
      { cookie: owner.cookie },
      `mutation { projectUpdate(id: "${id}", input: { teamIds: ["${engId}"], memberIds: ["${a.userId}"] }) { success } }`,
    );
    expect(errorCode(res)).toBe('INVALID_INPUT');
    const read = await gql(
      { cookie: owner.cookie },
      `{ project(id: "${id}") { teams { nodes { id } } } }`,
    );
    expect(
      (
        read.body.data as { project: { teams: { nodes: { id: string }[] } } }
      ).project.teams.nodes.map((n) => n.id),
    ).toEqual([teamId]);
  });
});
