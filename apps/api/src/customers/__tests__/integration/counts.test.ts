import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  archiveIssue,
  createIssue,
  createTeam,
  gqlData,
  makePrivate,
  signUpAs,
} from '../../../__tests__/helpers/graphql';
import { countStatements } from '../../../__tests__/helpers/statements';
import { instance, ok, type Json } from '../../../portal/__tests__/helpers';

// Linear's customerCount and customerImportantCount count customers while Customers is
// on: each person without a customer once, each request with neither once.

const CREATE = `mutation($input: CustomerCreateInput!) {
  customerCreate(input: $input) { customer { id } } }`;
const NEED_CREATE = `mutation($input: CustomerNeedCreateInput!) {
  customerNeedCreate(input: $input) { need { id } } }`;
const ISSUES = `query($filter: IssueFilter) { issues(filter: $filter) { nodes { id } } }`;
const SORTED = `query($sort: [IssueSortInput!]) { issues(sort: $sort) { nodes { id } } }`;

const turn = async (as: TestUser, enabled: boolean) =>
  ok(await instance('customers-settings/save', as, { enabled }));

const customer = async (as: TestUser, name: string, domains: string[] = []) =>
  (await gqlData(as, CREATE, { input: { name, domains } })).customerCreate.customer.id as string;

const person = async (as: TestUser, name: string, email?: string) =>
  ((await ok(await instance('requesters/create', as, { name, email }))).requester as Json)
    .id as string;

async function feedback(as: TestUser, issueId: string, requesterId: string, priority = 0) {
  const { attachmentId } = await ok(
    await instance('feedback/attachment', as, { issueId, requesterId }),
  );
  await gqlData(as, NEED_CREATE, { input: { issueId, attachmentId, priority } });
}

const bare = (as: TestUser, issueId: string, input: Record<string, unknown> = {}) =>
  gqlData(as, NEED_CREATE, { input: { issueId, ...input } });

const matching = async (as: TestUser, filter: Record<string, unknown>) =>
  ((await gqlData(as, ISSUES, { filter })).issues.nodes as { id: string }[]).map((n) => n.id);

async function setup() {
  const owner = await signUpTestUser();
  await turn(owner, true);
  const eng = await createTeam(owner, { key: 'ENG' });
  const issue = await createIssue(owner, { teamId: eng.team.id, title: 'Dark mode' });
  return { owner, eng, issue };
}

describe('customer counts', () => {
  beforeEach(resetDb);

  it('two people of one customer count once', async () => {
    const { owner, issue } = await setup();
    await customer(owner, 'Acme', ['acme.com']);
    await feedback(owner, issue.id, await person(owner, 'Ann', 'ann@acme.com'));
    await feedback(owner, issue.id, await person(owner, 'Bob', 'bob@acme.com'));
    expect(await matching(owner, { customerCount: { eq: 1 } })).toEqual([issue.id]);
    expect(await matching(owner, { customerCount: { eq: 2 } })).toEqual([]);
  });

  it('people without a customer count each, and a request with neither counts once', async () => {
    const { owner, issue } = await setup();
    await customer(owner, 'Acme', ['acme.com']);
    await feedback(owner, issue.id, await person(owner, 'Ann', 'ann@acme.com'));
    await feedback(owner, issue.id, await person(owner, 'Kim', 'kim@example.org'));
    await feedback(owner, issue.id, await person(owner, 'Lee'));
    await bare(owner, issue.id);
    await bare(owner, issue.id);
    // Acme, Kim, Lee and two requests with neither.
    expect(await matching(owner, { customerCount: { eq: 5 } })).toEqual([issue.id]);
  });

  it('a request without a person counts as its customer', async () => {
    const { owner, issue } = await setup();
    const acme = await customer(owner, 'Acme', ['acme.com']);
    await feedback(owner, issue.id, await person(owner, 'Ann', 'ann@acme.com'));
    await bare(owner, issue.id, { customerId: acme });
    expect(await matching(owner, { customerCount: { eq: 1 } })).toEqual([issue.id]);
  });

  it('customerImportantCount counts customers with important requests', async () => {
    const { owner, issue } = await setup();
    await customer(owner, 'Acme', ['acme.com']);
    await feedback(owner, issue.id, await person(owner, 'Ann', 'ann@acme.com'), 1);
    await feedback(owner, issue.id, await person(owner, 'Bob', 'bob@acme.com'), 1);
    await feedback(owner, issue.id, await person(owner, 'Kim', 'kim@example.org'));
    expect(await matching(owner, { customerImportantCount: { eq: 1 } })).toEqual([issue.id]);
    expect(await matching(owner, { customerCount: { eq: 2 } })).toEqual([issue.id]);
  });

  it('with Customers off customerCount counts people', async () => {
    const { owner, issue } = await setup();
    await customer(owner, 'Acme', ['acme.com']);
    await feedback(owner, issue.id, await person(owner, 'Ann', 'ann@acme.com'));
    await feedback(owner, issue.id, await person(owner, 'Bob', 'bob@acme.com'));
    await bare(owner, issue.id);
    await turn(owner, false);
    // Two people; a request without a person is not a person.
    expect(await matching(owner, { customerCount: { eq: 2 } })).toEqual([issue.id]);
  });

  it('the customerCount sort orders by customers', async () => {
    const { owner, eng, issue } = await setup();
    const other = await createIssue(owner, { teamId: eng.team.id, title: 'Export' });
    await customer(owner, 'Acme', ['acme.com']);
    // Three Acme people on `issue` count once; two separate people on `other` count twice.
    for (const name of ['ann', 'bob', 'cy'])
      await feedback(owner, issue.id, await person(owner, name, `${name}@acme.com`));
    await feedback(owner, other.id, await person(owner, 'Kim', 'kim@example.org'));
    await feedback(owner, other.id, await person(owner, 'Lee', 'lee@example.net'));
    const ids = (
      (await gqlData(owner, SORTED, { sort: [{ customerCount: { order: 'Descending' } }] })).issues
        .nodes as { id: string }[]
    ).map((n) => n.id);
    expect(ids).toEqual([other.id, issue.id]);
  });

  it('approximateNeedCount counts distinct issues', async () => {
    const { owner, eng, issue } = await setup();
    const other = await createIssue(owner, { teamId: eng.team.id, title: 'Export' });
    const acme = await customer(owner, 'Acme', ['acme.com']);
    const ann = await person(owner, 'Ann', 'ann@acme.com');
    await feedback(owner, issue.id, ann);
    await feedback(owner, issue.id, await person(owner, 'Bob', 'bob@acme.com'));
    await feedback(owner, other.id, ann);
    const data = await gqlData(
      owner,
      `query($id: String!) { customer(id: $id) { approximateNeedCount } }`,
      {
        id: acme,
      },
    );
    expect(data.customer.approximateNeedCount).toBe(2);
  });

  it('approximateNeedCount leaves out archived issues and issues the viewer cannot see', async () => {
    const { owner, eng, issue } = await setup();
    const ops = await createTeam(owner, { key: 'OPS' });
    const hidden = await createIssue(owner, { teamId: ops.team.id, title: 'Secret' });
    const old = await createIssue(owner, { teamId: eng.team.id, title: 'Old' });
    const acme = await customer(owner, 'Acme', ['acme.com']);
    const ann = await person(owner, 'Ann', 'ann@acme.com');
    await feedback(owner, issue.id, ann);
    await feedback(owner, hidden.id, ann);
    await feedback(owner, old.id, ann);
    await archiveIssue(owner, old.id);
    await makePrivate(owner, 'OPS');
    const member = await signUpAs('member');
    const count = async (as: TestUser) =>
      (
        await gqlData(as, `query($id: String!) { customer(id: $id) { approximateNeedCount } }`, {
          id: acme,
        })
      ).customer.approximateNeedCount;
    expect(await count(owner)).toBe(2);
    expect(await count(member)).toBe(1);
  });

  it('a customer list reads statuses, tiers and counts in a bounded number of queries', async () => {
    const { owner, issue } = await setup();
    const tier = await gqlData(
      owner,
      `mutation { customerTierCreate(input: { name: "Enterprise", color: "#ff0000" }) { tier { id } } }`,
    );
    const add = async (names: string[]) => {
      for (const name of names) {
        const id = await customer(owner, name, [`${name.toLowerCase()}.com`]);
        await gqlData(
          owner,
          `mutation($id: String!, $tierId: String) { customerUpdate(id: $id, input: { tierId: $tierId }) { success } }`,
          { id, tierId: tier.customerTierCreate.tier.id },
        );
        await feedback(owner, issue.id, await person(owner, name, `x@${name.toLowerCase()}.com`));
      }
    };
    const list = () =>
      gqlData(
        owner,
        `{ customers { nodes { id status { name } tier { name } approximateNeedCount } } }`,
      );
    await add(['A', 'B']);
    const few = await countStatements(list);
    await add(['C', 'D', 'E', 'F', 'G', 'H']);
    const many = await countStatements(list);
    expect((await list()).customers.nodes).toHaveLength(8);
    expect(many).toBe(few);
  });

  it('the customer need filter matches nothing while Customers is off', async () => {
    const { owner, issue } = await setup();
    const acme = await customer(owner, 'Acme', ['acme.com']);
    await feedback(owner, issue.id, await person(owner, 'Ann', 'ann@acme.com'));
    const query = `query($filter: CustomerNeedFilter) { customerNeeds(filter: $filter) { nodes { id } } }`;
    const filter = { customer: { id: { eq: acme } } };
    expect((await gqlData(owner, query, { filter })).customerNeeds.nodes).toHaveLength(1);
    await turn(owner, false);
    expect((await gqlData(owner, query, { filter })).customerNeeds.nodes).toEqual([]);
    const nullFilter = { customer: { null: true } };
    expect((await gqlData(owner, query, { filter: nullFilter })).customerNeeds.nodes).toEqual([]);
  });
});
