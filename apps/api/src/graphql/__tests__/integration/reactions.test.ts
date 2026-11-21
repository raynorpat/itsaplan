import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';
import { createUpdate } from '../../../projects/updates';

// Emoji reactions on issues, comments and project updates: one per user and exact
// emoji, removed only by the user who added it.

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const mkt = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!;
  const issue = (
    await asOwner
      .teams({ teamKey: 'MKT' })
      .issues.post({ stateId: mkt.states[0].id, title: 'Task' })
  ).data!;
  const client = linearClient(await createApiKey(owner.cookie));
  return { owner, asOwner, mkt, issue, client };
}

async function addMember(asOwner: Api, roleId?: string) {
  const member = await signUpTestUser({ name: 'Member' });
  const invite = await asOwner
    .teams({ teamKey: 'MKT' })
    .invites.post({ email: member.email, role: 'member', ...(roleId ? { roleId } : {}) });
  await authedApi(member.cookie).invites({ token: invite.data!.token }).accept.post();
  return member;
}

describe('graphql reactions', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('reacts to an issue, a comment and a project update', async () => {
    const { owner, asOwner, mkt, issue, client } = await setup();
    const comment = (await (
      await client.createComment({ issueId: issue.id, body: 'hi' })
    ).comment)!;
    const project = (await asOwner.projects.post({ name: 'P', teamIds: [mkt.team.id] })).data!;
    const update = await createUpdate(project.id, owner.userId, { body: 'u', health: 'onTrack' });
    for (const parent of [
      { issueId: issue.id },
      { commentId: comment.id },
      { projectUpdateId: update.id },
    ]) {
      const r = (await (await client.createReaction({ emoji: '👍', ...parent })).reaction)!;
      expect(r.emoji).toBe('👍');
    }
    const res = await gql(
      { cookie: owner.cookie },
      `{ issue(id: "${issue.id}") { reactions { emoji user { id } } reactionData } }`,
    );
    const issueData = res.body.data!.issue as { reactions: unknown; reactionData: unknown };
    expect(issueData.reactions).toEqual([{ emoji: '👍', user: { id: owner.userId } }]);
    expect(issueData.reactionData).toEqual([
      { emoji: '👍', count: 1, userIds: [owner.userId], reactionIds: expect.any(Array) },
    ]);
  });

  it('allows one reaction per user and emoji, and others may use the same emoji', async () => {
    const { owner, asOwner, issue, client } = await setup();
    await client.createReaction({ emoji: '+1', issueId: issue.id });
    const again = await gql(
      { cookie: owner.cookie },
      `mutation { reactionCreate(input: { emoji: "+1", issueId: "${issue.id}" }) { success } }`,
    );
    expect(errorCode(again)).toBe('CONFLICT');
    const member = await addMember(asOwner);
    const theirs = await gql(
      { cookie: member.cookie },
      `mutation { reactionCreate(input: { emoji: "+1", issueId: "${issue.id}" }) { success } }`,
    );
    expect(theirs.body.data).toEqual({ reactionCreate: { success: true } });
    const data = await gql(
      { cookie: owner.cookie },
      `{ issue(id: "${issue.id}") { reactionData } }`,
    );
    const grouped = (data.body.data!.issue as { reactionData: unknown[] }).reactionData;
    expect(grouped[0]).toMatchObject({ emoji: '+1', count: 2 });
  });

  it("refuses to remove another user's reaction", async () => {
    const { asOwner, issue, client } = await setup();
    const r = (await (await client.createReaction({ emoji: '🎉', issueId: issue.id })).reaction)!;
    const member = await addMember(asOwner);
    const res = await gql(
      { cookie: member.cookie },
      `mutation { reactionDelete(id: "${r.id}") { success } }`,
    );
    expect(errorCode(res)).toBe('FORBIDDEN');
    expect((await client.deleteReaction(r.id)).success).toBe(true);
  });

  it('refuses a reaction on a project update the viewer cannot see', async () => {
    const { owner, asOwner, mkt } = await setup();
    const project = (await asOwner.projects.post({ name: 'P', teamIds: [mkt.team.id] })).data!;
    const update = await createUpdate(project.id, owner.userId, { body: 'u', health: 'onTrack' });
    const role = await asOwner.teams({ teamKey: 'MKT' }).roles.post({
      name: 'Issues only',
      permissions: { work_items: { read: true, create: true, edit: false, delete: false } },
    });
    const member = await addMember(asOwner, role.data!.id);
    const res = await gql(
      { cookie: member.cookie },
      `mutation { reactionCreate(input: { emoji: "x", projectUpdateId: "${update.id}" }) { success } }`,
    );
    expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
  });

  it('rejects a blank emoji', async () => {
    const { owner, issue } = await setup();
    const res = await gql(
      { cookie: owner.cookie },
      `mutation { reactionCreate(input: { emoji: "  ", issueId: "${issue.id}" }) { success } }`,
    );
    expect(errorCode(res)).toBe('INVALID_INPUT');
  });

  it('sends Reaction webhooks', async () => {
    const { asOwner, issue, client } = await setup();
    const hook = (
      await asOwner
        .teams({ teamKey: 'MKT' })
        .webhooks.post({ url: 'https://example.com/h', resourceTypes: ['Reaction'] })
    ).data!;
    const r = (await (await client.createReaction({ emoji: '👀', issueId: issue.id })).reaction)!;
    await client.deleteReaction(r.id);
    const items = (await asOwner.webhooks({ webhookId: hook.id }).deliveries.get())
      .data!.items.map(
        (d) => d.payload as { action: string; type: string; data: { emoji: string } },
      )
      .reverse();
    expect(items.map((p) => [p.action, p.type, p.data.emoji])).toEqual([
      ['create', 'Reaction', '👀'],
      ['remove', 'Reaction', '👀'],
    ]);
  });
});
