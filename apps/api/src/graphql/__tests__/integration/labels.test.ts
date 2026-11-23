import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { signUpWithRole } from '../../../__tests__/helpers/roles';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';

// Issue labels over the Linear API: workspace and team labels, groups, retire and
// restore, and labels on issues through issueCreate / issueUpdate.

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const teamId = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!.team.id;
  const client = linearClient(await createApiKey(owner.cookie));
  return { owner, asOwner, teamId, client };
}

describe('graphql labels', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates workspace and team labels and lists them', async () => {
    const { owner, teamId, client } = await setup();
    const ws = (await (
      await client.createIssueLabel({ name: 'Security', color: '#ff0000' })
    ).issueLabel)!;
    const team = (await (await client.createIssueLabel({ name: 'Bug', teamId })).issueLabel)!;
    expect(await ws.team).toBeUndefined();
    expect((await team.team)?.id).toBe(teamId);
    const workspaceOnly = await gql(
      { cookie: owner.cookie },
      '{ issueLabels(filter: { team: { null: true } }) { nodes { name } } }',
    );
    expect(workspaceOnly.body.data).toEqual({ issueLabels: { nodes: [{ name: 'Security' }] } });
    const teamLabels = await (await client.team(teamId)).labels();
    expect(teamLabels.nodes.map((l) => l.name).sort()).toEqual(['Bug', 'Security']);
  });

  it('creates a group with a child; the group cannot be applied', async () => {
    const { owner, teamId, client } = await setup();
    const group = (await (
      await client.createIssueLabel({ name: 'Area', teamId, isGroup: true })
    ).issueLabel)!;
    const child = (await (
      await client.createIssueLabel({ name: 'API', teamId, parentId: group.id })
    ).issueLabel)!;
    expect((await child.parent)?.id).toBe(group.id);
    expect((await group.children()).nodes.map((l) => l.id)).toEqual([child.id]);
    const res = await gql(
      { cookie: owner.cookie },
      `mutation { issueCreate(input: { teamId: "${teamId}", title: "x", labelIds: ["${group.id}"] }) { success } }`,
    );
    expect(errorCode(res)).toBe('INVALID_INPUT');
  });

  it('adds and removes labels on an issue', async () => {
    const { teamId, client } = await setup();
    const ws = (await (await client.createIssueLabel({ name: 'Security' })).issueLabel)!;
    const bug = (await (await client.createIssueLabel({ name: 'Bug', teamId })).issueLabel)!;
    const issue = (await (
      await client.createIssue({ teamId, title: 'x', labelIds: [bug.id] })
    ).issue)!;
    await client.updateIssue(issue.id, { addedLabelIds: [ws.id] });
    let labels = await (await client.issue(issue.id)).labels();
    expect(labels.nodes.map((l) => l.name).sort()).toEqual(['Bug', 'Security']);
    await client.updateIssue(issue.id, { removedLabelIds: [bug.id] });
    labels = await (await client.issue(issue.id)).labels();
    expect(labels.nodes.map((l) => l.name)).toEqual(['Security']);
    expect((await client.issue(issue.id)).labelIds).toEqual([ws.id]);
  });

  it('retires and restores a label', async () => {
    const { owner, teamId, client } = await setup();
    const bug = (await (await client.createIssueLabel({ name: 'Bug', teamId })).issueLabel)!;
    await client.issueLabelRetire(bug.id);
    const res = await gql(
      { cookie: owner.cookie },
      `mutation { issueCreate(input: { teamId: "${teamId}", title: "x", labelIds: ["${bug.id}"] }) { success } }`,
    );
    expect(errorCode(res)).toBe('INVALID_INPUT');
    await client.issueLabelRestore(bug.id);
    expect((await client.createIssue({ teamId, title: 'y', labelIds: [bug.id] })).success).toBe(
      true,
    );
  });

  it('reports who retired a label', async () => {
    const { owner, teamId } = await setup();
    const query = (id: string) =>
      gql({ cookie: owner.cookie }, `{ issueLabel(id: "${id}") { retiredBy { id } } }`);
    const created = await gql(
      { cookie: owner.cookie },
      `mutation { issueLabelCreate(input: { name: "Old", teamId: "${teamId}" }) { issueLabel { id } } }`,
    );
    const id = (created.body.data as { issueLabelCreate: { issueLabel: { id: string } } })
      .issueLabelCreate.issueLabel.id;
    expect((await query(id)).body.data).toEqual({ issueLabel: { retiredBy: null } });
    await gql({ cookie: owner.cookie }, `mutation { issueLabelRetire(id: "${id}") { success } }`);
    expect((await query(id)).body.data).toEqual({
      issueLabel: { retiredBy: { id: owner.userId } },
    });
    await gql({ cookie: owner.cookie }, `mutation { issueLabelRestore(id: "${id}") { success } }`);
    expect((await query(id)).body.data).toEqual({ issueLabel: { retiredBy: null } });
  });

  it('updates and deletes a label', async () => {
    const { teamId, client } = await setup();
    const bug = (await (await client.createIssueLabel({ name: 'Bug', teamId })).issueLabel)!;
    await client.updateIssueLabel(bug.id, { name: 'Defect', description: 'broken' });
    const read = await client.issueLabel(bug.id);
    expect(read).toMatchObject({ name: 'Defect', description: 'broken' });
    expect((await client.deleteIssueLabel(bug.id)).success).toBe(true);
  });

  it('refuses a workspace label from a user in no team', async () => {
    await setup();
    const loner = await signUpWithRole('guest');
    const res = await gql(
      { cookie: loner.cookie },
      'mutation { issueLabelCreate(input: { name: "x" }) { success } }',
    );
    expect(errorCode(res)).toBe('FORBIDDEN');
  });

  it('sends a workspace label webhook to all-teams webhooks only', async () => {
    const { asOwner, client } = await setup();
    const teamHook = (
      await asOwner
        .teams({ teamKey: 'MKT' })
        .webhooks.post({ url: 'https://example.com/t', resourceTypes: ['IssueLabel'] })
    ).data!;
    const allHook = (
      await asOwner.webhooks.post({ url: 'https://example.com/a', resourceTypes: ['IssueLabel'] })
    ).data!;
    await client.createIssueLabel({ name: 'Security' });
    expect((await webhookDeliveries(teamHook.id)).data!.items).toEqual([]);
    expect((await webhookDeliveries(allHook.id)).data!.items).toHaveLength(1);
  });

  it('keeps a client-supplied id', async () => {
    const { client } = await setup();
    const id = '11111111-2222-4333-8444-555555555555';
    const created = (await (await client.createIssueLabel({ id, name: 'Pre-made' })).issueLabel)!;
    expect(created.id).toBe(id);
  });
});
