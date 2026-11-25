import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  createIssue,
  createTeam,
  createWebhook,
  gqlData,
  signUpAs,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';
import { createBoard, instance, ok, visitor, type Json } from '../../../portal/__tests__/helpers';

// Which customer a person and their requests belong to: the email domain match, a
// member's manual pick, and the moves that keep requests with their person's customer.

const CREATE = `mutation($input: CustomerCreateInput!) {
  customerCreate(input: $input) { customer { id } } }`;
const UPDATE = `mutation($id: String!, $input: CustomerUpdateInput!) {
  customerUpdate(id: $id, input: $input) { success } }`;
const NEED_CREATE = `mutation($input: CustomerNeedCreateInput!) {
  customerNeedCreate(input: $input) { need { id updatedAt customer { id } } } }`;
const NEED = `query($id: String!) { customerNeed(id: $id) { id updatedAt customer { id } } }`;

const turn = async (as: TestUser, enabled: boolean) =>
  ok(await instance('customers-settings/save', as, { enabled }));

const customer = async (as: TestUser, name: string, domains: string[] = []) =>
  (await gqlData(as, CREATE, { input: { name, domains } })).customerCreate.customer.id as string;

const person = async (as: TestUser, name: string, email?: string) =>
  (await ok(await instance('requesters/create', as, { name, email }))).requester as Json;

const readPerson = async (as: TestUser, id: string) =>
  ((await ok(await instance(`requester?id=${id}`, as))).requester.customer ?? null) as Json | null;

const pick = (as: TestUser, id: string, customerId: string | null) =>
  instance('requesters/customer', as, { id, customerId });

async function feedback(as: TestUser, issueId: string, requesterId: string) {
  const { attachmentId } = await ok(
    await instance('feedback/attachment', as, { issueId, requesterId }),
  );
  return (await gqlData(as, NEED_CREATE, { input: { issueId, attachmentId } })).customerNeedCreate
    .need as { id: string; updatedAt: string; customer: { id: string } | null };
}

const needCustomer = async (as: TestUser, id: string) =>
  ((await gqlData(as, NEED, { id })).customerNeed.customer?.id ?? null) as string | null;

async function errorCode(as: TestUser, query: string, variables?: Record<string, unknown>) {
  const res = await gql({ cookie: as.cookie }, query, variables);
  return res.body.errors?.[0]?.extensions?.code as string | undefined;
}

async function setup() {
  const owner = await signUpTestUser();
  await turn(owner, true);
  const eng = await createTeam(owner, { key: 'ENG' });
  const issue = await createIssue(owner, { teamId: eng.team.id, title: 'Dark mode' });
  return { owner, eng, issue };
}

describe('customer matching', () => {
  beforeEach(resetDb);

  it('a person is matched by email domain, case-insensitively', async () => {
    const { owner } = await setup();
    const acme = await customer(owner, 'Acme', ['acme.com']);
    const bob = await person(owner, 'Bob', 'Bob@ACME.com');
    expect(bob.customer).toEqual({ id: acme, name: 'Acme', source: 'domain' });
    const eng = await person(owner, 'Eve', 'eve@eng.acme.com');
    expect(eng.customer).toBeNull();
  });

  it('creating a customer matches existing people and moves their past requests', async () => {
    const { owner, issue } = await setup();
    const hook = await createWebhook(owner, {
      url: 'https://example.com/hook',
      resourceTypes: ['CustomerNeed'],
      allPublicTeams: true,
    });
    const bob = await person(owner, 'Bob', 'bob@acme.com');
    const need = await feedback(owner, issue.id, bob.id);
    expect(need.customer).toBeNull();
    const before = (await webhookDeliveries(hook.id)).data.items.length;
    const acme = await customer(owner, 'Acme', ['acme.com']);
    expect((await readPerson(owner, bob.id))?.id).toBe(acme);
    const read = (await gqlData(owner, NEED, { id: need.id })).customerNeed;
    expect(read.customer.id).toBe(acme);
    expect(read.updatedAt).toBe(need.updatedAt);
    expect((await webhookDeliveries(hook.id)).data.items.length).toBe(before);
  });

  it('a new request takes its person’s customer', async () => {
    const { owner, issue } = await setup();
    const acme = await customer(owner, 'Acme', ['acme.com']);
    const bob = await person(owner, 'Bob', 'bob@acme.com');
    expect((await feedback(owner, issue.id, bob.id)).customer?.id).toBe(acme);
  });

  it('a manual pick wins over a domain, and clearing it applies the domain again', async () => {
    const { owner, issue } = await setup();
    const acme = await customer(owner, 'Acme', ['acme.com']);
    const globex = await customer(owner, 'Globex', ['globex.com']);
    const bob = await person(owner, 'Bob', 'bob@acme.com');
    const need = await feedback(owner, issue.id, bob.id);
    await ok(await pick(owner, bob.id, globex));
    expect(await readPerson(owner, bob.id)).toEqual({
      id: globex,
      name: 'Globex',
      source: 'manual',
    });
    expect(await needCustomer(owner, need.id)).toBe(globex);
    // A domain change on another customer leaves the manual pick alone.
    await gqlData(owner, UPDATE, { id: acme, input: { domains: ['acme.com', 'acme.io'] } });
    expect((await readPerson(owner, bob.id))?.id).toBe(globex);
    await ok(await pick(owner, bob.id, null));
    expect(await readPerson(owner, bob.id)).toEqual({ id: acme, name: 'Acme', source: 'domain' });
    expect(await needCustomer(owner, need.id)).toBe(acme);
  });

  it('a person with a personal address is picked by hand', async () => {
    const { owner } = await setup();
    const acme = await customer(owner, 'Acme', ['acme.com']);
    const ann = await person(owner, 'Ann', 'ann@gmail.com');
    expect(ann.customer).toBeNull();
    const picked = (await ok(await pick(owner, ann.id, acme))).requester as Json;
    expect(picked.customer.source).toBe('manual');
    // Clearing a pick with no matching domain leaves no customer.
    await ok(await pick(owner, ann.id, null));
    expect(await readPerson(owner, ann.id)).toBeNull();
  });

  it('removing a domain unlinks its domain-matched people only', async () => {
    const { owner } = await setup();
    const acme = await customer(owner, 'Acme', ['acme.com', 'acme.io']);
    const bob = await person(owner, 'Bob', 'bob@acme.com');
    const ivy = await person(owner, 'Ivy', 'ivy@acme.io');
    const ann = await person(owner, 'Ann', 'ann@acme.com');
    await ok(await pick(owner, ann.id, acme));
    await gqlData(owner, UPDATE, { id: acme, input: { domains: ['acme.io'] } });
    expect(await readPerson(owner, bob.id)).toBeNull();
    expect((await readPerson(owner, ivy.id))?.id).toBe(acme);
    expect((await readPerson(owner, ann.id))?.source).toBe('manual');
  });

  it('changing a person’s email re-matches them', async () => {
    const { owner } = await setup();
    await customer(owner, 'Acme', ['acme.com']);
    const globex = await customer(owner, 'Globex', ['globex.com']);
    const bob = await person(owner, 'Bob', 'bob@acme.com');
    await ok(await instance('requesters/update', owner, { id: bob.id, email: 'bob@globex.com' }));
    expect((await readPerson(owner, bob.id))?.id).toBe(globex);
    await ok(await instance('requesters/update', owner, { id: bob.id, email: 'bob@gmail.com' }));
    expect(await readPerson(owner, bob.id)).toBeNull();
  });

  it('a portal sign-in creates a matched person', async () => {
    const { owner, eng } = await setup();
    const acme = await customer(owner, 'Acme', ['acme.com']);
    await createBoard(owner, { slug: 'eng', name: 'Engineering', teamId: eng.team.id });
    const v = await visitor('eng', 'Vic', 'vic@acme.com');
    expect((await readPerson(owner, v.requesterId))?.id).toBe(acme);
  });

  it('merging people across customers gives the merged requests the kept person’s customer', async () => {
    const { owner, issue } = await setup();
    const globex = await customer(owner, 'Globex', ['globex.com']);
    await customer(owner, 'Acme', ['acme.com']);
    const a = await person(owner, 'Bob A', 'bob@acme.com');
    const b = await person(owner, 'Bob G', 'bob@globex.com');
    const need = await feedback(owner, issue.id, a.id);
    const kept = (
      await ok(await instance('requesters/merge', owner, { fromId: a.id, intoId: b.id }))
    ).requester as Json;
    expect(kept.customer.id).toBe(globex);
    expect(await needCustomer(owner, need.id)).toBe(globex);
  });

  it('a kept person without an email takes the merged email and its customer', async () => {
    const { owner, issue } = await setup();
    const acme = await customer(owner, 'Acme', ['acme.com']);
    const a = await person(owner, 'Bob A', 'bob@acme.com');
    const b = await person(owner, 'Bob');
    const need = await feedback(owner, issue.id, a.id);
    await ok(await instance('requesters/merge', owner, { fromId: a.id, intoId: b.id }));
    expect((await readPerson(owner, b.id))?.id).toBe(acme);
    expect(await needCustomer(owner, need.id)).toBe(acme);
  });

  it('merging customers moves people and requests; deleting clears them', async () => {
    const { owner, issue } = await setup();
    const acme = await customer(owner, 'Acme', ['acme.com']);
    const eu = await customer(owner, 'Acme EU', ['acme.eu']);
    const bob = await person(owner, 'Bob', 'bob@acme.eu');
    const need = await feedback(owner, issue.id, bob.id);
    await gqlData(
      owner,
      `mutation($s: String!, $t: String!) {
        customerMerge(sourceCustomerId: $s, targetCustomerId: $t) { success } }`,
      { s: eu, t: acme },
    );
    expect((await readPerson(owner, bob.id))?.id).toBe(acme);
    expect(await needCustomer(owner, need.id)).toBe(acme);
    await gqlData(owner, `mutation($id: String!) { customerDelete(id: $id) { success } }`, {
      id: acme,
    });
    expect(await readPerson(owner, bob.id)).toBeNull();
    expect(await needCustomer(owner, need.id)).toBeNull();
  });

  it('a request with a person refuses a different customer', async () => {
    const { owner, issue } = await setup();
    await customer(owner, 'Acme', ['acme.com']);
    const globex = await customer(owner, 'Globex', ['globex.com']);
    const bob = await person(owner, 'Bob', 'bob@acme.com');
    const { attachmentId } = await ok(
      await instance('feedback/attachment', owner, { issueId: issue.id, requesterId: bob.id }),
    );
    const res = await gql({ cookie: owner.cookie }, NEED_CREATE, {
      input: { issueId: issue.id, attachmentId, customerId: globex },
    });
    expect(res.body.errors?.[0]?.extensions?.code).toBe('INVALID_INPUT');
    expect(res.body.errors?.[0]?.message).toContain(
      'The customer of a request follows its requester',
    );
    const need = await feedback(owner, issue.id, bob.id);
    expect(
      await errorCode(
        owner,
        `mutation($id: String!, $input: CustomerNeedUpdateInput!) {
          customerNeedUpdate(id: $id, input: $input) { success } }`,
        { id: need.id, input: { customerId: globex } },
      ),
    ).toBe('INVALID_INPUT');
  });

  it('a request without a person stores the given customer', async () => {
    const { owner, issue } = await setup();
    const acme = await customer(owner, 'Acme');
    await gqlData(owner, UPDATE, { id: acme, input: { externalIds: ['crm-1'] } });
    const need = (
      await gqlData(owner, NEED_CREATE, { input: { issueId: issue.id, customerId: acme } })
    ).customerNeedCreate.need;
    expect(need.customer.id).toBe(acme);
    const byExternal = (
      await gqlData(owner, NEED_CREATE, {
        input: { issueId: issue.id, customerExternalId: 'crm-1' },
      })
    ).customerNeedCreate.need;
    expect(byExternal.customer.id).toBe(acme);
    expect(
      await errorCode(owner, NEED_CREATE, {
        input: { issueId: issue.id, customerId: acme, customerExternalId: 'crm-1' },
      }),
    ).toBe('INVALID_INPUT');
    const updated = await gqlData(
      owner,
      `mutation($id: String!, $input: CustomerNeedUpdateInput!) {
        customerNeedUpdate(id: $id, input: $input) { need { customer { id } } } }`,
      { id: need.id, input: { customerId: null } },
    );
    expect(updated.customerNeedUpdate.need.customer).toBeNull();
  });

  it('customerNeeds filters by customer', async () => {
    const { owner, issue } = await setup();
    const acme = await customer(owner, 'Acme', ['acme.com']);
    const bob = await person(owner, 'Bob', 'bob@acme.com');
    const ann = await person(owner, 'Ann', 'ann@other.com');
    const mine = await feedback(owner, issue.id, bob.id);
    await feedback(owner, issue.id, ann.id);
    const data = await gqlData(
      owner,
      `query($id: ID) { customerNeeds(filter: { customer: { id: { eq: $id } } }) { nodes { id } } }`,
      { id: acme },
    );
    expect(data.customerNeeds.nodes).toEqual([{ id: mine.id }]);
    const none = await gqlData(
      owner,
      `query { customerNeeds(filter: { customer: { null: true } }) { nodes { id } } }`,
    );
    expect(none.customerNeeds.nodes.length).toBe(1);
  });

  it('the requesters list filters by customer', async () => {
    const { owner } = await setup();
    const acme = await customer(owner, 'Acme', ['acme.com']);
    const bob = await person(owner, 'Bob', 'bob@acme.com');
    await person(owner, 'Ann', 'ann@other.com');
    const list = (await ok(await instance(`requesters?customerId=${acme}`, owner)))
      .requesters as Json[];
    expect(list.map((r) => r.id)).toEqual([bob.id]);
  });

  it('with Customers off a person’s customer is hidden and cannot be picked', async () => {
    const { owner } = await setup();
    const acme = await customer(owner, 'Acme', ['acme.com']);
    const bob = await person(owner, 'Bob', 'bob@acme.com');
    await turn(owner, false);
    expect(await readPerson(owner, bob.id)).toBeNull();
    expect((await pick(owner, bob.id, acme)).status).toBe(400);
    await turn(owner, true);
    expect((await readPerson(owner, bob.id))?.id).toBe(acme);
  });

  it('a guest cannot pick a person’s customer', async () => {
    const { owner } = await setup();
    const acme = await customer(owner, 'Acme');
    const bob = await person(owner, 'Bob', 'bob@x.com');
    const guest = await signUpAs('guest');
    expect((await pick(guest, bob.id, acme)).status).toBe(403);
  });
});
