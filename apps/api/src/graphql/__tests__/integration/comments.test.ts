import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';
import { createUpdate } from '../../../projects/updates';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';
import {
  addMember,
  createIssue,
  createProject,
  createTeam,
  createWebhook,
  gqlData,
  makePrivate,
  signUpAs,
  teamView,
} from '../../../__tests__/helpers/graphql';

// Comments over the Linear API: replies one level deep, edit and delete rules,
// resolving threads, comments on projects and project updates, and visibility.

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const mkt = await teamView(owner, 'MKT');
  const issue = await createIssue(owner, {
    teamId: 'MKT',
    stateId: mkt.states[0]!.id,
    title: 'Task',
  });
  const client = linearClient(await createApiKey(owner.cookie));
  return { owner, mkt, issue, client };
}

// A member of MKT.
async function joinTeam(owner: TestUser) {
  const member = await signUpTestUser({ name: 'Member' });
  await addMember(owner, 'MKT', member.userId);
  return member;
}

// The notification types in a user's inbox.
async function inbox(who: TestUser): Promise<string[]> {
  const data = await gqlData(who, '{ notifications { nodes { type } } }');
  return data.notifications.nodes.map((n: { type: string }) => n.type);
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
    const { owner, mkt, issue, client } = await setup();
    const other = await createIssue(owner, {
      teamId: 'MKT',
      stateId: mkt.states[0].id,
      title: 'o',
    });
    const root = (await (await client.createComment({ issueId: other.id, body: 'root' })).comment)!;
    const res = await gql(
      { cookie: owner.cookie },
      `mutation { commentCreate(input: { issueId: "${issue.id}", body: "x", parentId: "${root.id}" }) { success } }`,
    );
    expect(errorCode(res)).toBe('INVALID_INPUT');
  });

  it('lets only the author edit and sets editedAt', async () => {
    const { owner, issue, client } = await setup();
    const c = (await (await client.createComment({ issueId: issue.id, body: 'hi' })).comment)!;
    const edited = (await (await client.updateComment(c.id, { body: 'hello' })).comment)!;
    expect(edited.body).toBe('hello');
    expect(edited.editedAt).toBeTruthy();
    const member = await joinTeam(owner);
    const res = await gql(
      { cookie: member.cookie },
      `mutation { commentUpdate(id: "${c.id}", input: { body: "mine" }) { success } }`,
    );
    expect(errorCode(res)).toBe('FORBIDDEN');
  });

  it('lets the author or a team owner delete; replies go with the root', async () => {
    const { owner, issue, client } = await setup();
    const member = await joinTeam(owner);
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
    const { owner, mkt, client } = await setup();
    const project = await createProject(owner, { name: 'P', teamIds: [mkt.team.id] });
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
    await makePrivate(owner, 'MKT');
    const member = await signUpAs('member');
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
    const { owner, issue, client } = await setup();
    await makePrivate(owner, 'MKT');
    await client.createComment({ issueId: issue.id, body: 'secret' });
    const outsider = await signUpTestUser();
    await createTeam(outsider, { key: 'OPS', name: 'Ops' });
    const res = await gql({ cookie: outsider.cookie }, '{ comments { nodes { id } } }');
    expect(res.body.data).toEqual({ comments: { nodes: [] } });
  });

  it('notifies only a newly mentioned member when an edit adds a mention', async () => {
    const { owner, issue, client } = await setup();
    const first = await joinTeam(owner);
    const second = await signUpTestUser({ name: 'Second' });
    await addMember(owner, 'MKT', second.userId);
    const c = (await (
      await client.createComment({
        issueId: issue.id,
        body: `hi ${mention('Member', first.userId)}`,
      })
    ).comment)!;
    const firstBefore = (await inbox(first)).length;
    await client.updateComment(c.id, {
      body: `hi ${mention('Member', first.userId)} and ${mention('Second', second.userId)}`,
    });
    const firstAfter = (await inbox(first)).length;
    expect(firstAfter).toBe(firstBefore);
    expect(await inbox(second)).toEqual(['issueCommentMention']);
  });

  it('sends webhooks for project comments and no notifications', async () => {
    const { owner, mkt, client } = await setup();
    const member = await joinTeam(owner);
    const hook = await createWebhook(owner, {
      teamId: 'MKT',
      url: 'https://example.com/h',
      resourceTypes: ['Comment'],
    });
    const project = await createProject(owner, { name: 'P', teamIds: [mkt.team.id] });
    await client.createComment({
      projectId: project.id,
      body: `look ${mention('Member', member.userId)}`,
    });
    const deliveries = (await webhookDeliveries(hook.id)).data!.items;
    expect(deliveries).toHaveLength(1);
    expect(await inbox(member)).toEqual([]);
  });

  it('sends Comment update and remove webhooks', async () => {
    const { owner, issue, client } = await setup();
    const hook = await createWebhook(owner, {
      teamId: 'MKT',
      url: 'https://example.com/h',
      resourceTypes: ['Comment'],
    });
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
