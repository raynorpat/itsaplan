import { beforeEach, describe, expect, it } from 'bun:test';
import { db, notification } from '@repo/db';
import { eq } from 'drizzle-orm';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createIssue,
  createProject,
  createTeam,
  createWebhook,
  gqlData,
  makePrivate,
  signUpAs,
  statesByType,
} from '../../../__tests__/helpers/graphql';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';
import { createBoard, instance, ok, portal, visitor, type Json } from '../helpers';

// What a visitor does on a board: read its issues (Top / New, search, detail), vote
// (a portal feedback item per person and issue) and suggest new issues.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const member = await signUpAs('member', { name: 'Member' });
  const guest = await signUpAs('guest', { name: 'Guest' });
  const eng = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  await addMember(owner, 'ENG', guest.userId);
  const states = statesByType(eng);
  const first = await createIssue(member, {
    teamId: 'ENG',
    title: 'Dark mode for the editor',
    description: 'Internal notes',
    stateId: states.unstarted,
  });
  const second = await createIssue(member, {
    teamId: 'ENG',
    title: 'Export to CSV',
    stateId: states.started,
  });
  const board = await createBoard(owner, {
    slug: 'eng',
    name: 'Engineering',
    teamId: eng.team.id,
    suggestionsEnabled: true,
    suggestionTeamId: eng.team.id,
    suggestionStateId: states.backlog,
  });
  await createBoard(owner, {
    slug: 'acme',
    name: 'Acme',
    teamId: eng.team.id,
    access: 'restricted',
    allowedDomains: ['acme.test'],
  });
  return { owner, member, guest, eng, states, first, second, board };
}

const issues = async (slug: string, query = '', cookie?: string) =>
  (await ok(await portal(`boards/${slug}/issues${query}`, { cookie }))).issues as Json[];

const vote = (slug: string, identifier: string, cookie: string, method = 'POST') =>
  portal(`boards/${slug}/issues/${identifier}/vote`, { cookie, method, body: {} });

describe('portal board reading and votes', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('lists the board issues by votes or by date, with counts and the public status', async () => {
    const { first, second } = await setup();
    const jane = await visitor('eng', 'Jane');
    const joe = await visitor('eng', 'Joe');
    await ok(await vote('eng', second.identifier, jane.cookie));
    await ok(await vote('eng', second.identifier, joe.cookie));
    await ok(await vote('eng', first.identifier, jane.cookie));

    const top = await issues('eng', '?sort=top', jane.cookie);
    expect(top.map((i) => [i.identifier, i.votes, i.status, i.voted])).toEqual([
      [second.identifier, 2, 'inProgress', true],
      [first.identifier, 1, 'planned', true],
    ]);
    expect(top[0]).toMatchObject({ comments: 0, underReview: false, title: 'Export to CSV' });
    const newest = await issues('eng', '?sort=new');
    expect(newest.map((i) => i.identifier)).toEqual([second.identifier, first.identifier]);
    expect(newest.every((i) => i.voted === false)).toBe(true);
    const found = await issues('eng', '?q=dark%20editor');
    expect(found.map((i) => i.identifier)).toEqual([first.identifier]);
  });

  it('shows the description only when the board allows it', async () => {
    const { owner, first, board } = await setup();
    const path = `boards/eng/issues/${first.identifier}`;
    expect((await ok(await portal(path))).description).toBeNull();
    await ok(
      await instance('portal/boards/update', owner, { id: board.id, showDescription: true }),
    );
    expect((await ok(await portal(path))).description).toBe('Internal notes');
    expect((await portal('boards/eng/issues/ENG-999')).status).toBe(404);
  });

  it('keeps a restricted board closed to visitors without access', async () => {
    const { first } = await setup();
    const outsider = await visitor('eng', 'Out');
    const closed = await ok(await portal('boards/acme', { cookie: outsider.cookie }));
    expect(closed).toEqual({
      name: 'Acme',
      access: 'restricted',
      canRead: false,
      visitor: expect.objectContaining({ displayName: 'Out' }),
    });
    expect((await portal('boards/acme/issues', { cookie: outsider.cookie })).status).toBe(404);
    expect((await vote('acme', first.identifier, outsider.cookie)).status).toBe(404);
    const insider = await visitor('acme', 'In', `in-${Date.now()}@acme.test`);
    expect((await ok(await portal('boards/acme', { cookie: insider.cookie }))).canRead).toBe(true);
    expect(await issues('acme', '', insider.cookie)).toHaveLength(2);
    expect((await portal('boards/missing')).status).toBe(404);
  });

  it('records one vote for two concurrent votes and unvotes it', async () => {
    const { first, member } = await setup();
    const jane = await visitor('eng', 'Jane');
    const results = await Promise.all([
      vote('eng', first.identifier, jane.cookie),
      vote('eng', first.identifier, jane.cookie),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const needs = async () =>
      (
        await gqlData(
          member,
          `query ($id: String!) { issue(id: $id) { needs { nodes { id } } } }`,
          {
            id: first.id,
          },
        )
      ).issue.needs.nodes as Json[];
    expect(await needs()).toHaveLength(1);
    expect(await ok(await vote('eng', first.identifier, jane.cookie, 'DELETE'))).toEqual({
      voted: false,
      votes: 0,
    });
    expect(await needs()).toHaveLength(0);
  });

  it('counts team-logged feedback as a vote and leaves it on unvote', async () => {
    const { first, member } = await setup();
    const jane = await visitor('eng', 'Jane');
    const { attachmentId } = await ok(
      await instance('feedback/attachment', member, {
        issueId: first.id,
        requesterId: jane.requesterId,
      }),
    );
    await gqlData(
      member,
      `mutation ($input: CustomerNeedCreateInput!) { customerNeedCreate(input: $input) { success } }`,
      { input: { issueId: first.id, attachmentId, body: 'Said on a call' } },
    );
    const detail = await ok(
      await portal(`boards/eng/issues/${first.identifier}`, { cookie: jane.cookie }),
    );
    expect(detail).toMatchObject({ voted: true, votes: 1 });
    expect(await ok(await vote('eng', first.identifier, jane.cookie))).toEqual({
      voted: true,
      votes: 1,
    });
    expect(await ok(await vote('eng', first.identifier, jane.cookie, 'DELETE'))).toEqual({
      voted: true,
      votes: 1,
    });
    const bodies = (
      await gqlData(
        member,
        `query ($id: String!) { issue(id: $id) { needs { nodes { body } } } }`,
        { id: first.id },
      )
    ).issue.needs.nodes.map((n: Json) => n.body);
    expect(bodies).toEqual(['Said on a call']);
  });

  it('completes many votes at once from different visitors', async () => {
    const { member, states } = await setup();
    const many = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        createIssue(member, { teamId: 'ENG', title: `Idea ${i}`, stateId: states.unstarted }),
      ),
    );
    const people: { cookie: string }[] = [];
    for (let i = 0; i < many.length; i++) people.push(await visitor('eng', `V${i}`));
    const results = await Promise.all(
      many.map((issue, i) => vote('eng', issue.identifier, people[i]!.cookie)),
    );
    expect(results.map((r) => r.status)).toEqual(many.map(() => 200));
  }, 20_000);

  it('hides the issues of a private team on a project board', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    await createTeam(owner, { key: 'ENG', name: 'Engineering' });
    const ops = await createTeam(owner, { key: 'OPS', name: 'Ops' });
    const project = await createProject(owner, { name: 'Launch', teamIds: [ops.team.id] });
    const issue = await createIssue(owner, { teamId: 'OPS', projectId: project.id });
    await createBoard(owner, { slug: 'launch', name: 'Launch', projectId: project.id });
    const jane = await visitor('launch', 'Jane');
    await ok(await vote('launch', issue.identifier, jane.cookie));
    await makePrivate(owner, 'OPS');
    expect(await issues('launch', '', jane.cookie)).toEqual([]);
    expect((await portal(`boards/launch/issues/${issue.identifier}`)).status).toBe(404);
    expect((await vote('launch', issue.identifier, jane.cookie)).status).toBe(404);
    expect((await vote('launch', issue.identifier, jane.cookie, 'DELETE')).status).toBe(404);
  });

  it('sends a CustomerNeed webhook for a vote and notifies no one', async () => {
    const { owner, member, first } = await setup();
    const hook = await createWebhook(owner, {
      url: 'https://example.com/hook',
      resourceTypes: ['CustomerNeed'],
      teamId: 'ENG',
    });
    const jane = await visitor('eng', 'Jane');
    await ok(await vote('eng', first.identifier, jane.cookie));
    const actions = (await webhookDeliveries(hook.id)).data.items.map(
      (d) => `${(d.payload as Json).type}:${(d.payload as Json).action}`,
    );
    expect(actions).toEqual(['CustomerNeed:create']);
    const rows = await db.select().from(notification).where(eq(notification.userId, member.userId));
    expect(rows).toEqual([]);
  });

  it('needs a signed-in visitor to vote', async () => {
    const { first } = await setup();
    expect((await portal(`boards/eng/issues/${first.identifier}/vote`, { body: {} })).status).toBe(
      401,
    );
  });
});

describe('portal suggestions', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates an issue with the board label and state, and the visitor feedback on it', async () => {
    const { member, guest, states } = await setup();
    const jane = await visitor('eng', 'Jane');
    const { identifier } = await ok(
      await portal('boards/eng/suggestions', {
        cookie: jane.cookie,
        body: { title: 'Keyboard shortcuts', details: 'I use the keyboard all day' },
      }),
    );
    const query = `query ($id: String!) { issue(id: $id) {
      title description creator { id } externalUserCreator { name }
      state { id } labels { nodes { name } } needs { nodes { body } } } }`;
    const seen = (await gqlData(member, query, { id: identifier })).issue;
    expect(seen).toEqual({
      title: 'Keyboard shortcuts',
      description: 'I use the keyboard all day',
      creator: null,
      externalUserCreator: { name: 'Jane' },
      state: { id: states.backlog },
      labels: { nodes: [{ name: 'Portal' }] },
      needs: { nodes: [{ body: 'I use the keyboard all day' }] },
    });
    const asGuest = (await gqlData(guest, query, { id: identifier })).issue;
    expect(asGuest.externalUserCreator).toBeNull();
  });

  it('shows a suggestion not on the board to its author only, as under review', async () => {
    const { owner, eng } = await setup();
    const label = await gqlData(
      owner,
      `mutation { issueLabelCreate(input: { name: "Public", color: "#000000" }) { issueLabel { id } } }`,
    );
    await createBoard(owner, {
      slug: 'curated',
      name: 'Curated',
      teamId: eng.team.id,
      labelIds: [label.issueLabelCreate.issueLabel.id],
      suggestionsEnabled: true,
      suggestionTeamId: eng.team.id,
      suggestionStateId: statesByType(eng).backlog,
    });
    const jane = await visitor('curated', 'Jane');
    const joe = await visitor('curated', 'Joe');
    const { identifier } = await ok(
      await portal('boards/curated/suggestions', {
        cookie: jane.cookie,
        body: { title: 'Offline mode', details: '' },
      }),
    );
    expect(await issues('curated', '', jane.cookie)).toEqual([
      expect.objectContaining({ identifier, underReview: true, status: 'planned', voted: true }),
    ]);
    expect(await issues('curated', '', joe.cookie)).toEqual([]);
    expect(
      (await portal(`boards/curated/issues/${identifier}`, { cookie: jane.cookie })).status,
    ).toBe(200);
    expect(
      (await portal(`boards/curated/issues/${identifier}`, { cookie: joe.cookie })).status,
    ).toBe(404);
  });

  it('refuses suggestions on a board without them, and a missing title', async () => {
    const { owner, board } = await setup();
    const jane = await visitor('eng', 'Jane');
    const suggest = (body: Json) => portal('boards/eng/suggestions', { cookie: jane.cookie, body });
    expect((await suggest({ title: ' ', details: '' })).status).toBe(400);
    expect((await suggest({ title: 'x'.repeat(256), details: '' })).status).toBe(400);
    await ok(
      await instance('portal/boards/update', owner, { id: board.id, suggestionsEnabled: false }),
    );
    expect((await suggest({ title: 'Something', details: '' })).status).toBe(403);
  });

  it('limits suggestions to 10 an hour per visitor', async () => {
    await setup();
    const jane = await visitor('eng', 'Jane');
    for (let i = 0; i < 10; i++)
      await ok(
        await portal('boards/eng/suggestions', {
          cookie: jane.cookie,
          body: { title: `Idea ${i}`, details: '' },
        }),
      );
    const res = await portal('boards/eng/suggestions', {
      cookie: jane.cookie,
      body: { title: 'One more', details: '' },
    });
    expect(res.status).toBe(429);
  });

  it('offers matching board issues before a suggestion', async () => {
    const { first } = await setup();
    const similar = (await ok(await portal('boards/eng/similar?q=editor%20dark'))).issues as Json[];
    expect(similar.map((i) => i.identifier)).toEqual([first.identifier]);
    expect(await ok(await portal('boards/eng/similar?q='))).toEqual({ issues: [] });
    // Any word counts; more matching words rank first.
    const longer = (
      await ok(await portal('boards/eng/similar?q=Please%20add%20dark%20mode%20support'))
    ).issues as Json[];
    expect(longer.map((i) => i.identifier)).toEqual([first.identifier]);
  });
});
