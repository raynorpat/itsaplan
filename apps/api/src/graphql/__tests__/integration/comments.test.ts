import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { makePrivate, signUpWithRole } from '../../../__tests__/helpers/roles';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';
import { createUpdate } from '../../../projects/updates';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';

// Comments over the Linear API: replies one level deep, edit and delete rules,
// resolving threads, comments on projects and project updates, and visibility.

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

// A member of MKT with the given role (default member role when roleId is absent).
async function addMember(asOwner: Api) {
  const member = await signUpTestUser({ name: 'Member' });
  await asOwner.teams({ teamKey: 'MKT' }).members.post({ userId: member.userId });
  return { ...member, api: authedApi(member.cookie) };
}

const mention = (name: string, userId: string) => `@[${name}](user:${userId})`;

describe('graphql comments', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates a comment on an issue and reads it back', async () => {
    const { issue, client } = await setup();
    const created = (await (
      await client.createComment({ issueId: issue.id, body: 'hi' })
    ).comment)!;
    expect(created.body).toBe('hi');
    const listed = await (await client.issue(issue.id)).comments();
    expect(listed.nodes.map((c) => c.id)).toEqual([created.id]);
    expect((await client.comment({ id: created.id })).body).toBe('hi');
  });

  it('stores a reply to a reply under the root', async () => {
    const { issue, client } = await setup();
    const root = (await (await client.createComment({ issueId: issue.id, body: 'root' })).comment)!;
    const reply = (await (
      await client.createComment({ issueId: issue.id, body: 'r1', parentId: root.id })
    ).comment)!;
    const reply2 = (await (
      await client.createComment({ issueId: issue.id, body: 'r2', parentId: reply.id })
    ).comment)!;
    expect((await reply2.parent)?.id).toBe(root.id);
    expect((await root.children({ id: root.id })).nodes.map((c) => c.body).sort()).toEqual([
      'r1',
      'r2',
    ]);
  });

  it('rejects a reply whose thread is on another issue', async () => {
    const { owner, asOwner, mkt, issue, client } = await setup();
    const other = (
      await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId: mkt.states[0].id, title: 'o' })
    ).data!;
    const root = (await (await client.createComment({ issueId: other.id, body: 'root' })).comment)!;
    const res = await gql(
      { cookie: owner.cookie },
      `mutation { commentCreate(input: { issueId: "${issue.id}", body: "x", parentId: "${root.id}" }) { success } }`,
    );
    expect(errorCode(res)).toBe('INVALID_INPUT');
  });

  it('lets only the author edit and sets editedAt', async () => {
    const { asOwner, issue, client } = await setup();
    const c = (await (await client.createComment({ issueId: issue.id, body: 'hi' })).comment)!;
    const edited = (await (await client.updateComment(c.id, { body: 'hello' })).comment)!;
    expect(edited.body).toBe('hello');
    expect(edited.editedAt).toBeTruthy();
    const member = await addMember(asOwner);
    const res = await gql(
      { cookie: member.cookie },
      `mutation { commentUpdate(id: "${c.id}", input: { body: "mine" }) { success } }`,
    );
    expect(errorCode(res)).toBe('FORBIDDEN');
  });

  it('lets the author or a team owner delete; replies go with the root', async () => {
    const { asOwner, issue, client } = await setup();
    const member = await addMember(asOwner);
    const memberClient = linearClient(await createApiKey(member.cookie));
    const root = (await (
      await memberClient.createComment({ issueId: issue.id, body: 'root' })
    ).comment)!;
    await memberClient.createComment({ issueId: issue.id, body: 'reply', parentId: root.id });
    const other = (await (
      await client.createComment({ issueId: issue.id, body: 'owner' })
    ).comment)!;
    const denied = await gql(
      { cookie: member.cookie },
      `mutation { commentDelete(id: "${other.id}") { success } }`,
    );
    expect(errorCode(denied)).toBe('FORBIDDEN');
    expect((await client.deleteComment(root.id)).success).toBe(true);
    const left = await (await client.issue(issue.id)).comments();
    expect(left.nodes.map((c) => c.body)).toEqual(['owner']);
    const feed = await asOwner.issues({ issueId: issue.id }).feed.get();
    expect(feed.data!.items.filter((i) => i.kind === 'comment').map((i) => i.body)).toEqual([
      'owner',
    ]);
  });

  it('resolves a thread with a resolving reply and unresolves it; a reply cannot be resolved', async () => {
    const { owner, issue, client } = await setup();
    const root = (await (await client.createComment({ issueId: issue.id, body: 'q' })).comment)!;
    const answer = (await (
      await client.createComment({ issueId: issue.id, body: 'a', parentId: root.id })
    ).comment)!;
    const resolved = (await (
      await client.commentResolve(root.id, { resolvingCommentId: answer.id })
    ).comment)!;
    expect(resolved.resolvedAt).toBeTruthy();
    expect((await resolved.resolvingComment)?.id).toBe(answer.id);
    expect((await resolved.resolvingUser)?.id).toBe(owner.userId);
    const reopened = (await (await client.commentUnresolve(root.id)).comment)!;
    expect(reopened.resolvedAt).toBeFalsy();
    const res = await gql(
      { cookie: owner.cookie },
      `mutation { commentResolve(id: "${answer.id}") { success } }`,
    );
    expect(errorCode(res)).toBe('INVALID_INPUT');
  });

  it('shows project and project-update comments only through projects.read', async () => {
    const { owner, asOwner, mkt, client } = await setup();
    const project = (await asOwner.projects.post({ name: 'P', teamIds: [mkt.team.id] })).data!;
    const update = await createUpdate(project.id, owner.userId, { body: 'u', health: 'onTrack' });
    const onProject = (await (
      await client.createComment({ projectId: project.id, body: 'p' })
    ).comment)!;
    const onUpdate = (await (
      await client.createComment({ projectUpdateId: update.id, body: 'pu' })
    ).comment)!;
    expect((await (await client.project(project.id)).comments()).nodes.map((c) => c.id)).toEqual([
      onProject.id,
    ]);
    expect((await onUpdate.projectUpdate)?.id).toBe(update.id);
    await makePrivate(asOwner, 'MKT');
    const member = await signUpWithRole('member');
    for (const id of [onProject.id, onUpdate.id]) {
      const res = await gql({ cookie: member.cookie }, `{ comment(id: "${id}") { id } }`);
      expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
    }
    const listed = await gql(
      { cookie: member.cookie },
      `{ comments(filter: { project: { id: { eq: "${project.id}" } } }) { nodes { id } } }`,
    );
    expect(listed.body.data).toEqual({ comments: { nodes: [] } });
  });

  it("hides comments on another team's issues", async () => {
    const { asOwner, issue, client } = await setup();
    await makePrivate(asOwner, 'MKT');
    await client.createComment({ issueId: issue.id, body: 'secret' });
    const outsider = await signUpTestUser();
    await authedApi(outsider.cookie).teams.post({ key: 'OPS', name: 'Ops' });
    const res = await gql({ cookie: outsider.cookie }, '{ comments { nodes { id } } }');
    expect(res.body.data).toEqual({ comments: { nodes: [] } });
  });

  it('notifies only a newly mentioned member when an edit adds a mention', async () => {
    const { asOwner, issue, client } = await setup();
    const first = await addMember(asOwner);
    const second = await signUpTestUser({ name: 'Second' });
    await asOwner.teams({ teamKey: 'MKT' }).members.post({ userId: second.userId });
    const c = (await (
      await client.createComment({
        issueId: issue.id,
        body: `hi ${mention('Member', first.userId)}`,
      })
    ).comment)!;
    const firstBefore = (await first.api.notifications.get({ query: {} })).data!.items.length;
    await client.updateComment(c.id, {
      body: `hi ${mention('Member', first.userId)} and ${mention('Second', second.userId)}`,
    });
    const firstAfter = (await first.api.notifications.get({ query: {} })).data!.items.length;
    const secondInbox = (await authedApi(second.cookie).notifications.get({ query: {} })).data!
      .items;
    expect(firstAfter).toBe(firstBefore);
    expect(secondInbox.map((n) => n.type)).toEqual(['mentioned']);
  });

  it('sends webhooks for project comments and no notifications', async () => {
    const { asOwner, mkt, client } = await setup();
    const member = await addMember(asOwner);
    const hook = (
      await asOwner
        .teams({ teamKey: 'MKT' })
        .webhooks.post({ url: 'https://example.com/h', resourceTypes: ['Comment'] })
    ).data!;
    const project = (await asOwner.projects.post({ name: 'P', teamIds: [mkt.team.id] })).data!;
    await client.createComment({
      projectId: project.id,
      body: `look ${mention('Member', member.userId)}`,
    });
    const deliveries = (await webhookDeliveries(hook.id)).data!.items;
    expect(deliveries).toHaveLength(1);
    expect((await member.api.notifications.get({ query: {} })).data!.items).toEqual([]);
  });

  it('sends Comment update and remove webhooks', async () => {
    const { asOwner, issue, client } = await setup();
    const hook = (
      await asOwner
        .teams({ teamKey: 'MKT' })
        .webhooks.post({ url: 'https://example.com/h', resourceTypes: ['Comment'] })
    ).data!;
    const c = (await (await client.createComment({ issueId: issue.id, body: 'v1' })).comment)!;
    await client.updateComment(c.id, { body: 'v2' });
    await client.deleteComment(c.id);
    const items = (await webhookDeliveries(hook.id))
      .data!.items.map((d) => d.payload as { action: string; updatedFrom?: { body?: string } })
      .reverse();
    expect(items.map((p) => p.action)).toEqual(['create', 'update', 'remove']);
    expect(items[1]!.updatedFrom?.body).toBe('v1');
  });
});
