import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  createIssue,
  createTeam,
  gqlData,
  makePrivate,
  statesByType,
  updateIssue,
} from '../../../__tests__/helpers/graphql';
import { dbNow } from '../../../updates/clock';
import { requesterChanges } from '../../../updates/changes';
import { createBoard, instance, ok, portal, portalLinks, visitor, type Json } from '../helpers';

// Boards with Customer access: readable only by the customer's people (by domain or a
// member's pick, checked on every request), boards of the customer's own requests, and
// votes and threads limited to the customer's people.

const turn = async (as: TestUser, enabled: boolean) =>
  ok(await instance('customers-settings/save', as, { enabled }));

const customer = async (as: TestUser, name: string, domains: string[]) =>
  (
    await gqlData(
      as,
      `mutation($input: CustomerCreateInput!) { customerCreate(input: $input) { customer { id } } }`,
      { input: { name, domains } },
    )
  ).customerCreate.customer.id as string;

const pick = async (as: TestUser, id: string, customerId: string | null) =>
  ok(await instance('requesters/customer', as, { id, customerId }));

async function teamFeedback(as: TestUser, issueId: string, requesterId: string) {
  const { attachmentId } = await ok(
    await instance('feedback/attachment', as, { issueId, requesterId }),
  );
  await gqlData(
    as,
    `mutation ($input: CustomerNeedCreateInput!) { customerNeedCreate(input: $input) { success } }`,
    { input: { issueId, attachmentId } },
  );
}

const person = async (as: TestUser, name: string, email: string) =>
  (await ok(await instance('requesters/create', as, { name, email }))).requester.id as string;

const issues = async (slug: string, cookie?: string) =>
  (await ok(await portal(`boards/${slug}/issues`, { cookie }))).issues as Json[];

const status = async (slug: string, cookie?: string) =>
  (await portal(`boards/${slug}/issues`, { cookie })).status;

const vote = async (slug: string, identifier: string, cookie: string) =>
  ok(await portal(`boards/${slug}/issues/${identifier}/vote`, { cookie, body: {} }));

async function linkSent(email: string, board: string): Promise<boolean> {
  portalLinks.delete(email);
  await ok(await portal('auth/link', { body: { email, board } }));
  for (let i = 0; i < 30; i++) {
    if (portalLinks.has(email)) return true;
    await Bun.sleep(10);
  }
  return false;
}

let run = 0;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  await turn(owner, true);
  const eng = await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  const states = statesByType(eng);
  const acme = await customer(owner, 'Acme', ['acme.com']);
  const globex = await customer(owner, 'Globex', ['globex.com']);
  const open = await createBoard(owner, {
    slug: 'open',
    name: 'Open',
    teamId: eng.team.id,
    comments: 'all',
  });
  const acmeBoard = await createBoard(owner, {
    slug: 'acme',
    name: 'Acme',
    teamId: eng.team.id,
    access: 'customer',
    customerId: acme,
  });
  const first = await createIssue(owner, {
    teamId: 'ENG',
    title: 'Dark mode',
    stateId: states.unstarted,
  });
  // Addresses unique to the test: links are limited per address in memory.
  const n = ++run;
  const alice = await visitor('acme', 'Alice', `alice-${n}@acme.com`);
  const adam = await visitor('acme', 'Adam', `adam-${n}@acme.com`);
  const gail = await visitor('open', 'Gail', `gail-${n}@globex.com`);
  return { owner, eng, states, acme, globex, open, acmeBoard, first, alice, adam, gail };
}

beforeEach(resetDb);

describe('customer access', () => {
  it("lets only the customer's people read a customer board", async () => {
    const { alice, gail } = await setup();
    expect(await status('acme', alice.cookie)).toBe(200);
    expect(await status('acme', gail.cookie)).toBe(404);
    expect(await status('acme')).toBe(404);
    const page = await ok(await portal('boards/acme', { cookie: gail.cookie }));
    expect(page).toMatchObject({ access: 'customer', canRead: false });
  });

  it("sends a sign-in link only to the customer's addresses", async () => {
    const { owner, acme } = await setup();
    expect(await linkSent(`new-${run}@acme.com`, 'acme')).toBe(true);
    expect(await linkSent(`new-${run}@globex.com`, 'acme')).toBe(false);
    // A person picked by hand with a personal address.
    const pat = await person(owner, 'Pat', 'pat@gmail.com');
    expect(await linkSent('pat@gmail.com', 'acme')).toBe(false);
    await pick(owner, pat, acme);
    expect(await linkSent('pat@gmail.com', 'acme')).toBe(true);
  });

  it('follows a change of customer on the next request', async () => {
    const { owner, acme, globex, alice, gail } = await setup();
    await pick(owner, alice.requesterId, globex);
    expect(await status('acme', alice.cookie)).toBe(404);
    await pick(owner, gail.requesterId, acme);
    expect(await status('acme', gail.cookie)).toBe(200);
  });

  it('makes the board not found when its customer is deleted', async () => {
    const { owner, acme, alice } = await setup();
    await gqlData(owner, `mutation($id: String!) { customerDelete(id: $id) { success } }`, {
      id: acme,
    });
    expect(await status('acme', alice.cookie)).toBe(404);
    const boards = (await ok(await instance('portal/boards', owner))).boards as Json[];
    expect(boards.find((b) => b.slug === 'acme')).toMatchObject({
      access: 'customer',
      customerId: null,
      customer: null,
    });
  });

  it('moves the board to the customer it is merged into', async () => {
    const { owner, acme, globex, gail, alice } = await setup();
    await gqlData(
      owner,
      `mutation($s: String!, $t: String!) {
        customerMerge(sourceCustomerId: $s, targetCustomerId: $t) { success } }`,
      { s: acme, t: globex },
    );
    expect(await status('acme', gail.cookie)).toBe(200);
    expect(await status('acme', alice.cookie)).toBe(200);
  });

  it('hides customer boards and sends no links while Customers is off', async () => {
    const { owner, alice, first } = await setup();
    await turn(owner, false);
    expect(await status('acme', alice.cookie)).toBe(404);
    expect(await linkSent(`new-${run}@acme.com`, 'acme')).toBe(false);
    const { boards } = await ok(await instance(`portal/issue-boards?issueId=${first.id}`, owner));
    expect((boards as Json[]).map((b) => b.slug)).toEqual(['open']);
  });
});

describe("a board of the customer's requests", () => {
  it('shows only active issues of public teams the customer asked for', async () => {
    const { owner, states, acme, alice, gail, first } = await setup();
    await createBoard(owner, {
      slug: 'acme-requests',
      name: 'Acme requests',
      access: 'customer',
      customerId: acme,
      shows: 'customerRequests',
    });
    const globexOnly = await createIssue(owner, { teamId: 'ENG', title: 'Globex only' });
    const canceled = await createIssue(owner, {
      teamId: 'ENG',
      title: 'Canceled',
      stateId: states.canceled,
    });
    const ops = await createTeam(owner, { key: 'OPS', name: 'Ops' });
    const hidden = await createIssue(owner, { teamId: 'OPS', title: 'Private work' });
    await teamFeedback(owner, first.id, alice.requesterId);
    await teamFeedback(owner, canceled.id, alice.requesterId);
    await teamFeedback(owner, hidden.id, alice.requesterId);
    await teamFeedback(owner, globexOnly.id, gail.requesterId);
    await makePrivate(owner, ops.team.id);

    const shown = await issues('acme-requests', alice.cookie);
    expect(shown.map((i) => i.title)).toEqual(['Dark mode']);
    const { boards } = await ok(await instance(`portal/issue-boards?issueId=${first.id}`, owner));
    expect((boards as Json[]).map((b) => b.slug).sort()).toEqual(['acme', 'acme-requests', 'open']);
    const other = await ok(await instance(`portal/issue-boards?issueId=${globexOnly.id}`, owner));
    expect((other.boards as Json[]).map((b) => b.slug).sort()).toEqual(['acme', 'open']);
  });

  it('refuses customer boards without a customer or with the wrong access', async () => {
    const { owner, eng, acme } = await setup();
    const bad = (body: Json) => instance('portal/boards/create', owner, { name: 'X', ...body });
    expect((await bad({ slug: 'x1', teamId: eng.team.id, access: 'customer' })).status).toBe(400);
    expect((await bad({ slug: 'x2', shows: 'customerRequests', access: 'public' })).status).toBe(
      400,
    );
    expect(
      (
        await bad({
          slug: 'x3',
          shows: 'customerRequests',
          access: 'customer',
          customerId: acme,
          teamId: eng.team.id,
        })
      ).status,
    ).toBe(400);
    await turn(owner, false);
    expect(
      (await bad({ slug: 'x4', teamId: eng.team.id, access: 'customer', customerId: acme })).status,
    ).toBe(400);
  });
});

describe("the customer's activity only", () => {
  it("counts only the customer's people on a customer board", async () => {
    const { first, alice, adam, gail } = await setup();
    await vote('acme', first.identifier, alice.cookie);
    await vote('acme', first.identifier, adam.cookie);
    const after = await vote('open', first.identifier, gail.cookie);
    expect(after.votes).toBe(3);
    expect((await issues('acme', alice.cookie))[0]).toMatchObject({ votes: 2, voted: true });
    expect((await issues('open', gail.cookie))[0]).toMatchObject({ votes: 3 });
    const mine = await vote('acme', first.identifier, adam.cookie);
    expect(mine.votes).toBe(2);
  });

  it("shows only the customer's people and the team in a customer board's threads", async () => {
    const { owner, globex, first, alice, adam, gail, acmeBoard } = await setup();
    const post = (slug: string, cookie: string, body: Json) =>
      portal(`boards/${slug}/issues/${first.identifier}/comments`, { cookie, body });
    const thread = (await ok(await post('acme', alice.cookie, { body: 'From Alice' }))).comment;
    await ok(
      await instance('portal/comment', owner, {
        issueId: first.id,
        boardId: acmeBoard.id,
        body: 'From the team',
      }),
    );
    const read = async (slug: string, cookie: string) =>
      (
        (await ok(await portal(`boards/${slug}/issues/${first.identifier}/comments`, { cookie })))
          .comments as Json[]
      ).map((c) => c.body);
    expect((await read('acme', adam.cookie)).sort()).toEqual(['From Alice', 'From the team']);
    expect(thread).toBeTruthy();

    // An all-comments customer board: team comments show, other customers' replies do not.
    await createBoard(owner, {
      slug: 'acme-all',
      name: 'Acme all',
      teamId: (await ok(await instance('portal/boards', owner))).boards[0].teamId,
      access: 'customer',
      customerId: acmeBoard.customerId,
      comments: 'all',
    });
    const root = await gqlData(
      owner,
      `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { comment { id } } }`,
      { input: { issueId: first.id, body: 'Team note' } },
    );
    await ok(
      await post('open', gail.cookie, {
        body: 'Gail reply',
        parentId: root.commentCreate.comment.id,
      }),
    );
    const all = await read('acme-all', adam.cookie);
    expect(all).toContain('Team note');
    expect(all).not.toContain('Gail reply');

    // Alice moves to Globex: her thread leaves Acme's board.
    await pick(owner, alice.requesterId, globex);
    expect(await read('acme', adam.cookie)).toEqual(['From the team']);
  });

  it('links requester updates to a customer board only for its people', async () => {
    const { owner, states, first, alice, gail } = await setup();
    await vote('acme', first.identifier, alice.cookie);
    await vote('open', first.identifier, gail.cookie);
    const since = await dbNow();
    await Bun.sleep(5);
    await updateIssue(owner, first.id, { stateId: states.started });
    await Bun.sleep(5);
    const until = await dbNow();
    const [forAlice] = await requesterChanges(alice.requesterId, since, until);
    const [forGail] = await requesterChanges(gail.requesterId, since, until);
    expect(forAlice).toMatchObject({ url: expect.stringContaining(`/portal/acme/`) });
    expect(forGail).toMatchObject({ url: expect.stringContaining(`/portal/open/`) });
  });
});
