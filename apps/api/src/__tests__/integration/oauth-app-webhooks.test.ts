import { beforeEach, describe, expect, it } from 'bun:test';
import { db, webhook } from '@repo/db';
import { eq } from 'drizzle-orm';
import { signUpTestUser, type TestUser } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { gql } from '../helpers/linear';
import { REDIRECT_URI, authPost, install, obtainTokens, type OAuthClient } from '../helpers/oauth';
import { webhookDeliveries } from '../helpers/webhooks';
import { createTeam, makePrivate, signUpAs } from '../helpers/graphql';

// An OAuth application's webhook (Linear's application webhooks): it receives the
// resource types it subscribes to, for the teams its app user can reach when it is
// installed with `actor=app`, or the public teams when people have only authorized it
// as themselves. Archiving or uninstalling the application stops delivery. The
// application's webhook is not one of the workspace's webhooks.

const ISSUE_CREATE = `mutation($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { id } }
}`;
const TEAM = 'query($id: String!) { team(id: $id) { id } }';
const WEBHOOKS = '{ webhooks { nodes { id } } }';
const WEBHOOK = 'query($id: String!) { webhook(id: $id) { id secret } }';

interface AppWithWebhook {
  client: OAuthClient;
  webhookId: string;
  webhookSecret: string;
}

async function createAppWithWebhook(cookie: string): Promise<AppWithWebhook> {
  const res = await authPost('/instance/oauth-apps/create', cookie, {
    name: 'Hooked',
    redirectUris: [REDIRECT_URI],
    webhookUrl: 'https://hooks.example.com/linear',
    webhookResourceTypes: ['Issue'],
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    application: { clientId: string };
    clientSecret: string;
    webhookSecret: string;
  };
  // The delivery queue is per webhook row; the test reads the application's row.
  const [row] = await db
    .select({ id: webhook.id, secret: webhook.secret })
    .from(webhook)
    .where(eq(webhook.oauthClientId, body.application.clientId));
  expect(row!.secret).toBe(body.webhookSecret);
  return {
    client: { clientId: body.application.clientId, clientSecret: body.clientSecret },
    webhookId: row!.id,
    webhookSecret: body.webhookSecret,
  };
}

async function createIssue(owner: TestUser, teamKey: string, title: string) {
  const res = await gql({ cookie: owner.cookie }, ISSUE_CREATE, {
    input: { teamId: teamKey, title },
  });
  expect(res.body.errors).toBeUndefined();
}

async function deliveredTitles(webhookId: string): Promise<string[]> {
  const { data } = await webhookDeliveries(webhookId);
  return data.items.map((d) => (d.payload as { data: { title: string } }).data.title).sort();
}

async function teamId(owner: TestUser, key: string): Promise<string> {
  const res = await gql({ cookie: owner.cookie }, TEAM, { id: key });
  return (res.body.data?.team as { id: string }).id;
}

describe('oauth application webhooks', () => {
  let owner: TestUser;

  beforeEach(async () => {
    await resetDb();
    owner = await signUpTestUser({ name: 'Owner' });
    await createTeam(owner, { key: 'MKT', name: 'Marketing' });
    await createTeam(owner, { key: 'ENG', name: 'Engineering' });
    await createTeam(owner, { key: 'SEC', name: 'Security' });
    await makePrivate(owner, 'SEC');
  });

  it('sends nothing for an application nobody has authorized', async () => {
    const { webhookId } = await createAppWithWebhook(owner.cookie);
    await createIssue(owner, 'MKT', 'Public');
    expect(await deliveredTitles(webhookId)).toEqual([]);
  });

  it("covers the app user's chosen teams for an actor=app install", async () => {
    const hooked = await createAppWithWebhook(owner.cookie);
    await install(owner.cookie, hooked.client, {
      teamIds: [await teamId(owner, 'MKT')],
      publicTeams: false,
    });
    await createIssue(owner, 'MKT', 'Chosen');
    await createIssue(owner, 'ENG', 'Public, not chosen');
    await createIssue(owner, 'SEC', 'Private, not chosen');
    expect(await deliveredTitles(hooked.webhookId)).toEqual(['Chosen']);

    // With every public team and the private team added.
    await install(owner.cookie, hooked.client, { teamIds: [await teamId(owner, 'SEC')] });
    await createIssue(owner, 'ENG', 'Public now');
    await createIssue(owner, 'SEC', 'Private now');
    expect(await deliveredTitles(hooked.webhookId)).toEqual([
      'Chosen',
      'Private now',
      'Public now',
    ]);
  });

  it('covers the public teams when people only authorized it as themselves', async () => {
    const hooked = await createAppWithWebhook(owner.cookie);
    const member = await signUpAs('member', { name: 'Member' });
    await obtainTokens(member.cookie, hooked.client, 'read');
    await createIssue(owner, 'ENG', 'Public');
    await createIssue(owner, 'SEC', 'Private');
    expect(await deliveredTitles(hooked.webhookId)).toEqual(['Public']);
  });

  it('stops when the application is uninstalled or archived', async () => {
    const hooked = await createAppWithWebhook(owner.cookie);
    await install(owner.cookie, hooked.client);
    await createIssue(owner, 'MKT', 'Before');
    await authPost('/instance/oauth-uninstall', owner.cookie, { clientId: hooked.client.clientId });
    await createIssue(owner, 'MKT', 'After uninstall');
    expect(await deliveredTitles(hooked.webhookId)).toEqual(['Before']);

    const other = await createAppWithWebhook(owner.cookie);
    await install(owner.cookie, other.client);
    await authPost('/instance/oauth-apps/archive', owner.cookie, {
      clientId: other.client.clientId,
    });
    await createIssue(owner, 'MKT', 'After archive');
    expect(await deliveredTitles(other.webhookId)).toEqual([]);
  });

  it('is not one of the workspace webhooks', async () => {
    const hooked = await createAppWithWebhook(owner.cookie);
    const listed = await gql({ cookie: owner.cookie }, WEBHOOKS);
    expect((listed.body.data?.webhooks as { nodes: { id: string }[] }).nodes).toEqual([]);
    const one = await gql({ cookie: owner.cookie }, WEBHOOK, { id: hooked.webhookId });
    expect(one.body.errors?.[0]?.extensions?.code).toBe('ENTITY_NOT_FOUND');
  });
});
