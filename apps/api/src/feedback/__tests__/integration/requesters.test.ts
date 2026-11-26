import { beforeEach, describe, expect, it } from 'bun:test';
import { app } from '../../../app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createIssue,
  createTeam,
  gqlData,
  makePrivate,
  signUpAs,
  teamView,
} from '../../../__tests__/helpers/graphql';
import { ORIGIN } from '../../../__tests__/helpers/oauth';

// Requesters (Linear's ExternalUser) through /api/auth/instance/requesters* and the
// feedback source attachment through /api/auth/instance/feedback/attachment: members
// find, create and edit people; owners and admins merge them; guests do nothing.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function call(
  path: string,
  init: { as?: TestUser; body?: unknown; query?: Record<string, string>; origin?: boolean } = {},
) {
  const headers = new Headers(init.origin === false ? {} : { origin: ORIGIN });
  if (init.as) headers.set('cookie', init.as.cookie);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  const qs = init.query ? `?${new URLSearchParams(init.query)}` : '';
  return app.handle(
    new Request(`http://localhost/api/auth/instance/${path}${qs}`, {
      method: init.body === undefined ? 'GET' : 'POST',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

async function ok(res: Response): Promise<Json> {
  const text = await res.text();
  if (res.status !== 200) throw new Error(`${res.status}: ${text}`);
  return JSON.parse(text) as Json;
}

const create = async (as: TestUser, body: Json) =>
  (await ok(await call('requesters/create', { as, body }))).requester as Json;

const list = async (as: TestUser, q?: string) =>
  (await ok(await call('requesters', { as, query: q ? { q } : {} }))).requesters as Json[];

const attach = async (as: TestUser, issueId: string, requesterId: string) =>
  (await ok(await call('feedback/attachment', { as, body: { issueId, requesterId } })))
    .attachmentId as string;

async function addFeedback(as: TestUser, issueId: string, requesterId: string, body: string) {
  const attachmentId = await attach(as, issueId, requesterId);
  const data = await gqlData(
    as,
    `mutation ($input: CustomerNeedCreateInput!) {
      customerNeedCreate(input: $input) { need { id } } }`,
    { input: { issueId, attachmentId, body } },
  );
  return data.customerNeedCreate.need.id as string;
}

async function counts(as: TestUser, issueId: string) {
  const data = await gqlData(
    as,
    `query ($id: String!) { issue(id: $id) {
      needs { nodes { body attachment { externalUserCreator { id } } } } } }`,
    { id: issueId },
  );
  const nodes = data.issue.needs.nodes as Json[];
  return {
    quotes: nodes.map((n) => n.body).sort(),
    people: new Set(nodes.map((n) => n.attachment.externalUserCreator.id)).size,
  };
}

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const member = await signUpAs('member', { name: 'Member' });
  const guest = await signUpAs('guest', { name: 'Guest' });
  await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  await addMember(owner, 'MKT', guest.userId);
  const view = await teamView(owner, 'MKT');
  const issue = await createIssue(owner, {
    teamId: 'MKT',
    stateId: view.states[0]!.id,
    title: 'Dark mode',
  });
  return { owner, member, guest, issue };
}

describe('requesters', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('creates one requester per email, ignoring case, even when created at once', async () => {
    const { member } = await setup();
    const [a, b] = await Promise.all([
      create(member, { name: 'Jane', email: 'Jane@X.com' }),
      create(member, { name: 'Jane D', email: 'jane@x.com' }),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.email).toBe('jane@x.com');
    expect((await list(member)).length).toBe(1);
  });

  it('creates a requester without an email and finds people by name or email', async () => {
    const { member } = await setup();
    await create(member, { name: 'Sam' });
    await create(member, { name: 'Jane', email: 'jane@x.com' });
    expect((await list(member, 'sam')).map((r) => r.name)).toEqual(['Sam']);
    expect((await list(member, 'JANE@')).map((r) => r.name)).toEqual(['Jane']);
    expect((await list(member)).length).toBe(2);
  });

  it('refuses a blank name', async () => {
    const { member } = await setup();
    const res = await call('requesters/create', { as: member, body: { name: '  ' } });
    expect(res.status).toBe(400);
  });

  it("refuses to give a requester another requester's email", async () => {
    const { member } = await setup();
    const jane = await create(member, { name: 'Jane', email: 'jane@x.com' });
    const sam = await create(member, { name: 'Sam' });
    const res = await call('requesters/update', {
      as: member,
      body: { id: sam.id, email: 'JANE@x.com' },
    });
    expect(res.status).toBe(409);
    const renamed = (
      await ok(
        await call('requesters/update', { as: member, body: { id: jane.id, name: 'Janet' } }),
      )
    ).requester;
    expect(renamed.name).toBe('Janet');
  });

  it('refuses guests on every endpoint', async () => {
    const { owner, guest, issue } = await setup();
    const jane = await create(owner, { name: 'Jane', email: 'jane@x.com' });
    const sam = await create(owner, { name: 'Sam' });
    const responses = [
      await call('requesters', { as: guest }),
      await call('requester', { as: guest, query: { id: jane.id } }),
      await call('requesters/create', { as: guest, body: { name: 'X' } }),
      await call('requesters/update', { as: guest, body: { id: jane.id, name: 'Y' } }),
      await call('requesters/merge', { as: guest, body: { fromId: sam.id, intoId: jane.id } }),
      await call('feedback/attachment', {
        as: guest,
        body: { issueId: issue.id, requesterId: jane.id },
      }),
    ];
    expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403]);
  });

  it('refuses without a session and checks the origin of cookie writes', async () => {
    const { member } = await setup();
    expect((await call('requesters')).status).toBe(401);
    const res = await call('requesters/create', {
      as: member,
      body: { name: 'X' },
      origin: false,
    });
    expect(res.status).toBe(403);
  });

  it('shows a person with their feedback grouped by issue', async () => {
    const { owner, issue } = await setup();
    const jane = await create(owner, { name: 'Jane', email: 'jane@x.com' });
    await addFeedback(owner, issue.id, jane.id, 'Please add dark mode');
    await addFeedback(owner, issue.id, jane.id, 'Still waiting');
    const person = (await ok(await call('requester', { as: owner, query: { id: jane.id } })))
      .requester;
    expect(person.name).toBe('Jane');
    expect(person.issues.length).toBe(1);
    expect(person.issues[0].issue.id).toBe(issue.id);
    expect(person.issues[0].feedback.map((f: Json) => f.body).sort()).toEqual([
      'Please add dark mode',
      'Still waiting',
    ]);
    const listed = (await list(owner))[0]!;
    expect(listed.feedbackCount).toBe(2);
    expect(listed.lastFeedbackAt).toBeTruthy();
  });

  it('lists the dates of a person’s first and latest feedback', async () => {
    const { owner, issue } = await setup();
    const jane = await create(owner, { name: 'Jane' });
    const sam = await create(owner, { name: 'Sam' });
    const first = await addFeedback(owner, issue.id, jane.id, 'First');
    await addFeedback(owner, issue.id, jane.id, 'Second');
    const data = await gqlData(
      owner,
      `query ($id: String!) { issue(id: $id) { needs { nodes { body createdAt } } } }`,
      { id: issue.id },
    );
    const createdAt = (body: string) =>
      new Date(
        (data.issue.needs.nodes as Json[]).find((n) => n.body === body)!.createdAt,
      ).getTime();
    const firstOf = async (id: string) =>
      new Date((await list(owner)).find((p) => p.id === id)!.firstFeedbackAt).getTime();
    expect(await firstOf(jane.id)).toBe(createdAt('First'));
    expect(createdAt('First')).toBeLessThan(createdAt('Second'));
    const janeListed = (await list(owner)).find((p) => p.id === jane.id)!;
    expect(new Date(janeListed.lastFeedbackAt).getTime()).toBe(createdAt('Second'));
    expect((await list(owner)).find((p) => p.id === sam.id)!.firstFeedbackAt).toBeNull();
    // Archived feedback does not count.
    await gqlData(owner, `mutation ($id: String!) { customerNeedArchive(id: $id) { success } }`, {
      id: first,
    });
    expect(await firstOf(jane.id)).toBe(createdAt('Second'));
  });

  it('lists the people whose first feedback is on or after a date, without names', async () => {
    const { owner, member, guest, issue } = await setup();
    const jane = await create(owner, { name: 'Jane', email: 'jane@x.com' });
    const sam = await create(owner, { name: 'Sam' });
    await create(owner, { name: 'Nobody' });
    await addFeedback(owner, issue.id, jane.id, 'First');
    await addFeedback(owner, issue.id, sam.id, 'Hello');
    const since = new Date(Date.now() - 60_000).toISOString();
    const res = await ok(await call('feedback/first-requests', { as: member, query: { since } }));
    const people = res.people as Json[];
    expect(people.map((p) => p.id).sort()).toEqual([jane.id, sam.id].sort());
    for (const p of people) {
      expect(Object.keys(p).sort()).toEqual(['firstFeedbackAt', 'id']);
      expect(p.firstFeedbackAt >= since).toBe(true);
    }
    const later = new Date(Date.now() + 60_000).toISOString();
    const none = await ok(
      await call('feedback/first-requests', { as: member, query: { since: later } }),
    );
    expect(none.people).toEqual([]);
    expect((await call('feedback/first-requests', { as: guest, query: { since } })).status).toBe(
      403,
    );
    expect(
      (await call('feedback/first-requests', { as: member, query: { since: 'soon' } })).status,
    ).toBe(400);
  });

  it('first-requests leaves out feedback on teams the user cannot see', async () => {
    const { owner, member, issue } = await setup();
    const jane = await create(owner, { name: 'Jane' });
    await addFeedback(owner, issue.id, jane.id, 'First');
    await makePrivate(owner, 'MKT');
    const since = new Date(Date.now() - 60_000).toISOString();
    const res = await ok(await call('feedback/first-requests', { as: member, query: { since } }));
    expect(res.people).toEqual([]);
  });

  it('merges one person into another (owners and admins only)', async () => {
    const { owner, member, issue } = await setup();
    const a = await create(owner, { name: 'J. Doe', email: 'jdoe@x.com' });
    const b = await create(owner, { name: 'Jane Doe' });
    await addFeedback(owner, issue.id, a.id, 'From A');
    await addFeedback(owner, issue.id, b.id, 'From B');
    expect((await counts(owner, issue.id)).people).toBe(2);

    const refused = await call('requesters/merge', {
      as: member,
      body: { fromId: a.id, intoId: b.id },
    });
    expect(refused.status).toBe(403);

    const merged = (
      await ok(await call('requesters/merge', { as: owner, body: { fromId: a.id, intoId: b.id } }))
    ).requester;
    expect(merged.id).toBe(b.id);
    // B had no email, so it takes A's.
    expect(merged.email).toBe('jdoe@x.com');
    expect(await counts(owner, issue.id)).toEqual({ quotes: ['From A', 'From B'], people: 1 });
    expect((await list(owner)).map((r) => r.id)).toEqual([b.id]);
    // A link to A opens B.
    const viaA = (await ok(await call('requester', { as: owner, query: { id: a.id } }))).requester;
    expect(viaA.id).toBe(b.id);
    // A's email still names B.
    expect((await create(owner, { name: 'Someone', email: 'JDOE@x.com' })).id).toBe(b.id);
  });

  it("keeps the person kept's email when both have one, and A's email still finds B", async () => {
    const { owner } = await setup();
    const a = await create(owner, { name: 'A', email: 'a@x.com' });
    const b = await create(owner, { name: 'B', email: 'b@x.com' });
    const merged = (
      await ok(await call('requesters/merge', { as: owner, body: { fromId: a.id, intoId: b.id } }))
    ).requester;
    expect(merged.email).toBe('b@x.com');
    expect((await create(owner, { name: 'Again', email: 'a@x.com' })).id).toBe(b.id);
  });

  it('refuses to merge a person into themselves', async () => {
    const { owner } = await setup();
    const a = await create(owner, { name: 'A' });
    const res = await call('requesters/merge', { as: owner, body: { fromId: a.id, intoId: a.id } });
    expect(res.status).toBe(400);
  });

  it('creates the source attachment only on an issue the caller can see', async () => {
    const { owner, member, issue } = await setup();
    const jane = await create(owner, { name: 'Jane', email: 'jane@x.com' });
    const attachmentId = await attach(member, issue.id, jane.id);
    expect(attachmentId).toBeTruthy();

    await makePrivate(owner, 'MKT');
    const hidden = await call('feedback/attachment', {
      as: member,
      body: { issueId: issue.id, requesterId: jane.id },
    });
    expect(hidden.status).toBe(404);
  });

  it('gives anyone who can see the issue, guests included, the number of people asking', async () => {
    const { owner, guest, issue } = await setup();
    const peopleOn = async (as: TestUser, issueId: string) =>
      (await ok(await call('feedback/count', { as, query: { issueId } }))).people as number;
    expect(await peopleOn(guest, issue.id)).toBe(0);

    const jane = await create(owner, { name: 'Jane', email: 'jane@x.com' });
    const jd = await create(owner, { name: 'J. D.', email: 'jd@x.com' });
    const sam = await create(owner, { name: 'Sam' });
    await addFeedback(owner, issue.id, jane.id, 'One');
    await addFeedback(owner, issue.id, jane.id, 'Two');
    await addFeedback(owner, issue.id, jd.id, 'Three');
    const archived = await addFeedback(owner, issue.id, sam.id, 'Archived');
    await gqlData(owner, `mutation ($id: String!) { customerNeedArchive(id: $id) { success } }`, {
      id: archived,
    });
    expect(await peopleOn(guest, issue.id)).toBe(2);

    await ok(
      await call('requesters/merge', { as: owner, body: { fromId: jd.id, intoId: jane.id } }),
    );
    expect(await peopleOn(guest, issue.id)).toBe(1);
    const body = await ok(
      await call('feedback/count', { as: guest, query: { issueId: issue.id } }),
    );
    expect(Object.keys(body)).toEqual(['people']);
  });

  it('hides the number of people asking on an issue the caller cannot see', async () => {
    const { owner, guest } = await setup();
    await createTeam(owner, { key: 'SEC', name: 'Secret' });
    await makePrivate(owner, 'SEC');
    const view = await teamView(owner, 'SEC');
    const hidden = await createIssue(owner, {
      teamId: 'SEC',
      stateId: view.states[0]!.id,
      title: 'Hidden',
    });
    expect(
      (await call('feedback/count', { as: guest, query: { issueId: hidden.id } })).status,
    ).toBe(404);
    expect((await call('feedback/count', { query: { issueId: hidden.id } })).status).toBe(401);
  });

  it('keeps two opposite merges at the same time from pointing at each other', async () => {
    const { owner } = await setup();
    const a = await create(owner, { name: 'Ann', email: 'ann@x.com' });
    const b = await create(owner, { name: 'Bea', email: 'bea@x.com' });
    const results = await Promise.all([
      call('requesters/merge', { as: owner, body: { fromId: a.id, intoId: b.id } }),
      call('requesters/merge', { as: owner, body: { fromId: b.id, intoId: a.id } }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(200);
    // Exactly one person is left active, and it resolves.
    const people = await list(owner);
    expect(people.map((p) => p.name).sort()).toHaveLength(1);
    const left = people[0]!;
    const page = await call('requester', { as: owner, query: { id: left.id } });
    expect(page.status).toBe(200);
  });
});
