import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';
import { addMember, createTeam, teamView } from '../../../__tests__/helpers/graphql';

// Webhook management over the Linear API and who may do it.

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;
const errorMessage = (res: { body: { errors?: { message?: string }[] } }) =>
  res.body.errors?.[0]?.message ?? '';

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const teamId = (await teamView(owner, 'MKT')).team.id;
  const client = linearClient(await createApiKey(owner.cookie));
  return { owner, teamId, client };
}

describe('graphql webhooks', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates a team webhook and reads it back', async () => {
    const { teamId, client } = await setup();
    const created = await client.createWebhook({
      url: 'https://example.com/hook',
      teamId,
      resourceTypes: ['Issue'],
      label: 'CI',
    });
    const webhook = await created.webhook;
    expect(webhook).toMatchObject({ resourceTypes: ['Issue'], label: 'CI', enabled: true });
    expect(webhook!.allPublicTeams).toBe(false);
    expect((await webhook!.team)?.id).toBe(teamId);
    expect(webhook!.secret).toMatch(/^whsec_/);
    expect((await client.webhook(webhook!.id)).url).toBe('https://example.com/hook');
    expect((await client.webhooks()).nodes.map((w) => w.id)).toEqual([webhook!.id]);
  });

  it('lets the workspace owner create an all-teams webhook and refuses an owner of some teams', async () => {
    const { owner } = await setup();
    const res = await gql(
      { cookie: owner.cookie },
      'mutation { webhookCreate(input: { url: "https://example.com/all", allPublicTeams: true, resourceTypes: ["Project"] }) { success webhook { allPublicTeams team { id } } } }',
    );
    expect(res.body.data).toMatchObject({
      webhookCreate: { success: true, webhook: { allPublicTeams: true, team: null } },
    });

    const other = await signUpTestUser();
    await createTeam(other, { key: 'OPS', name: 'Operations' });
    const denied = await gql(
      { cookie: other.cookie },
      'mutation { webhookCreate(input: { url: "https://example.com/all", allPublicTeams: true, resourceTypes: ["Project"] }) { success } }',
    );
    expect(errorCode(denied)).toBe('FORBIDDEN');
  });

  it('rejects an unknown resource type and a missing scope', async () => {
    const { owner, teamId } = await setup();
    const bad = await gql(
      { cookie: owner.cookie },
      `mutation { webhookCreate(input: { url: "https://example.com/h", teamId: "${teamId}", resourceTypes: ["Customer"] }) { success } }`,
    );
    expect(errorCode(bad)).toBe('INVALID_INPUT');
    expect(errorMessage(bad)).toContain('Customer');
    const noScope = await gql(
      { cookie: owner.cookie },
      'mutation { webhookCreate(input: { url: "https://example.com/h", resourceTypes: ["Issue"] }) { success } }',
    );
    expect(errorCode(noScope)).toBe('INVALID_INPUT');
  });

  it('updates, rotates the secret of and deletes a webhook', async () => {
    const { teamId, client } = await setup();
    const webhook = (await (
      await client.createWebhook({
        url: 'https://example.com/hook',
        teamId,
        resourceTypes: ['Issue'],
      })
    ).webhook)!;
    const updated = await (
      await client.updateWebhook(webhook.id, { enabled: false, label: 'x' })
    ).webhook;
    expect(updated).toMatchObject({ enabled: false, label: 'x' });
    const rotated = await client.rotateSecretWebhook(webhook.id);
    expect(rotated.secret).not.toBe(webhook.secret);
    expect((await client.deleteWebhook(webhook.id)).success).toBe(true);
    expect((await client.webhooks()).nodes).toEqual([]);
  });

  it("hides a team's webhooks from a workspace member", async () => {
    const { owner, teamId, client } = await setup();
    await client.createWebhook({
      url: 'https://example.com/hook',
      teamId,
      resourceTypes: ['Issue'],
    });
    const member = await signUpTestUser();
    await addMember(owner, 'MKT', member.userId);
    const res = await gql({ cookie: member.cookie }, '{ webhooks { nodes { id } } }');
    expect(res.body.data).toEqual({ webhooks: { nodes: [] } });
  });
});
