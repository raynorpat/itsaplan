import { beforeEach, describe, expect, it } from 'bun:test';
import { db, notification, user } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createIssue,
  createTeam,
  createWebhook,
  gqlData,
  makePrivate,
  signUpAs,
  statesByType,
} from '../../../__tests__/helpers/graphql';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';
import { createBoard, instance, ok, portal, visitor, type Json } from '../helpers';

// Comments on the portal: a visitor's comment is a Linear comment with an external
// user; a top-level one starts a portal thread that belongs to its board.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const member = await signUpAs('member', { name: 'Member' });
  const guest = await signUpAs('guest', { name: 'Guest' });
  const eng = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  await addMember(owner, 'ENG', guest.userId);
  await addMember(owner, 'ENG', member.userId);
  const states = statesByType(eng);
  const issue = await createIssue(member, {
    teamId: 'ENG',
    title: 'Dark mode',
    stateId: states.unstarted,
  });
  const threads = await createBoard(owner, {
    slug: 'eng',
    name: 'Engineering',
    teamId: eng.team.id,
  });
  const all = await createBoard(owner, {
    slug: 'all',
    name: 'Everything',
    teamId: eng.team.id,
    comments: 'all',
  });
  return { owner, member, guest, eng, issue, threads, all };
}

const commentsPath = (slug: string, identifier: string) =>
  `boards/${slug}/issues/${identifier}/comments`;

async function listComments(slug: string, identifier: string, cookie?: string): Promise<Json[]> {
  return (await ok(await portal(commentsPath(slug, identifier), { cookie }))).comments as Json[];
}

async function post(slug: string, identifier: string, cookie: string, body: Json) {
  return portal(commentsPath(slug, identifier), { cookie, body });
}

const ISSUE_COMMENTS = /* GraphQL */ `
  query ($id: String!) {
    issue(id: $id) {
      comments {
        nodes {
          id
          body
          parent {
            id
          }
          user {
            id
          }
          externalUser {
            name
            displayName
          }
          externalThread {
            type
            name
            url
          }
        }
      }
    }
  }
`;

async function issueComments(as: Parameters<typeof gqlData>[0], id: string): Promise<Json[]> {
  const data = await gqlData<Json>(as, ISSUE_COMMENTS, { id });
  return data.issue.comments.nodes as Json[];
}

async function memberComment(
  as: Parameters<typeof gqlData>[0],
  input: { issueId: string; body: string; parentId?: string },
): Promise<string> {
  const data = await gqlData<Json>(
    as,
    `mutation ($input: CommentCreateInput!) { commentCreate(input: $input) { comment { id } } }`,
    { input },
  );
  return data.commentCreate.comment.id as string;
}

describe('portal comments', () => {
  beforeEach(resetDb);

  it('stores a visitor comment as a Linear comment with its external user and portal thread', async () => {
    const { member, guest, issue } = await setup();
    const jane = await visitor('eng', 'Jane');
    const created = await ok(await post('eng', issue.identifier, jane.cookie, { body: 'Please!' }));
    expect(created.comment.body).toBe('Please!');
    expect(created.comment.mine).toBe(true);
    expect(created.comment.author).toEqual({ name: 'Jane', avatarUrl: null, team: false });

    const [asMember] = await issueComments(member, issue.id);
    expect(asMember!.user).toBeNull();
    expect(asMember!.externalUser.name).toBe('Jane');
    expect(asMember!.externalThread.type).toBe('portal');
    expect(asMember!.externalThread.name).toBe('Engineering');
    expect(asMember!.externalThread.url).toEndWith(`/portal/eng/${issue.identifier}`);

    const [asGuest] = await issueComments(guest, issue.id);
    expect(asGuest!.externalUser).toBeNull();
    expect(asGuest!.body).toBe('Please!');
  });

  it("shows a member's reply in a portal thread on the portal", async () => {
    const { member, issue } = await setup();
    const jane = await visitor('eng', 'Jane');
    const root = await ok(await post('eng', issue.identifier, jane.cookie, { body: 'Please!' }));
    await memberComment(member, { issueId: issue.id, body: 'On it', parentId: root.comment.id });
    const shown = await listComments('eng', issue.identifier);
    expect(shown.map((c) => [c.body, c.parentId, c.author.team])).toEqual([
      ['Please!', null, false],
      ['On it', root.comment.id, true],
    ]);
    expect(shown[1]!.author.name).toBe('Member');
    // Another visitor reads it too, and it is not theirs.
    const bob = await visitor('eng', 'Bob');
    expect((await listComments('eng', issue.identifier, bob.cookie)).map((c) => c.mine)).toEqual([
      false,
      false,
    ]);
  });

  it('hides internal comments on a portal-threads board and shows them on an all-comments board', async () => {
    const { member, issue } = await setup();
    await memberComment(member, { issueId: issue.id, body: 'Internal note' });
    expect(await listComments('eng', issue.identifier)).toEqual([]);
    expect((await listComments('all', issue.identifier)).map((c) => c.body)).toEqual([
      'Internal note',
    ]);
    // The board's comment count follows the same rule.
    const detail = await ok(await portal(`boards/all/issues/${issue.identifier}`));
    expect(detail.comments).toBe(1);
    expect((await ok(await portal(`boards/eng/issues/${issue.identifier}`))).comments).toBe(0);
  });

  it("never shows another board's thread, whatever the board's setting", async () => {
    const { issue } = await setup();
    const jane = await visitor('eng', 'Jane');
    await ok(await post('eng', issue.identifier, jane.cookie, { body: 'From eng' }));
    const bob = await visitor('all', 'Bob');
    await ok(await post('all', issue.identifier, bob.cookie, { body: 'From all' }));
    expect((await listComments('eng', issue.identifier)).map((c) => c.body)).toEqual(['From eng']);
    expect((await listComments('all', issue.identifier)).map((c) => c.body)).toEqual(['From all']);
  });

  it("refuses a reply into another board's thread", async () => {
    const { issue } = await setup();
    const jane = await visitor('eng', 'Jane');
    const root = await ok(await post('eng', issue.identifier, jane.cookie, { body: 'From eng' }));
    const bob = await visitor('all', 'Bob');
    const res = await post('all', issue.identifier, bob.cookie, {
      body: 'Me too',
      parentId: root.comment.id,
    });
    expect(res.status).toBe(404);
  });

  it('lets a visitor edit and delete only their own comments', async () => {
    const { issue } = await setup();
    const jane = await visitor('eng', 'Jane');
    const bob = await visitor('eng', 'Bob');
    const root = await ok(await post('eng', issue.identifier, jane.cookie, { body: 'Firts' }));
    const id = root.comment.id as string;

    const byBob = await portal(`boards/eng/comments/${id}`, {
      cookie: bob.cookie,
      method: 'PATCH',
      body: { body: 'Hacked' },
    });
    expect(byBob.status).toBe(403);
    const edited = await ok(
      await portal(`boards/eng/comments/${id}`, {
        cookie: jane.cookie,
        method: 'PATCH',
        body: { body: 'First' },
      }),
    );
    expect(edited.comment.body).toBe('First');
    expect(edited.comment.editedAt).not.toBeNull();

    const deleteByBob = await portal(`boards/eng/comments/${id}`, {
      cookie: bob.cookie,
      method: 'DELETE',
    });
    expect(deleteByBob.status).toBe(403);
    await ok(await portal(`boards/eng/comments/${id}`, { cookie: jane.cookie, method: 'DELETE' }));
    expect(await listComments('eng', issue.identifier)).toEqual([]);
  });

  it('needs a signed-in visitor and a body of at most 10,000 characters', async () => {
    const { issue } = await setup();
    expect((await post('eng', issue.identifier, '', { body: 'Hi' })).status).toBe(401);
    const jane = await visitor('eng', 'Jane');
    expect((await post('eng', issue.identifier, jane.cookie, { body: '' })).status).toBe(400);
    expect(
      (await post('eng', issue.identifier, jane.cookie, { body: 'x'.repeat(10_001) })).status,
    ).toBe(400);
  });

  it('lets a member start a portal thread on a board showing the issue', async () => {
    const { member, guest, issue, threads, all } = await setup();
    const started = await ok(
      await instance('portal/comment', member, {
        issueId: issue.id,
        boardId: threads.id,
        body: 'Shipping next week',
      }),
    );
    expect(typeof started.id).toBe('string');
    const shown = await listComments('eng', issue.identifier);
    expect(shown.map((c) => [c.body, c.author.team])).toEqual([['Shipping next week', true]]);
    const [asMember] = await issueComments(member, issue.id);
    expect(asMember!.externalThread.name).toBe('Engineering');
    expect(asMember!.user.id).toBe(member.userId);

    const asGuest = await instance('portal/comment', guest, {
      issueId: issue.id,
      boardId: threads.id,
      body: 'Hi',
    });
    expect(asGuest.status).toBe(403);
    // A board with every comment shown has no portal threads to start.
    const onAll = await instance('portal/comment', member, {
      issueId: issue.id,
      boardId: all.id,
      body: 'Hi',
    });
    expect(onAll.status).toBe(400);
  });

  it('refuses a portal thread on a board that does not show the issue', async () => {
    const { owner, member, issue } = await setup();
    const other = await createTeam(owner, { key: 'OPS', name: 'Operations' });
    const opsBoard = await createBoard(owner, { slug: 'ops', name: 'Ops', teamId: other.team.id });
    const res = await instance('portal/comment', member, {
      issueId: issue.id,
      boardId: opsBoard.id,
      body: 'Hi',
    });
    expect(res.status).toBe(400);
  });

  it("keeps a deleted board's threads off the other boards", async () => {
    const { owner, eng, issue } = await setup();
    const acme = await createBoard(owner, {
      slug: 'acme',
      name: 'Acme',
      teamId: eng.team.id,
      access: 'restricted',
      allowedDomains: ['acme.test'],
    });
    const kim = await visitor('acme', 'Kim', `kim-${Date.now()}@acme.test`);
    await ok(await post('acme', issue.identifier, kim.cookie, { body: 'Acme only' }));
    await ok(await instance('portal/boards/delete', owner, { id: acme.id }));
    const shown = await listComments('all', issue.identifier);
    expect(shown.map((c) => c.body)).not.toContain('Acme only');
  });

  it('shows a member without a name as Team', async () => {
    const { member, issue } = await setup();
    await db.update(user).set({ name: '' }).where(eq(user.id, member.userId));
    const jane = await visitor('eng', 'Jane');
    const root = (await ok(await post('eng', issue.identifier, jane.cookie, { body: 'Hi' })))
      .comment as Json;
    await gqlData(
      member,
      `mutation ($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`,
      { input: { issueId: issue.id, parentId: root.id, body: 'Hello' } },
    );
    const reply = (await listComments('eng', issue.identifier)).find((c) => c.body === 'Hello');
    expect(reply?.author).toEqual({ name: 'Team', avatarUrl: null, team: true });
  });

  it('refuses edits and deletes once the board no longer shows the issue', async () => {
    const { owner, issue } = await setup();
    const jane = await visitor('eng', 'Jane');
    const mine = (await ok(await post('eng', issue.identifier, jane.cookie, { body: 'Mine' })))
      .comment as Json;
    await makePrivate(owner, 'ENG');
    const edit = await portal(`boards/eng/comments/${mine.id}`, {
      cookie: jane.cookie,
      method: 'PATCH',
      body: { body: 'Changed' },
    });
    expect(edit.status).toBe(404);
    const del = await portal(`boards/eng/comments/${mine.id}`, {
      cookie: jane.cookie,
      method: 'DELETE',
      body: {},
    });
    expect(del.status).toBe(404);
  });

  it('ignores mentions in visitor comments', async () => {
    const { owner, member, issue } = await setup();
    const jane = await visitor('eng', 'Jane');
    const mention = `@[Owner](user:${owner.userId})`;
    const posted = (
      await ok(await post('eng', issue.identifier, jane.cookie, { body: `Hey ${mention}` }))
    ).comment as Json;
    await ok(
      await portal(`boards/eng/comments/${posted.id}`, {
        cookie: jane.cookie,
        method: 'PATCH',
        body: { body: `Again ${mention} @[Member](user:${member.userId})` },
      }),
    );
    const mentioned = await db
      .select()
      .from(notification)
      .where(eq(notification.type, 'mentioned'));
    expect(mentioned).toEqual([]);
  });

  it("sends the Comment webhook and notifies the issue's subscribers", async () => {
    const { owner, member, issue } = await setup();
    const hook = await createWebhook(owner, {
      url: 'https://example.com/hook',
      resourceTypes: ['Comment'],
      teamId: 'ENG',
    });
    const jane = await visitor('eng', 'Jane');
    await ok(await post('eng', issue.identifier, jane.cookie, { body: 'Please!' }));
    const deliveries = (await webhookDeliveries(hook.id)).data.items.map((d) => d.payload as Json);
    expect(deliveries.map((p) => `${p.type}:${p.action}`)).toEqual(['Comment:create']);
    expect(deliveries[0]!.data.externalUserId).toBe(jane.requesterId);
    const rows = await db
      .select()
      .from(notification)
      .where(and(eq(notification.userId, member.userId), eq(notification.type, 'commented')));
    expect(rows.length).toBe(1);
  });
});
