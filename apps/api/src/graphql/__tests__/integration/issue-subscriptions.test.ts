import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';

// Issue subscriptions over the Linear API: issueSubscribe / issueUnsubscribe,
// Issue.subscribers, subscriberIds on create and update, and the subscribers filter.

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

async function setup() {
  const o = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(o.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const team = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!.team;
  const join = async (name: string) => {
    const u = await signUpTestUser({ name });
    const invite = await asOwner
      .teams({ teamKey: 'MKT' })
      .invites.post({ email: u.email, role: 'member' });
    await authedApi(u.cookie).invites({ token: invite.data!.token }).accept.post();
    return u;
  };
  const b = await join('Bea');
  const c = await join('Cal');
  const client = linearClient(await createApiKey(o.cookie));
  return { owner: o, b, c, client, teamId: team.id };
}

const subscriberIdsOf = async (client: ReturnType<typeof linearClient>, issueId: string) =>
  (await (await client.issue(issueId)).subscribers()).nodes.map((u) => u.id).sort();

describe('graphql issue subscriptions', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('subscribes and unsubscribes over GraphQL', async () => {
    const { owner, b, c, client, teamId } = await setup();
    const issue = (await (await client.createIssue({ teamId, title: 'T' })).issue)!;
    expect(await subscriberIdsOf(client, issue.id)).toEqual([owner.userId]);
    await client.issueSubscribe(issue.id, { userId: b.userId });
    await client.issueSubscribe(issue.id, { userEmail: c.email });
    expect(await subscriberIdsOf(client, issue.id)).toEqual(
      [owner.userId, b.userId, c.userId].sort(),
    );
    await client.issueUnsubscribe(issue.id);
    expect(await subscriberIdsOf(client, issue.id)).toEqual([b.userId, c.userId].sort());
    await client.issueSubscribe(issue.id);
    expect(await subscriberIdsOf(client, issue.id)).toContain(owner.userId);
  });

  it('rejects a subscriber outside the team', async () => {
    const { owner, client, teamId } = await setup();
    const outsider = await signUpTestUser();
    const issue = (await (await client.createIssue({ teamId, title: 'T' })).issue)!;
    const res = await gql(
      { cookie: owner.cookie },
      `mutation { issueSubscribe(id: "${issue.id}", userId: "${outsider.userId}") { success } }`,
    );
    expect(errorCode(res)).toBe('INVALID_INPUT');
    expect(await subscriberIdsOf(client, issue.id)).toEqual([owner.userId]);
  });

  it('sets subscriberIds on create and replaces them on update', async () => {
    const { owner, b, c, client, teamId } = await setup();
    const issue = (await (
      await client.createIssue({ teamId, title: 'T', subscriberIds: [b.userId] })
    ).issue)!;
    expect(await subscriberIdsOf(client, issue.id)).toEqual([owner.userId, b.userId].sort());
    await client.updateIssue(issue.id, { subscriberIds: [c.userId] });
    expect(await subscriberIdsOf(client, issue.id)).toEqual([c.userId]);
    const outsider = await signUpTestUser();
    const res = await gql(
      { cookie: owner.cookie },
      `mutation { issueUpdate(id: "${issue.id}", input: { subscriberIds: ["${outsider.userId}"] }) { success } }`,
    );
    expect(errorCode(res)).toBe('INVALID_INPUT');
    expect(await subscriberIdsOf(client, issue.id)).toEqual([c.userId]);
  });

  it('filters issues by subscribers', async () => {
    const { owner, client, teamId } = await setup();
    const mine = (await (await client.createIssue({ teamId, title: 'Mine' })).issue)!;
    const other = (await (await client.createIssue({ teamId, title: 'Other' })).issue)!;
    await client.issueUnsubscribe(other.id);
    const q = async (filter: string) =>
      JSON.stringify(
        (await gql({ cookie: owner.cookie }, `{ issues(filter: ${filter}) { nodes { title } } }`))
          .body.data,
      );
    const subscribed = await q('{ subscribers: { some: { isMe: { eq: true } } } }');
    expect(subscribed).toContain('Mine');
    expect(subscribed).not.toContain('Other');
    const none = await q('{ subscribers: { length: { eq: 0 } } }');
    expect(none).toContain('Other');
    expect(none).not.toContain('Mine');
    expect(mine.id).toBeTruthy();
  });

  it('leaves subscribers alone when the rest of an update fails', async () => {
    const { owner, b, client, teamId } = await setup();
    const issue = (await (
      await client.createIssue({ teamId, title: 'T', subscriberIds: [b.userId] })
    ).issue)!;
    const outsider = await signUpTestUser();
    const res = await gql(
      { cookie: owner.cookie },
      `mutation { issueUpdate(id: "${issue.id}", input: { subscriberIds: ["${b.userId}"], assigneeId: "${outsider.userId}" }) { success } }`,
    );
    expect(errorCode(res)).toBe('INVALID_INPUT');
    expect(await subscriberIdsOf(client, issue.id)).toEqual([owner.userId, b.userId].sort());
  });

  it('rejects a userId that is not an id', async () => {
    const { owner, client, teamId } = await setup();
    const issue = (await (await client.createIssue({ teamId, title: 'T' })).issue)!;
    const res = await gql(
      { cookie: owner.cookie },
      `mutation { issueUnsubscribe(id: "${issue.id}", userId: "nope") { success } }`,
    );
    expect(errorCode(res)).toBe('INVALID_INPUT');
  });

  it('needs work_items.edit to unsubscribe someone else', async () => {
    const { owner, b, client, teamId } = await setup();
    const issue = (await (
      await client.createIssue({ teamId, title: 'T', subscriberIds: [b.userId] })
    ).issue)!;
    const asOwner = authedApi(owner.cookie);
    const role = await asOwner
      .teams({ teamKey: 'MKT' })
      .roles.post({ name: 'Readers', permissions: { work_items: { read: true } } });
    const reader = await signUpTestUser();
    const invite = await asOwner
      .teams({ teamKey: 'MKT' })
      .invites.post({ email: reader.email, role: 'member', roleId: role.data!.id });
    await authedApi(reader.cookie).invites({ token: invite.data!.token }).accept.post();
    const other = await gql(
      { cookie: reader.cookie },
      `mutation { issueUnsubscribe(id: "${issue.id}", userId: "${b.userId}") { success } }`,
    );
    expect(errorCode(other)).toBe('FORBIDDEN');
    expect(await subscriberIdsOf(client, issue.id)).toContain(b.userId);
    const self = await gql(
      { cookie: reader.cookie },
      `mutation { issueSubscribe(id: "${issue.id}") { success } }`,
    );
    expect(self.body.errors).toBeUndefined();
  });

  it('answers the same for an unknown email and an outsider email', async () => {
    const { owner, client, teamId } = await setup();
    const outsider = await signUpTestUser();
    const issue = (await (await client.createIssue({ teamId, title: 'T' })).issue)!;
    const message = async (email: string) =>
      (
        await gql(
          { cookie: owner.cookie },
          `mutation { issueSubscribe(id: "${issue.id}", userEmail: "${email}") { success } }`,
        )
      ).body.errors?.[0]?.message;
    expect(await message('nobody@example.com')).toBe(await message(outsider.email));
  });
});
