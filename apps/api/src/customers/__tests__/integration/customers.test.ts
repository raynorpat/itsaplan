import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  createWebhook,
  gqlData,
  setWorkspaceRole,
  signUpAs,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';
import { instance, ok } from '../../../portal/__tests__/helpers';
import type { WorkspaceRole } from '../../../shared/access';

// Linear's Customer in GraphQL: create, update, delete, merge, upsert, the list with
// CustomerFilter, the status and tier on a status or tier delete, who may do what, the
// Customers switch, and the Customer webhooks.

const FIELDS = `id slugId name domains externalIds mainSourceId revenue size url
  archivedAt status { id name } tier { id name } owner { id }`;

const CREATE = `mutation($input: CustomerCreateInput!) {
  customerCreate(input: $input) { success customer { ${FIELDS} } }
}`;
const UPDATE = `mutation($id: String!, $input: CustomerUpdateInput!) {
  customerUpdate(id: $id, input: $input) { success customer { ${FIELDS} } }
}`;
const DELETE = `mutation($id: String!) { customerDelete(id: $id) { success entityId } }`;
const MERGE = `mutation($s: String!, $t: String!) {
  customerMerge(sourceCustomerId: $s, targetCustomerId: $t) { success customer { ${FIELDS} } }
}`;
const UPSERT = `mutation($input: CustomerUpsertInput!) {
  customerUpsert(input: $input) { success customer { ${FIELDS} } }
}`;

const turnOn = async (as: TestUser) =>
  ok(await instance('customers-settings/save', as, { enabled: true }));

async function errorCode(as: TestUser, query: string, variables?: Record<string, unknown>) {
  const res = await gql({ cookie: as.cookie }, query, variables);
  return res.body.errors?.[0]?.extensions?.code as string | undefined;
}

async function errorOf(as: TestUser, query: string, variables?: Record<string, unknown>) {
  const res = await gql({ cookie: as.cookie }, query, variables);
  return res.body.errors?.[0] as { message: string; extensions: { code: string } } | undefined;
}

const create = async (as: TestUser, input: Record<string, unknown>) =>
  (await gqlData(as, CREATE, { input })).customerCreate.customer;

async function setup() {
  const owner = await signUpTestUser();
  await turnOn(owner);
  return { owner };
}

describe('customers', () => {
  beforeEach(resetDb);

  it('a member creates a customer with the default status', async () => {
    await setup();
    const member = await signUpAs('member');
    const c = await create(member, { name: 'Acme Inc.', domains: ['Acme.com', '@acme.io'] });
    expect(c.name).toBe('Acme Inc.');
    expect(c.domains).toEqual(['acme.com', 'acme.io']);
    expect(c.status.name).toBe('Active');
    expect(c.tier).toBeNull();
    expect(c.archivedAt).toBeNull();
    expect(c.slugId).toMatch(/^acme-inc-[0-9a-f]{6}$/);
    expect(c.url.endsWith(`/feedback/customers/${c.slugId}`)).toBe(true);
    const read = await gqlData(member, `query($id: String!) { customer(id: $id) { id name } }`, {
      id: c.slugId,
    });
    expect(read.customer).toEqual({ id: c.id, name: 'Acme Inc.' });
  });

  it('a domain used by another customer is refused', async () => {
    const { owner } = await setup();
    await create(owner, { name: 'Acme', domains: ['acme.com'] });
    expect(
      await errorCode(owner, CREATE, { input: { name: 'Other', domains: ['ACME.com'] } }),
    ).toBe('CONFLICT');
    const other = await create(owner, { name: 'Other' });
    expect(await errorCode(owner, UPDATE, { id: other.id, input: { domains: ['acme.com'] } })).toBe(
      'CONFLICT',
    );
  });

  it('a public or malformed domain is refused', async () => {
    const { owner } = await setup();
    const pub = await errorOf(owner, CREATE, { input: { name: 'A', domains: ['gmail.com'] } });
    expect(pub?.extensions.code).toBe('INVALID_INPUT');
    expect(pub?.message).toContain('gmail.com');
    expect(
      await errorCode(owner, CREATE, { input: { name: 'A', domains: ['not a domain'] } }),
    ).toBe('INVALID_INPUT');
  });

  it('an external id is unique and mainSourceId must be one of them', async () => {
    const { owner } = await setup();
    await create(owner, { name: 'A', externalIds: ['crm-1'] });
    expect(await errorCode(owner, CREATE, { input: { name: 'B', externalIds: ['crm-1'] } })).toBe(
      'CONFLICT',
    );
    expect(
      await errorCode(owner, CREATE, {
        input: { name: 'B', externalIds: ['crm-2'], mainSourceId: 'crm-3' },
      }),
    ).toBe('INVALID_INPUT');
    const b = await create(owner, { name: 'B', externalIds: ['crm-2'], mainSourceId: 'crm-2' });
    expect(b.mainSourceId).toBe('crm-2');
  });

  it('revenue must be a nonnegative integer and the owner a person', async () => {
    const { owner } = await setup();
    expect(await errorCode(owner, CREATE, { input: { name: 'A', revenue: -1 } })).toBe(
      'INVALID_INPUT',
    );
    const app = await signUpTestUser();
    await setWorkspaceRole(app.userId, 'app' as WorkspaceRole);
    expect(await errorCode(owner, CREATE, { input: { name: 'A', ownerId: app.userId } })).toBe(
      'INVALID_INPUT',
    );
    const member = await signUpAs('member');
    const c = await create(owner, { name: 'A', revenue: 5000, size: 12, ownerId: member.userId });
    expect(c.revenue).toBe(5000);
    expect(c.size).toBe(12);
    expect(c.owner.id).toBe(member.userId);
  });

  it('updates fields and leaves the rest', async () => {
    const { owner } = await setup();
    const tier = (
      await gqlData(
        owner,
        `mutation { customerTierCreate(input: { name: "Enterprise", color: "#ff0000" }) { tier { id } } }`,
      )
    ).customerTierCreate.tier;
    const c = await create(owner, { name: 'A', domains: ['a.com'] });
    const updated = (
      await gqlData(owner, UPDATE, { id: c.id, input: { name: 'A2', tierId: tier.id } })
    ).customerUpdate.customer;
    expect(updated.name).toBe('A2');
    expect(updated.tier.name).toBe('Enterprise');
    expect(updated.domains).toEqual(['a.com']);
    expect(updated.slugId).toBe(c.slugId);
  });

  it('customers lists and filters', async () => {
    const { owner } = await setup();
    const tier = (
      await gqlData(
        owner,
        `mutation { customerTierCreate(input: { name: "Enterprise", color: "#ff0000" }) { tier { id } } }`,
      )
    ).customerTierCreate.tier;
    const a = await create(owner, { name: 'Acme', domains: ['acme.com'], tierId: tier.id });
    const b = await create(owner, { name: 'Globex', domains: ['globex.com'], revenue: 10 });
    const list = async (filter?: Record<string, unknown>) =>
      (
        await gqlData(
          owner,
          `query($f: CustomerFilter) { customers(filter: $f) { nodes { id } } }`,
          { f: filter },
        )
      ).customers.nodes.map((n: { id: string }) => n.id);
    expect(await list()).toEqual([b.id, a.id]);
    expect(await list({ tier: { displayName: { eq: 'Enterprise' } } })).toEqual([a.id]);
    expect(await list({ domains: { some: { eq: 'globex.com' } } })).toEqual([b.id]);
    expect(await list({ name: { containsIgnoreCase: 'acm' } })).toEqual([a.id]);
    expect(await list({ revenue: { gte: 5 } })).toEqual([b.id]);
    expect(await list({ status: { name: { eq: 'Active' } } })).toEqual([b.id, a.id]);
    expect(
      await errorCode(
        owner,
        `{ customers(filter: { slackChannelId: { eq: "x" } }) { nodes { id } } }`,
      ),
    ).toBe('INVALID_INPUT');
  });

  it('customers sorts by name, revenue and size', async () => {
    const { owner } = await setup();
    await create(owner, { name: 'beta', revenue: 10, size: 3 });
    await create(owner, { name: 'Alpha', revenue: 30 });
    await create(owner, { name: 'Gamma', revenue: 20, size: 1 });
    const names = async (sorts: unknown, first?: number, after?: string) => {
      const data = await gqlData(
        owner,
        `query($sorts: [CustomerSortInput!], $first: Int, $after: String) {
          customers(sorts: $sorts, first: $first, after: $after) {
            nodes { name } pageInfo { hasNextPage endCursor } } }`,
        { sorts, first, after },
      );
      return data.customers as {
        nodes: { name: string }[];
        pageInfo: { hasNextPage: boolean; endCursor: string };
      };
    };
    const list = async (sorts: unknown) => (await names(sorts)).nodes.map((n) => n.name);
    expect(await list([{ name: { order: 'Ascending' } }])).toEqual(['Alpha', 'beta', 'Gamma']);
    expect(await list([{ revenue: { order: 'Descending' } }])).toEqual(['Alpha', 'Gamma', 'beta']);
    expect(await list([{ size: { order: 'Ascending', nulls: 'last' } }])).toEqual([
      'Gamma',
      'beta',
      'Alpha',
    ]);
    const page = await names([{ name: { order: 'Ascending' } }], 2);
    expect(page.nodes.map((n) => n.name)).toEqual(['Alpha', 'beta']);
    expect(page.pageInfo.hasNextPage).toBe(true);
    const next = await names([{ name: { order: 'Ascending' } }], 2, page.pageInfo.endCursor);
    expect(next.nodes.map((n) => n.name)).toEqual(['Gamma']);
    expect(
      await errorCode(owner, `{ customers(sorts: [{ name: {}, revenue: {} }]) { nodes { id } } }`),
    ).toBe('INVALID_INPUT');
  });

  it('a guest sees no customers', async () => {
    const { owner } = await setup();
    const c = await create(owner, { name: 'Acme' });
    const guest = await signUpAs('guest');
    const list = await gqlData(guest, `{ customers { nodes { id } } }`);
    expect(list.customers.nodes).toEqual([]);
    expect(
      await errorCode(guest, `query($id: String!) { customer(id: $id) { id } }`, { id: c.id }),
    ).toBe('ENTITY_NOT_FOUND');
    expect(await errorCode(guest, CREATE, { input: { name: 'B' } })).toBe('FORBIDDEN');
  });

  it('with Customers off customers is empty and customerCreate fails', async () => {
    const { owner } = await setup();
    await create(owner, { name: 'Acme' });
    await ok(await instance('customers-settings/save', owner, { enabled: false }));
    const list = await gqlData(owner, `{ customers { nodes { id } } }`);
    expect(list.customers.nodes).toEqual([]);
    const err = await errorOf(owner, CREATE, { input: { name: 'B' } });
    expect(err?.extensions.code).toBe('INVALID_INPUT');
    expect(err?.message).toBe('Customers are not enabled');
  });

  it('customerUpsert updates by external id and creates otherwise', async () => {
    const { owner } = await setup();
    const first = (await gqlData(owner, UPSERT, { input: { name: 'Acme', externalId: 'crm-9' } }))
      .customerUpsert.customer;
    expect(first.externalIds).toEqual(['crm-9']);
    const again = (
      await gqlData(owner, UPSERT, { input: { externalId: 'crm-9', revenue: 7, tierName: 'Gold' } })
    ).customerUpsert.customer;
    expect(again.id).toBe(first.id);
    expect(again.name).toBe('Acme');
    expect(again.revenue).toBe(7);
    expect(again.tier.name).toBe('Gold');
    expect(await errorCode(owner, UPSERT, { input: { externalId: 'crm-10' } })).toBe(
      'INVALID_INPUT',
    );
  });

  it('customerUpsert creates a tier only for owners and admins, after the input is valid', async () => {
    const { owner } = await setup();
    const member = await signUpAs('member');
    const tiers = async () =>
      (await gqlData(owner, `{ customerTiers { nodes { name } } }`)).customerTiers.nodes;
    expect(await errorCode(member, UPSERT, { input: { name: 'Acme', tierName: 'Gold' } })).toBe(
      'INVALID_INPUT',
    );
    expect(
      await errorCode(owner, UPSERT, { input: { name: 'Acme', tierName: 'Gold', revenue: -1 } }),
    ).toBe('INVALID_INPUT');
    expect(await tiers()).toEqual([]);
    const made = (await gqlData(owner, UPSERT, { input: { name: 'Acme', tierName: 'Gold' } }))
      .customerUpsert.customer;
    expect(made.tier.name).toBe('Gold');
    const byMember = (
      await gqlData(member, UPSERT, { input: { name: 'Initech', tierName: 'gold' } })
    ).customerUpsert.customer;
    expect(byMember.tier.name).toBe('Gold');
  });

  it('merge moves domains and external ids and deletes the source', async () => {
    const { owner } = await setup();
    const source = await create(owner, {
      name: 'Acme EU',
      domains: ['acme.eu'],
      externalIds: ['s'],
    });
    const target = await create(owner, { name: 'Acme', domains: ['acme.com'], externalIds: ['t'] });
    const merged = (await gqlData(owner, MERGE, { s: source.id, t: target.id })).customerMerge
      .customer;
    expect(merged.id).toBe(target.id);
    expect(merged.domains.sort()).toEqual(['acme.com', 'acme.eu']);
    expect(merged.externalIds.sort()).toEqual(['s', 't']);
    expect(
      await errorCode(owner, `query($id: String!) { customer(id: $id) { id } }`, { id: source.id }),
    ).toBe('ENTITY_NOT_FOUND');
    expect(await errorCode(owner, MERGE, { s: target.id, t: target.id })).toBe('INVALID_INPUT');
  });

  it('a member deletes a customer', async () => {
    const { owner } = await setup();
    const c = await create(owner, { name: 'Acme' });
    const member = await signUpAs('member');
    const res = await gqlData(member, DELETE, { id: c.id });
    expect(res.customerDelete).toEqual({ success: true, entityId: c.id });
    expect(await errorCode(member, DELETE, { id: c.id })).toBe('ENTITY_NOT_FOUND');
  });

  it('deleting a status moves its customers to the default status', async () => {
    const { owner } = await setup();
    const statuses = (await gqlData(owner, `{ customerStatuses { nodes { id name } } }`))
      .customerStatuses.nodes as { id: string; name: string }[];
    const prospect = statuses.find((s) => s.name === 'Prospect')!;
    const c = await create(owner, { name: 'Acme', statusId: prospect.id });
    expect(c.status.name).toBe('Prospect');
    await gqlData(owner, `mutation($id: String!) { customerStatusDelete(id: $id) { success } }`, {
      id: prospect.id,
    });
    const read = await gqlData(
      owner,
      `query($id: String!) { customer(id: $id) { status { name } } }`,
      {
        id: c.id,
      },
    );
    expect(read.customer.status.name).toBe('Active');
  });

  it('deleting a tier clears it', async () => {
    const { owner } = await setup();
    const tier = (
      await gqlData(
        owner,
        `mutation { customerTierCreate(input: { name: "Gold", color: "#ffd700" }) { tier { id } } }`,
      )
    ).customerTierCreate.tier;
    const c = await create(owner, { name: 'Acme', tierId: tier.id });
    await gqlData(owner, `mutation($id: String!) { customerTierDelete(id: $id) { success } }`, {
      id: tier.id,
    });
    const read = await gqlData(owner, `query($id: String!) { customer(id: $id) { tier { id } } }`, {
      id: c.id,
    });
    expect(read.customer.tier).toBeNull();
  });

  it('customerUnsync is not supported', async () => {
    const { owner } = await setup();
    const c = await create(owner, { name: 'Acme' });
    expect(
      await errorCode(owner, `mutation($id: String!) { customerUnsync(id: $id) { success } }`, {
        id: c.id,
      }),
    ).toBe('INVALID_INPUT');
  });

  it('customer webhooks are sent to an all-teams webhook', async () => {
    const { owner } = await setup();
    const hook = await createWebhook(owner, {
      url: 'https://example.com/hook',
      resourceTypes: ['Customer'],
      allPublicTeams: true,
    });
    const a = await create(owner, { name: 'Acme' });
    const b = await create(owner, { name: 'Acme EU', domains: ['acme.eu'] });
    await gqlData(owner, UPDATE, { id: a.id, input: { name: 'Acme Inc.' } });
    await gqlData(owner, MERGE, { s: b.id, t: a.id });
    await gqlData(owner, DELETE, { id: a.id });
    const events = (await webhookDeliveries(hook.id)).data.items.reverse().map((d) => {
      const p = d.payload as { type: string; action: string; data: { id: string; name: string } };
      return `${p.type}:${p.action}:${p.data.name}`;
    });
    expect(events).toEqual([
      'Customer:create:Acme',
      'Customer:create:Acme EU',
      'Customer:update:Acme Inc.',
      'Customer:update:Acme Inc.',
      'Customer:remove:Acme EU',
      'Customer:remove:Acme Inc.',
    ]);
  });
});
